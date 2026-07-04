// ─────────────────────────────────────────────────────────────
// /api/v1/orders/lookup — order-success confirmation page data source
//
// BUG FIX (found via production console 404s): order-success/page.tsx used
// to POST to /api/admin-api — the OLD vanilla-site's API path, never ported
// to this Next.js app. It always 404'd, on every single order, so the
// "rich" order status view (items, tracking, status stepper) never once
// rendered in production. This route replaces it.
//
// Auth model (same pattern Amazon/Myntra use for guest order-confirmation
// pages): a guest checkout has no login session, so this can't rely on
// cookie auth alone — and order_number is a short, human-readable string
// (e.g. "PRMR4OEQ") that must NEVER be treated as a secret. Two paths:
//
//   1. GUEST (token): ?order_number=X&token=Y — Y must match the random,
//      cryptographically-secure confirmation_token generated at order
//      creation (see db_migration_v6_order_confirmation_token.sql and
//      orderService.ts's createOrder()). Both order_number AND token must
//      match the SAME row — a token alone isn't enough, closing off any
//      chance of one leaked token being replayed against a different order.
//   2. LOGGED-IN (session): valid cookie session, order's customer_id
//      matches the session's profile — same IDOR guard already proven in
//      /api/orders/[id]/route.ts, reused here.
//
// If NEITHER path succeeds, this returns 404 uniformly for "doesn't exist"
// AND "exists but you're not authorized" — unlike /api/orders/[id], which
// can safely return 403 for a real DB id, this endpoint is keyed by a
// guessable order_number, so revealing "yes that order exists" to a failed
// token/session check would itself be an information leak (enables
// order_number enumeration). A rate limit on top makes token-guessing
// computationally infeasible even before considering the identical response.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAdmin,
  getToken, tryRefresh, sbAuth,
  syncCustomerProfile,
  applyNewCookies,
} from '@/lib/api/serverUtils'
import { checkRateLimitKv } from '@/lib/api/rateLimitKv'

// Same join shape as /api/orders/[id]/route.ts — proven, already in
// production use for the logged-in "my orders" detail view.
const ORDER_SELECT =
  '*,order_items(quantity,price_at_time,product_name_snapshot,variant_value_snapshot,product_id,products(name,emoji,image_url))'

interface RawOrderItem {
  quantity:               number
  price_at_time:          number
  product_name_snapshot:  string | null
  variant_value_snapshot: string | null
  product_id:             string | null
  products?: { name?: string; emoji?: string; image_url?: string }
}

function mapOrder(raw: Record<string, unknown>, customer: { first_name?: string; last_name?: string; phone?: string } | null) {
  const rawItems = (raw.order_items as RawOrderItem[]) || []
  const items = rawItems.map(i => ({
    name:           i.product_name_snapshot || i.products?.name || 'Product',
    variant_value:  i.variant_value_snapshot || undefined,
    emoji:          i.products?.emoji     || '🌿',
    image_url:      i.products?.image_url || undefined,
    qty:            i.quantity,
    quantity:       i.quantity,
    price:          i.price_at_time,
    price_at_time:  i.price_at_time,
  }))

  let shippingAddress: Record<string, string> | undefined
  const rawAddr = raw.shipping_address
  if (rawAddr && typeof rawAddr === 'object' && !Array.isArray(rawAddr)) {
    shippingAddress = rawAddr as Record<string, string>
  } else if (typeof rawAddr === 'string') {
    try { shippingAddress = JSON.parse(rawAddr) } catch { /* leave undefined */ }
  }

  const customerName = customer
    ? [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() || undefined
    : undefined

  // Deliberately NOT included: customer_id, idempotency_key, payment_id,
  // confirmation_token itself, or any other internal-only field.
  return {
    order_number:     raw.order_number,
    order_status:     raw.order_status,
    payment_status:   raw.payment_status,
    payment_method:   raw.payment_method,
    total_amount:     raw.total_amount   != null ? Number(raw.total_amount)   : undefined,
    subtotal:         raw.subtotal       != null ? Number(raw.subtotal)       : undefined,
    discount_amount:  raw.coupon_discount != null ? Number(raw.coupon_discount) : undefined,
    shipping_charge:  raw.shipping_charge != null ? Number(raw.shipping_charge) : undefined,
    tax:              raw.tax            != null ? Number(raw.tax)            : undefined,
    created_at:       raw.created_at,
    tracking_number:  raw.tracking_number ?? undefined,
    courier:          raw.courier         ?? undefined,
    customer_name:    customerName,
    customer_phone:   customer?.phone ?? undefined,
    delivery_address: shippingAddress?.address_line1,
    city:             shippingAddress?.city,
    state:            shippingAddress?.state,
    pincode:          shippingAddress?.pincode,
    items,
  }
}

// Best-effort, separate lookup — the order/items fetch above is proven and
// must never be put at risk by an unconfirmed orders→customers FK-embed
// relationship. If this fails for any reason, mapOrder() just omits
// customer_name/customer_phone (the UI already renders '—' gracefully for
// both — see order-success/page.tsx).
async function fetchCustomer(customerId: unknown): Promise<{ first_name?: string; last_name?: string; phone?: string } | null> {
  if (!customerId) return null
  const rows = await sbAdmin(
    'GET',
    `/rest/v1/customers?id=eq.${encodeURIComponent(String(customerId))}&select=first_name,last_name,phone&limit=1`,
  ).catch(() => null)
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!await checkRateLimitKv(`mw:rl:order_lookup_ip:${ip}`, 20)) {
    return fail(429, 'Too many requests — please wait a moment')
  }

  const { searchParams } = new URL(req.url)
  const orderNumber = searchParams.get('order_number')?.trim()
  const token       = searchParams.get('token')?.trim()
  if (!orderNumber) return fail(400, 'order_number is required')

  // BUG FIX (defence in depth): raw order_number interpolated into a
  // PostgREST filter string — reject anything outside the expected
  // alphanumeric order-number format before it ever reaches the query.
  if (!/^[A-Za-z0-9-]{4,32}$/.test(orderNumber)) return fail(404, 'Order not found')

  try {
    // ── Path 1: guest token ──────────────────────────────────────────────
    if (token && /^[0-9a-f-]{36}$/i.test(token)) {
      const rows = await sbAdmin(
        'GET',
        `/rest/v1/orders?order_number=eq.${encodeURIComponent(orderNumber)}&confirmation_token=eq.${encodeURIComponent(token)}&select=${ORDER_SELECT}&limit=1`,
      ).catch(() => null)

      if (Array.isArray(rows) && rows.length > 0) {
        const raw = rows[0] as Record<string, unknown>
        const customer = await fetchCustomer(raw.customer_id)
        const res = ok({ success: true, order: mapOrder(raw, customer) })
        ;(res as NextResponse).headers.set('Cache-Control', 'private, no-store')
        return res
      }
      // Token present but didn't match — fall through to try session auth
      // (e.g. a logged-in customer whose token expired/was omitted from a
      // shared link) before giving up. Does NOT reveal whether the order
      // exists at this point.
    }

    // ── Path 2: logged-in session (same IDOR guard as /api/orders/[id]) ──
    let sessToken = getToken(req)
    let refreshed = !sessToken ? await tryRefresh(req) : null
    if (sessToken || refreshed) {
      if (refreshed) sessToken = refreshed.token
      const user    = await sbAuth('/user', null, sessToken!).catch(() => null)
      const profile = user ? await syncCustomerProfile(user).catch(() => null) : null

      if (profile) {
        const rows = await sbAdmin(
          'GET',
          `/rest/v1/orders?order_number=eq.${encodeURIComponent(orderNumber)}&customer_id=eq.${profile.id}&select=${ORDER_SELECT}&limit=1`,
        ).catch(() => null)

        if (Array.isArray(rows) && rows.length > 0) {
          const raw = rows[0] as Record<string, unknown>
          const customer = await fetchCustomer(raw.customer_id)
          const res = ok({ success: true, order: mapOrder(raw, customer) })
          ;(res as NextResponse).headers.set('Cache-Control', 'private, no-store')
          if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
          return res
        }
      }
    }

    // Neither path authorized this request — uniform 404 (see file header
    // for why this must not distinguish "not found" from "not authorized").
    return fail(404, 'Order not found')

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    return fail(err.status && err.status < 500 ? err.status : 500, 'Order lookup failed')
  }
}
