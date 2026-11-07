// ─────────────────────────────────────────────────────────────
// GET /api/account/data-export
//
// DPDP Act 2023 §16 — Right to Access / Data Portability
//
// Returns a JSON file containing all personal data held for the
// authenticated user: profile, saved addresses, order history, Pahadi Coins
// balance + transactions, wishlist, notification preferences and returns.
//
// Rate limit: 3 exports per 24 hours per account (shared across instances)
// plus a per-instance IP guard (download is heavy).
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { clientIpKey } from '@/lib/api/clientIp'
import { evidenceReadLinks } from '@/lib/server/returnEvidence'
import {
  ok, fail,
  sbAuth, sbAdmin,
  getToken, tryRefresh,
  checkRateLimitShared,
  checkCsrf,
  applyNewCookies,
} from '@/lib/api/serverUtils'

export async function GET(req: NextRequest) {
  // ── CSRF check ────────────────────────────────────────────────
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  // ── Per-IP guard (per instance) ──────────────────────────────
  // A DoS guard only: it counts every attempt, so it is generous. The real "3 exports per 24 h" quota is per ACCOUNT
  // (shared) and is consumed only by an export that actually succeeds (see below).
  const ip = clientIpKey(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip'))   // IPv6 -> its /64
  if (!await checkRateLimitShared(`data_export_ip:${ip}`, 30, 60 * 60_000)) {
    return fail(429, 'Too many export requests — please try again later.', { 'Retry-After': '3600' })
  }

  // ── Auth ──────────────────────────────────────────────────────
  let token      = getToken(req)
  const refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  try {
    // ── Resolve user ─────────────────────────────────────────────
    const user = await sbAuth('/user', null, token!)
    const userId = user.id as string

    // NOTE: no `.catch(() => [])` anywhere below. A transient DB error used to produce HTTP 200 with empty sections AND
    // burn one of the 3 exports. Any failing section now fails the whole request (5xx) before the quota is touched.
    const customers = await sbAdmin(
      'GET',
      `/rest/v1/customers?auth_user_id=eq.${userId}&select=*&limit=1`,
    )
    const customer = customers?.[0] ?? null
    const customerId = customer?.id

    // Pages through PostgREST (its server-side max-rows is 1000) so the export is complete, not silently capped.
    const PAGE = 1000
    const fetchAll = async (path: string): Promise<Array<Record<string, unknown>>> => {
      const out: Array<Record<string, unknown>> = []
      for (let offset = 0; offset < 100_000; offset += PAGE) {
        const rows = await sbAdmin('GET', `${path}&limit=${PAGE}&offset=${offset}`)
        if (!Array.isArray(rows)) throw new Error('unexpected PostgREST response')
        out.push(...rows)
        if (rows.length < PAGE) return out
      }
      throw new Error('export too large')
    }
    const chunks = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

    const savedAddresses = customerId
      ? await sbAdmin('GET', `/rest/v1/saved_addresses?customer_id=eq.${customerId}&select=label,name,phone,addr,city,state,pin,created_at&order=created_at.asc`)
      : []

    // Orders: explicit whitelist of the customer's own data. `notes` is what the customer wrote at checkout;
    // admin_notes / cost / margin columns are internal and are never exported.
    const orders = customerId
      ? await fetchAll(`/rest/v1/orders?customer_id=eq.${customerId}&select=id,order_number,order_status,payment_status,total_amount,created_at,shipping_address,notes&order=created_at.desc,id.desc`)
      : []
    const orderIds = orders.map(o => o.id as string | number)

    const [loyaltyTransactions, wishlistRows, orderItemRows, returnsRows, referrerRows, subscriberRows] = customerId
      ? await Promise.all([
          fetchAll(`/rest/v1/loyalty_transactions?customer_id=eq.${customerId}&select=type,points,balance_after,note,order_id,created_at&order=created_at.desc,id.desc`),
          sbAdmin('GET', `/rest/v1/wishlist?customer_id=eq.${customerId}&select=product_id,created_at`),
          Promise.all(chunks(orderIds, 100).map(ids => fetchAll(`/rest/v1/order_items?order_id=in.(${ids.join(',')})&select=order_id,product_id,quantity,price_at_time,product_name_snapshot,variant_value_snapshot,sku_snapshot,gst_rate&order=id.asc`))).then(r => r.flat()),
          Promise.all(chunks(orderIds, 100).map(ids => fetchAll(`/rest/v1/returns?order_id=in.(${ids.join(',')})&select=id,order_number,customer_name,reason,description,status,resolution,refund_amount,photo_urls,created_at,updated_at&order=created_at.desc,id.desc`))).then(r => r.flat()),
          customer.referred_by != null
            ? sbAdmin('GET', `/rest/v1/customers?id=eq.${customer.referred_by}&select=referral_code&limit=1`)
            : Promise.resolve([]),
          customer.email
            ? sbAdmin('GET', `/rest/v1/subscribers?email=eq.${encodeURIComponent(String(customer.email).toLowerCase())}&select=name,email,is_active,source,created_at`)
            : Promise.resolve([]),
        ])
      : [[], [], [], [], [], []]

    const itemsByOrder = new Map<string, unknown[]>()
    for (const it of orderItemRows as Array<Record<string, unknown>>) {
      const { order_id, ...rest } = it
      const k = String(order_id)
      itemsByOrder.set(k, [...(itemsByOrder.get(k) ?? []), rest])
    }

    // ── Build export payload ──────────────────────────────────────
    const exportData = {
      exported_at:       new Date().toISOString(),
      dpdp_act_section:  '§16 — Right of Access / Data Portability',
      profile: customer ? {
        first_name:    customer.first_name,
        last_name:     customer.last_name,
        email:         customer.email,
        phone:         customer.phone,
        address_line1: customer.address_line1,
        address_line2: customer.address_line2,
        city:          customer.city,
        state:         customer.state,
        pincode:       customer.pincode,   // was `postal_code` — no such column, so it exported blank (ACC-039)
        gstin:         customer.gstin,
        is_business:   customer.is_business,
        created_at:    customer.created_at,
      } : null,
      referral: customer ? {
        your_referral_code: customer.referral_code,
        referred_by_code:   (referrerRows as Array<{ referral_code?: string }>)[0]?.referral_code ?? null,
      } : null,
      consent: customer ? {
        order_emails:       customer.notif_email_orders,
        order_whatsapp:     customer.notif_whatsapp_orders,
        order_sms:          customer.notif_sms_orders,
        marketing_emails:   customer.notif_email_marketing,
        newsletter_records: subscriberRows,
      } : null,
      notification_preferences: customer ? {
        order_emails:     customer.notif_email_orders,
        order_whatsapp:   customer.notif_whatsapp_orders,
        order_sms:        customer.notif_sms_orders,
        marketing_emails: customer.notif_email_marketing,
      } : null,
      pahadi_coins: customer ? {
        balance:      customer.loyalty_points,
        transactions: loyaltyTransactions,
      } : null,
      // BUG FIX (Nov 2026 verification): the live wishlist is customers.wishlist_items (JSON text, see /api/wishlist); the
      // `wishlist` table only holds legacy rows. Both are exported, de-duplicated.
      wishlist_product_ids: Array.from(new Set([
        ...parseWishlistItems(customer?.wishlist_items),
        ...(Array.isArray(wishlistRows) ? wishlistRows.map((w: { product_id: number }) => Number(w.product_id)) : []),
      ].filter(n => Number.isFinite(n)))),
      // Return photos: stored as object paths of the private bucket; each export mints links that live 15 minutes (L-8).
      returns: await Promise.all(returnsRows.map(async r => ({
        ...r,
        photo_urls: await evidenceReadLinks(r.photo_urls, { url: process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey: process.env.SUPABASE_SERVICE_KEY! }),
      }))),
      reviews: {
        note: 'Product reviews are public once approved and show your first name and last initial. Reviews written before verified-purchase reviews were introduced are not linked to your account and cannot be listed here automatically. If you delete your account your reviews stay (rating and text) under the name Anonymous customer. Contact support to find or remove a review you wrote.',
      },
      auth: {
        email:      user.email,
        phone:      user.phone,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
      },
      saved_addresses: savedAddresses,
      orders: orders.map(o => ({ ...o, items: itemsByOrder.get(String(o.id)) ?? [] })),
    }

    // Count the quota only now that the whole export was built successfully (per ACCOUNT, shared across instances;
    // ACC-041: the in-process limiter was never really enforced).
    if (!await checkRateLimitShared(`data_export:${userId}`, 3, 24 * 60 * 60_000)) {
      return fail(429, 'Too many export requests — please wait 24 hours.', { 'Retry-After': String(24 * 60 * 60) })
    }

    // ── Return as downloadable JSON file ──────────────────────────
    const json = JSON.stringify(exportData, null, 2)
    const res = new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type':        'application/json',
        'Content-Disposition': 'attachment; filename="pahadiroots-my-data.json"',
        'Cache-Control':       'no-store',
      },
    })
    // SEC-FIX: if the token was silently refreshed via tryRefresh(), the new
    // access + refresh tokens must be written back into the httpOnly cookies.
    // Without this call the refreshed tokens are discarded — the next request
    // finds a stale cookie, tryRefresh() runs again (wasting a Supabase call),
    // and eventually the refresh token itself expires, logging the user out.
    if (refreshed) applyNewCookies(res, refreshed.token, refreshed.refresh)
    return res
  } catch (e: unknown) {
    console.error('[data-export] Failed:', e)
    const err = e as { status?: number }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    return fail(500, 'Could not export your data — please try again. This attempt did not count towards your export limit.')
  }
}

/** customers.wishlist_items is a TEXT column holding a JSON array of product ids (legacy rows may be null or malformed). */
function parseWishlistItems(raw: unknown): number[] {
  if (raw == null || raw === '') return []
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(v) ? v.map(x => Number(x)).filter(n => Number.isFinite(n)) : []
  } catch { return [] }
}
