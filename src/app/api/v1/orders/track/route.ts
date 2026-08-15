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
      `/rest/v1/orders?order_number=eq.${encodeURIComponent(orderNumber)}&customer_phone=eq.${encodeURIComponent(phone)}&select=${TRACK_SELECT}&limit=1`,
    ).catch(() => null)

    if (!Array.isArray(rows) || rows.length === 0) {
      // Uniform message for "no such order" AND "phone doesn't match" — same
      // reasoning as /api/v1/orders/lookup: distinguishing the two would let
      // an attacker confirm a guessed order_number is real even without the
      // matching phone.
      return fail(404, 'Order not found. Check your order number and phone number.')
    }

    const raw = rows[0] as Record<string, unknown>
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
