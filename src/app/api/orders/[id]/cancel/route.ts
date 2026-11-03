// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders/[id]/cancel — customer self-service cancellation (ACC-050)
//
// Body: { reason: <code from lib/orderCancellation>, note?: string }
//
// Safety model
//   • IDOR guard: the order is matched on id AND customer_id = the logged-in customer (404 otherwise —
//     identical for "not yours" and "does not exist").
//   • Single winner: the status flips with a CONDITIONAL update (`order_status in (pending, confirmed)`);
//     if a packer/admin got there first nothing changes and the customer gets a clear 409.
//   • Only Cash-on-Delivery orders before packing (lib/orderCancellation.ts); everything else → support.
//   • The database does the rest of the bookkeeping on the status change: stock is released
//     (handle_order_status_change) and the finance journal reversed (journal_reverse_on_cancel).
//     This route adds what no trigger covers: coupon release + loyalty reversal (reverse_loyalty_for_order).
//   • Every post-cancel step is best-effort and alert-logged — the order IS cancelled, so the customer is
//     told so even if a follow-up step hiccups.
// ─────────────────────────────────────────────────────────────────────────────
import { adminNotifyAddress } from '@/lib/server/adminNotify'
import { NextRequest, NextResponse, after } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin,
  getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile,
  checkCsrf,
  checkRateLimitShared,
} from '@/lib/api/serverUtils'
import { cancelEligibility, CANCEL_REASONS, CANCEL_REASON_CODES } from '@/lib/orderCancellation'
import { logOrderEvent } from '@/lib/services/orderService'
import { sendTransactionalEmail } from '@/lib/server/email'
import { refreshCatalogPages } from '@/lib/server/catalogFreshness'
import { getFreshSiteSettings } from '@/lib/getSiteSettings'
import { esc } from '@/lib/server/htmlEscape'
import { brandedEmail } from '@/lib/server/emailShell'
import { logger, captureError } from '@/lib/logger'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  const { id } = await params
  if (!/^[0-9]{1,15}$/.test(id ?? '')) return fail(400, 'Invalid order ID')

  let token = getToken(req)
  const refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  let body: { reason?: unknown; note?: unknown } = {}
  try { body = await req.json() } catch { return fail(400, 'Invalid JSON') }
  const reason = typeof body.reason === 'string' ? body.reason : ''
  if (!CANCEL_REASON_CODES.includes(reason)) return fail(400, 'Please choose a reason for cancelling')
  const note = typeof body.note === 'string' ? body.note.replace(/<[^>]*>/g, '').trim().slice(0, 200) : ''

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    // Cancelling is a write that moves stock and money-adjacent state: cap it per account across instances.
    if (!await checkRateLimitShared(`order_cancel:${profile.id}`, 10, 60 * 60_000)) {
      return fail(429, 'Too many cancellation attempts — please wait a while or message us on WhatsApp.', { 'Retry-After': '3600' })
    }

    // IDOR guard — id AND owner in the same query; a foreign / unknown order is just "not found".
    const rows = await sbAdmin(
      'GET',
      `/rest/v1/orders?id=eq.${id}&customer_id=eq.${profile.id}&select=id,order_number,order_status,payment_method,payment_status,tracking_number,shipped_at,total_amount&limit=1`,
    )
    const order = Array.isArray(rows) ? rows[0] : null
    if (!order) return fail(404, 'Order not found')

    const verdict = cancelEligibility(order)
    if (!verdict.allowed) {
      return NextResponse.json({ error: verdict.message, code: verdict.reason }, { status: 409 })
    }

    // Single-winner conditional flip. The filter re-checks dispatch (no AWB, not shipped) so an AWB added by ops after
    // the eligibility read above cannot be cancelled by the customer.
    // 0 rows back = someone (packing / admin / a double click) got there first.
    let updated: Array<{ id: number }> = []
    try {
      updated = await sbAdmin(
        'PATCH',
        `/rest/v1/orders?id=eq.${order.id}&customer_id=eq.${profile.id}&order_status=in.(pending,confirmed)&or=(tracking_number.is.null,tracking_number.eq.)&shipped_at=is.null`,
        { order_status: 'cancelled', updated_at: new Date().toISOString() },
        'return=representation',
      ) ?? []
    } catch (e) {
      // The DB state machine refused (e.g. status moved to a non-cancellable state in the meantime).
      const msg = String((e as { message?: string })?.message ?? '')
      if (/transition|not allowed|check_violation/i.test(msg)) updated = []
      else throw e
    }
    if (!Array.isArray(updated) || updated.length === 0) {
      return NextResponse.json({
        error: 'This order can no longer be cancelled online — it may have just been packed. Please message us on WhatsApp.',
        code: 'contact_support',
      }, { status: 409 })
    }

    // ── Post-cancel bookkeeping (best-effort; the cancellation itself is already committed) ──
    const results: Record<string, unknown> = {}
    // Steps that failed are recorded ON the order's event log so ops can find and finish them (nothing retries them).
    const followupFailed: string[] = []
    try { results.coupon = await sbAdmin('POST', '/rest/v1/rpc/release_coupon_for_order', { p_order_id: order.id }) }
    catch (e) { followupFailed.push('coupon_release'); captureError(e, { action: 'orders.cancel.coupon_release', order_id: order.id, alert: true }) }
    try { results.loyalty = await sbAdmin('POST', '/rest/v1/rpc/reverse_loyalty_for_order', { p_order_id: order.id, p_note: `order ${order.order_number} cancelled by customer` }) }
    catch (e) { followupFailed.push('loyalty_reversal'); captureError(e, { action: 'orders.cancel.loyalty_reversal', order_id: order.id, alert: true }) }
    await logOrderEvent(
      String(order.id), 'customer_cancelled', 'customer',
      { reason, note: note || undefined, ...results, ...(followupFailed.length ? { followup_failed: followupFailed, needs_manual_followup: true } : {}) },
    ).catch(e => { captureError(e, { action: 'orders.cancel.event_log', order_id: order.id, alert: true, followup_failed: followupFailed }) })
    logger.info('orders: customer cancelled order', { action: 'orders.cancel', order_id: order.id, order_number: order.order_number, reason })

    // Stock just came back → cached product cards may show "sold out" wrongly.
    try { after(() => { try { refreshCatalogPages() } catch { /* best-effort */ } }) } catch { /* outside a request scope (unit tests) */ }

    // E-mails after the response (same dead-letter path as order confirmations).
    try {
      after(async () => {
        const reasonLabel = CANCEL_REASONS.find(r => r.code === reason)?.label ?? reason
        const email = typeof user.email === 'string' ? user.email : ''
        if (email) {
          await sendTransactionalEmail({
            type: 'order_cancelled', to: email,
            subject: `Order ${order.order_number} cancelled`,
            html: brandedEmail({
              heading: 'Your order has been cancelled',
              bodyHtml: `<p style="margin:0 0 12px">Order <strong>${esc(order.order_number)}</strong> was cancelled at your request. As this was a Cash-on-Delivery order, nothing was charged and no refund is needed. Any Pahadi Coins you used have been returned to your account.</p><p style="margin:0">Changed your mind? You can place a new order any time.</p>`,
              cta: { label: 'Continue shopping', href: process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com' },
            }),
            context: { order_id: order.id, order_number: order.order_number },
          })
        }
        const settings = await getFreshSiteSettings().catch(() => null)
        const adminTo = adminNotifyAddress(settings)
        if (adminTo) {
          await sendTransactionalEmail({
            type: 'admin_order_notify', to: adminTo,
            subject: `Order #${order.order_number} cancelled by customer`,
            html: `<p>Order <b>#${esc(order.order_number)}</b> (COD, Rs.${esc(order.total_amount)}) was cancelled by the customer.<br>Reason: ${esc(reasonLabel)}${note ? `<br>Note: ${esc(note)}` : ''}<br>Stock released, coupon and coins reversed automatically.</p>`,
            context: { order_id: order.id, order_number: order.order_number },
          })
        }
      })
    } catch { /* outside a request scope (unit tests) */ }

    const res = ok({ success: true, status: 'cancelled', order_number: order.order_number })
    ;(res as NextResponse).headers.set('Cache-Control', 'private, no-store')
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    captureError(e, { action: 'orders.cancel', alert: true })
    return fail(500, 'We could not cancel your order right now — please try again or message us on WhatsApp.')
  }
}
