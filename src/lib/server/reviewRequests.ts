// "How was your order?" e-mails (Nov 2026) - sent a few days after delivery, like Amazon / Flipkart / Nykaa.
//
// Run from the daily expire-pending-orders sweep (Hobby plan: two crons only). Safety rules:
//   * Only REGISTERED customers (auth_user_id set) with an e-mail address who have not turned off order e-mails
//     (`customers.notif_email_orders !== false`); guests are never mailed (they cannot sign in to review anyway).
//   * Only orders delivered between (now - review_request_days - 14 days) and (now - review_request_days): a backlog from before
//     this feature existed is never mass-mailed. On top of that a run sends at most 5 e-mails and at most ONE per customer, so even
//     a first run after activation trickles out over a few days instead of arriving as a burst.
//   * A customer is mailed at most once every 7 days (REVIEW_REQUEST_COOLDOWN_DAYS), however many orders they have delivered.
//   * Products that are no longer listed (inactive) are not asked about - there is no page to show the review on.
//   * The order is CLAIMED first (INSERT ... ON CONFLICT DO NOTHING into review_requests) and only the single winner
//     sends, so overlapping runs can never mail twice. If the send fails outright (not even dead-lettered) the claim is
//     released so the next run retries.
//   * Skips orders whose every item is already reviewed.
//   * Never throws; honours the `review_request_enabled` setting; bounded by a batch limit and a time budget.
import 'server-only'
import type { getServiceClient } from '@/lib/supabase'
import { sendTransactionalEmail } from '@/lib/server/email'
import { brandedEmail, emailSiteUrl } from '@/lib/server/emailShell'
import { esc } from '@/lib/server/htmlEscape'
import { captureError, logger } from '@/lib/logger'

type Db = ReturnType<typeof getServiceClient>

/** Longest one review-request send can take: two 5 s Resend attempts, the retry pause and the dead-letter insert. */
const WORST_CASE_SEND_MS = 12_000

export const REVIEW_REQUEST_DEFAULT_DAYS = 7
export const REVIEW_REQUEST_COOLDOWN_DAYS = 7    // never mail the same customer more often than this
export const REVIEW_REQUEST_WINDOW_DAYS = 14   // width of the eligibility window, counted back from (now - review_request_days)
const DEFAULT_LIMIT = 5
const DEFAULT_TIME_BUDGET_MS = 25_000
const PAGE = 100
const MAX_PAGES = 20
const DAY = 86_400_000

export interface ReviewRequestStats {
  enabled:  boolean
  scanned:  number
  sent:     number
  skipped:  number
  errors:   number
  timeBudgetHit?: boolean
}

function resolveDays(v: unknown): number {
  const n = Math.floor(Number(String(v ?? '').replace(/[^0-9.]/g, '')))
  return Number.isFinite(n) && n >= 1 && n <= 30 ? n : REVIEW_REQUEST_DEFAULT_DAYS
}

type OrderRow = { id: number | string; order_number: string | null; customer_id: number | string | null; delivered_at: string }
type CustomerRow = { id: number | string; first_name: string | null; email: string | null; auth_user_id: string | null; notif_email_orders: boolean | null }

export async function sendReviewRequests(
  db: Db,
  opts: { now?: Date; limit?: number; timeBudgetMs?: number } = {},
): Promise<ReviewRequestStats> {
  const stats: ReviewRequestStats = { enabled: true, scanned: 0, sent: 0, skipped: 0, errors: 0 }
  try {
    const now = opts.now ?? new Date()
    const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT)
    const budget = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS
    const startedAt = Date.now()

    const { data: srows, error: serr } = await db
      .from('site_settings').select('key, value').in('key', ['review_request_enabled', 'review_request_days'])
    if (serr) throw new Error('settings read failed: ' + serr.message)
    const settings = Object.fromEntries(((srows ?? []) as Array<{ key: string; value: string }>).map(r => [r.key, r.value]))
    if (String(settings.review_request_enabled ?? 'true').trim().toLowerCase() === 'false') {
      stats.enabled = false
      return stats
    }
    const days = resolveDays(settings.review_request_days)
    const until = new Date(now.getTime() - days * DAY).toISOString()
    const since = new Date(now.getTime() - (days + REVIEW_REQUEST_WINDOW_DAYS) * DAY).toISOString()
    const mailedCustomers = new Set<string>()   // at most one e-mail per customer per run
    // …and none for a customer who was already mailed in the last 7 days (an earlier run).
    {
      const cooldownSince = new Date(now.getTime() - REVIEW_REQUEST_COOLDOWN_DAYS * DAY).toISOString()
      const { data: recent, error: rcErr } = await db.from('review_requests').select('order_id').gte('sent_at', cooldownSince)
      if (rcErr) throw new Error('review_requests read failed (migration applied?): ' + rcErr.message)
      const recentIds = ((recent ?? []) as Array<{ order_id: number | string }>).map(r => r.order_id)
      if (recentIds.length > 0) {
        const { data: ro, error: roErr } = await db.from('orders').select('customer_id').in('id', recentIds)
        if (roErr) throw new Error('orders read failed: ' + roErr.message)
        for (const o of (ro ?? []) as Array<{ customer_id: number | string | null }>) if (o.customer_id != null) mailedCustomers.add(String(o.customer_id))
      }
    }
    const siteUrl = emailSiteUrl()   // finding F: never a localhost / http / trailing-slash env value in a customer's inbox

    for (let page = 0; page < MAX_PAGES && stats.sent < limit; page++) {
      const { data: orders, error: oerr } = await db
        .from('orders')
        .select('id, order_number, customer_id, delivered_at')
        .eq('order_status', 'delivered')
        .gte('delivered_at', since)
        .lte('delivered_at', until)
        .not('customer_id', 'is', null)
        .order('delivered_at', { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1)
      if (oerr) throw new Error('orders read failed: ' + oerr.message)
      const batch = (orders ?? []) as OrderRow[]
      if (batch.length === 0) break

      const orderIds = batch.map(o => o.id)
      const customerIds = [...new Set(batch.map(o => o.customer_id))]
      const [{ data: custs, error: cerr }, { data: claimed, error: rerr }, { data: rets, error: retErr }] = await Promise.all([
        db.from('customers').select('id, first_name, email, auth_user_id, notif_email_orders').in('id', customerIds),
        db.from('review_requests').select('order_id').in('order_id', orderIds),
        // A customer who returned (or asked to return) something from this order should not get "How was your order?".
        db.from('returns').select('order_id').in('order_id', orderIds),
      ])
      if (cerr) throw new Error('customers read failed: ' + cerr.message)
      if (rerr) throw new Error('review_requests read failed (migration applied?): ' + rerr.message)
      const byCustomer = new Map(((custs ?? []) as CustomerRow[]).map(c => [String(c.id), c]))
      const already = new Set(((claimed ?? []) as Array<{ order_id: number | string }>).map(r => String(r.order_id)))
      if (retErr) logger.warn('review requests: returns lookup failed — not skipping returned orders this run', { action: 'cron.review_requests.returns', error: retErr.message })
      const hasReturn = new Set(((rets ?? []) as Array<{ order_id: number | string }>).map(r => String(r.order_id)))

      for (const order of batch) {
        if (stats.sent >= limit) break
        if (Date.now() - startedAt > budget) { stats.timeBudgetHit = true; return stats }
        stats.scanned++
        if (already.has(String(order.id)) || hasReturn.has(String(order.id))) { stats.skipped++; continue }
        if (mailedCustomers.has(String(order.customer_id))) { stats.skipped++; continue }   // their other orders wait for a later run
        const cust = byCustomer.get(String(order.customer_id))
        const email = (cust?.email ?? '').trim()
        if (!cust || !cust.auth_user_id || !email.includes('@') || cust.notif_email_orders === false) { stats.skipped++; continue }

        try {
          // Items of this order that this customer has not reviewed yet.
          const { data: items, error: ierr } = await db
            .from('order_items').select('product_id, product_name_snapshot, variant_value_snapshot, products(name, image_url, emoji, is_active)').eq('order_id', order.id)
          if (ierr) throw new Error('order_items read failed: ' + ierr.message)
          type Shown = { name: string; variant: string | null; image: string | null; emoji: string | null }
          const products = new Map<string, Shown>()
          for (const it of (items ?? []) as Array<{ product_id: number | string | null; product_name_snapshot: string | null; variant_value_snapshot?: string | null; products?: { name?: string | null; image_url?: string | null; emoji?: string | null; is_active?: boolean | null } | null }>) {
            if (it.product_id == null || products.has(String(it.product_id))) continue
            if (it.products?.is_active === false) continue   // not listed any more: nowhere to show a review
            products.set(String(it.product_id), { name: it.product_name_snapshot || it.products?.name || 'your item', variant: it.variant_value_snapshot || null, image: it.products?.image_url || null, emoji: it.products?.emoji || null })
          }
          if (products.size === 0) { stats.skipped++; continue }
          const { data: mine, error: verr } = await db
            .from('reviews').select('product_id').eq('customer_id', cust.id).in('product_id', [...products.keys()])
          if (verr) throw new Error('reviews read failed (migration applied?): ' + verr.message)
          for (const r of (mine ?? []) as Array<{ product_id: number | string }>) products.delete(String(r.product_id))
          if (products.size === 0) { stats.skipped++; continue }

          // Nov 2026 verification: the budget was checked once per order, but a send can take ~12 s (two 5 s attempts + the dead-
          // letter insert). Claimed and then killed mid-send meant that customer was never asked. Only start a send that fits.
          if (budget - (Date.now() - startedAt) < WORST_CASE_SEND_MS) { stats.timeBudgetHit = true; return stats }

          // Claim BEFORE sending - exactly one concurrent run wins.
          const { data: won, error: claimErr } = await db
            .from('review_requests')
            .upsert({ order_id: order.id }, { onConflict: 'order_id', ignoreDuplicates: true })
            .select('order_id')
          if (claimErr) throw new Error('claim failed: ' + claimErr.message)
          if (!won || won.length === 0) { stats.skipped++; continue }

          // Photo, name and size of each product, so the customer knows exactly what they are being asked to rate.
          const list = [...products.values()]
          const thumb = (p: Shown) => /^https:\/\//i.test(p.image ?? '')
            ? `<img src="${esc(p.image)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid #ece5d8" />`
            : `<div style="width:56px;height:56px;border-radius:10px;background:#f0f4ee;text-align:center;line-height:56px;font-size:24px">${esc(p.emoji || '🌿')}</div>`
          const shown = list.slice(0, 3).map(p => `<tr><td width="68" valign="middle" style="padding:6px 0">${thumb(p)}</td><td valign="middle" style="padding:6px 0"><strong style="font-size:15px;color:#1a1611">${esc(p.name)}</strong>${p.variant ? `<br><span style="font-size:12px;color:#6b6256">${esc(p.variant)}</span>` : ''}</td></tr>`).join('')
          const more = list.length > 3 ? `<tr><td colspan="2" style="padding:6px 0;font-size:13px;color:#6b6256">and ${list.length - 3} more</td></tr>` : ''
          const orderNo = order.order_number || String(order.id)
          const greet = cust.first_name && cust.first_name !== 'Deleted' ? `Hi ${esc(cust.first_name)},` : 'Hi,'
          const result = await sendTransactionalEmail({
            type: 'review_request',
            to: email,
            subject: `How was your order ${orderNo}?`,
            html: brandedEmail({
              heading: 'How was your order?',
              bodyHtml: `<p style="margin:0 0 12px">${greet}</p><p style="margin:0 0 12px">Your order <strong>${esc(orderNo)}</strong> was delivered. We would love to hear what you think - your review helps other families choose, and it takes less than a minute.</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;width:100%">${shown}${more}</table><p style="margin:0">Reviews appear on the product page after a quick check by our team.</p><p style="margin:16px 0 0;font-size:12px;color:#6b6256">Don't want these e-mails? <a href="${siteUrl}/account?tab=notifications" style="color:#6b6256">Change your e-mail preferences</a>.</p>`,
              cta: { label: 'Rate & review', href: `${siteUrl}/account/orders/${order.id}/review` },
            }),
            context: { order_id: order.id, order_number: orderNo },
          })
          if (result.sent || result.deadLettered) {
            stats.sent++
            mailedCustomers.add(String(order.customer_id))
          } else {
            // Not sent and not queued for retry: release the claim so the next run tries again.
            await db.from('review_requests').delete().eq('order_id', order.id)
            stats.errors++
          }
        } catch (e) {
          stats.errors++
          captureError(e, { action: 'cron.review_requests.order', order_id: String(order.id) })
        }
      }
      if (batch.length < PAGE) break
    }
  } catch (e) {
    stats.errors++
    captureError(e, { action: 'cron.review_requests', alert: true })
  }
  logger.info('cron: review requests finished', { action: 'cron.review_requests', ...stats })
  return stats
}
