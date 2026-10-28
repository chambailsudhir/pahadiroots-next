// ─────────────────────────────────────────────────────────────
// /api/v1/orders/track — public "Track Your Order" lookup by
// order_number + phone (src/app/track/page.tsx)
//
// BUG FIX (found while investigating "the /track page looks fake, is it even
// working"): track/page.tsx used to query `orders` DIRECTLY from the browser
// with the public anon Supabase client:
//
//     supabase.from('orders').select('order_number, order_status, ...')
//       .eq('order_number', ...).eq('customer_phone', ...).single()
//
// That's a real, unmitigated infra gap, not a cosmetic bug — RLS policies
// restrict which ROWS a query can see, not which COLUMNS come back for a row
// it's allowed to see. So exactly one of two things was true in production,
// and both are bad:
//
//   1. RLS on `orders` has no anon SELECT policy → every tracking attempt
//      returns zero rows regardless of whether the order is real, so the
//      page LOOKS broken/fake for every legitimate customer (this matches
//      exactly what was reported).
//   2. RLS DOES allow anon SELECT (to make the page's own query work) → the
//      public anon key (shipped in the JS bundle, visible to anyone) could
//      then be used to query the orders table directly via Supabase's REST
//      API with `select=*`, bypassing this page's column list entirely and
//      exposing every customer's full order history — a real PII leak, not
//      a hypothetical one.
//
// This repo already has the correct pattern for exactly this kind of public,
// unauthenticated order lookup — /api/v1/orders/lookup (guest confirmation-
// token flow). This route follows the same shape: the DB is only ever
// touched with the service-role key, from the server, and the match
// (order_number + phone) is verified server-side before anything is
// returned. The anon key is never involved, so RLS on `orders` can (and
// should) stay locked down to deny anon access entirely.
//
// Rate limiting: phone is only 10 digits — small enough to be brute-forced
// against a single KNOWN order_number if unlimited attempts were allowed.
// Limited per-order_number (not just per-IP) for that reason, same
// defence-in-depth reasoning as the coupon-code and OTP rate limits
// elsewhere in this app.
// ─────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { ok, fail, sbAdmin } from '@/lib/api/serverUtils'
import { checkRateLimitKv } from '@/lib/api/rateLimitKv'

// Deliberately minimal — this is a PUBLIC, unauthenticated endpoint. No
// address, no items, no customer name/email — just enough for the status
// stepper the /track page renders. Anyone with a valid order_number+phone
// pair gets this; anything more sensitive belongs behind the
// token/session-gated /api/v1/orders/lookup instead.
const TRACK_SELECT = 'order_number,order_status,payment_method,created_at,total_amount'

// AUDIT S1-007 / S2-002: `orders` has NO customer_phone column (it was removed
// — orders.customer_id → customers.phone; see db_migration.sql:10, SETUP.md
// "Troubleshooting"). The old query filtered on `customer_phone=eq.…`, so
// PostgREST answered 400 for every real order, `.catch(() => null)` turned
// that into the uniform 404, and /track "failed closed" for every customer.
// The phone is now resolved in two steps — order by order_number, then the
// linked customers.phone (shipping_address->>'phone' as a fallback for guest
// orders with no customer row) — and compared server-side after the same
// last-10-digit normalisation the rest of the app uses. The fetch below adds
// only the columns needed for that resolution; TRACK_SELECT is still the only
// thing that leaves the server. orderTrackColumnContract.test.ts guards the
// column names against the live schema list.
const TRACK_FETCH_SELECT = `${TRACK_SELECT},customer_id,shipping_address`

/** Last 10 digits of whatever the DB stored ('+91 98765-43210' → '9876543210'). */
function normalizePhone(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const digits = String(v).replace(/\D/g, '').slice(-10)
  return digits.length === 10 ? digits : null
}

async function fetchCustomerPhone(customerId: unknown): Promise<string | null> {
  if (customerId == null || customerId === '') return null
  const rows = await sbAdmin(
    'GET',
    `/rest/v1/customers?id=eq.${encodeURIComponent(String(customerId))}&select=phone&limit=1`,
  ).catch(() => null)
  if (!Array.isArray(rows) || rows.length === 0) return null
  return normalizePhone((rows[0] as { phone?: unknown }).phone)
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!await checkRateLimitKv(`mw:rl:order_track_ip:${ip}`, 20)) {
    return fail(429, 'Too many requests — please wait a moment')
  }

  const { searchParams } = new URL(req.url)
  const orderNumber = searchParams.get('order_number')?.trim().toUpperCase()
  const phoneRaw     = searchParams.get('phone')?.trim()
  if (!orderNumber || !phoneRaw) return fail(400, 'order_number and phone are required')

  // Defence in depth — reject anything outside the expected order-number
  // shape before it ever reaches a PostgREST filter string (same guard as
  // /api/v1/orders/lookup).
  if (!/^[A-Za-z0-9-]{4,32}$/.test(orderNumber)) return fail(404, 'Order not found')

  const phone = phoneRaw.replace(/\D/g, '').slice(-10)
  if (phone.length !== 10) return fail(400, 'Enter a valid 10-digit mobile number')

  // Per-order_number limit — the actually-meaningful guard against
  // brute-forcing the phone digits for one specific known order. Tighter
  // than the per-IP limit above on purpose.
  if (!await checkRateLimitKv(`mw:rl:order_track_num:${orderNumber}`, 8, 300)) {
    return fail(429, 'Too many attempts for this order — please wait a few minutes')
  }

  try {
    const rows = await sbAdmin(
      'GET',
      `/rest/v1/orders?order_number=eq.${encodeURIComponent(orderNumber)}&select=${TRACK_FETCH_SELECT}&limit=1`,
    ).catch(() => null)

    // Uniform message for "no such order" AND "phone doesn't match" — same
    // reasoning as /api/v1/orders/lookup: distinguishing the two would let
    // an attacker confirm a guessed order_number is real even without the
    // matching phone.
    const NOT_FOUND = 'Order not found. Check your order number and phone number.'
    if (!Array.isArray(rows) || rows.length === 0) return fail(404, NOT_FOUND)

    const raw = rows[0] as Record<string, unknown>

    // AUDIT S1-007 / S2-002: phone match via customers.phone (orders.customer_id),
    // falling back to the phone snapshotted in shipping_address. Both are
    // normalised to the last 10 digits before comparing. An order with no
    // resolvable phone at all can never be tracked here (fails closed).
    const customerPhone = await fetchCustomerPhone(raw.customer_id)
    const shipping      = raw.shipping_address as { phone?: unknown } | null | undefined
    const shippingPhone = normalizePhone(shipping && typeof shipping === 'object' ? shipping.phone : null)
    const matches = (customerPhone !== null && customerPhone === phone)
                 || (shippingPhone !== null && shippingPhone === phone)
    if (!matches) return fail(404, NOT_FOUND)
    const res = ok({
      success: true,
      order: {
        order_number:   raw.order_number,
        order_status:   raw.order_status,
        payment_method: raw.payment_method,
        created_at:     raw.created_at,
        total_amount:   raw.total_amount != null ? Number(raw.total_amount) : undefined,
      },
    })
    res.headers.set('Cache-Control', 'private, no-store')
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    return fail(err.status && err.status < 500 ? err.status : 500, 'Order lookup failed')
  }
}
