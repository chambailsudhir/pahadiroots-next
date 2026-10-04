// ─────────────────────────────────────────────────────────────────────────────
// lib/server/razorpay.ts
//
// Shared server-side Razorpay helpers used by /api/v1/payments (verify_payment)
// and /api/v1/webhook/razorpay.
//
// Marked `server-only` so Razorpay credentials can never reach a client bundle.
// ─────────────────────────────────────────────────────────────────────────────
import 'server-only'
import crypto from 'crypto'

/** Subset of the Razorpay payment entity we rely on. */
export interface RazorpayPaymentEntity {
  id:        string
  order_id?: string | null
  amount:    number           // paise
  currency?: string
  status:    string           // created | authorized | captured | refunded | failed
  notes?:    { db_order_id?: string } | unknown[] | null
}

/**
 * Constant-time string comparison for signatures / HMAC digests.
 * `a !== b` short-circuits on the first differing byte and leaks timing.
 * Returns false (never throws) when lengths differ.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

/** Razorpay order IDs always look like `order_XXXXXXXX`. */
export function isRazorpayOrderId(v: unknown): v is string {
  return typeof v === 'string' && /^order_[A-Za-z0-9_]+$/.test(v)
}

/**
 * Fetch a payment straight from Razorpay (GET /v1/payments/:id).
 *
 * The HMAC on the checkout callback only proves "Razorpay issued this
 * (order_id, payment_id) pair". It says nothing about how much was paid, or
 * whether the payment is actually captured. This call is the independent,
 * server-to-server source of truth for both.
 *
 * Throws on network/API failure so the caller can fail CLOSED (never confirm
 * an order it could not verify).
 */
export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPaymentEntity> {
  const keyId     = process.env.RAZORPAY_KEY_ID?.trim()
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim()
  if (!keyId || !keySecret) {
    throw new Error('Razorpay keys not configured — add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel env vars')
  }
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64')
  const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    method:  'GET',
    headers: { 'Authorization': `Basic ${credentials}` },
    signal:  AbortSignal.timeout(8_000),
  })
  if (!res.ok) {
    const err  = await res.json().catch(() => ({ error: { description: res.statusText } }))
    const desc = err?.error?.description || JSON.stringify(err)
    throw new Error(`Razorpay payment fetch failed (${res.status}): ${desc}`)
  }
  return res.json() as Promise<RazorpayPaymentEntity>
}

/**
 * List every payment attempt Razorpay holds for one Razorpay ORDER
 * (GET /v1/orders/:id/payments). Used by the pending-order expiry sweep to ask
 * "was this order actually paid?" before releasing its stock — the source of truth
 * when a webhook or the browser callback was lost.
 *
 * Throws on any failure so the caller can skip (never release on uncertainty).
 */
export async function fetchRazorpayOrderPayments(razorpayOrderId: string): Promise<RazorpayPaymentEntity[]> {
  const keyId     = process.env.RAZORPAY_KEY_ID?.trim()
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim()
  if (!keyId || !keySecret) {
    throw new Error('Razorpay keys not configured — add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel env vars')
  }
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64')
  const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpayOrderId)}/payments`, {
    method:  'GET',
    headers: { 'Authorization': `Basic ${credentials}` },
    signal:  AbortSignal.timeout(8_000),
  })
  if (!res.ok) {
    const err  = await res.json().catch(() => ({ error: { description: res.statusText } }))
    const desc = err?.error?.description || JSON.stringify(err)
    throw new Error(`Razorpay order payments fetch failed (${res.status}): ${desc}`)
  }
  const body = await res.json() as { items?: RazorpayPaymentEntity[] }
  return Array.isArray(body.items) ? body.items : []
}

export type PaymentCheck =
  | { ok: true }
  | { ok: false; reason: 'not_captured' | 'order_mismatch' | 'amount_mismatch' | 'currency_mismatch'; detail: string }

/**
 * Validate a Razorpay payment against OUR order: it must belong to the expected
 * Razorpay order, be captured, be in INR, and match the DB total to the paisa.
 */
export function checkPaymentAgainstOrder(
  payment: RazorpayPaymentEntity,
  expected: { razorpayOrderId: string; totalAmountInr: number },
): PaymentCheck {
  if (payment.order_id !== expected.razorpayOrderId) {
    return { ok: false, reason: 'order_mismatch', detail: `payment.order_id=${payment.order_id ?? 'null'}` }
  }
  if ((payment.currency ?? 'INR') !== 'INR') {
    return { ok: false, reason: 'currency_mismatch', detail: `currency=${payment.currency}` }
  }
  const expectedPaise = Math.round(Number(expected.totalAmountInr) * 100)
  if (!Number.isFinite(expectedPaise) || payment.amount !== expectedPaise) {
    return { ok: false, reason: 'amount_mismatch', detail: `paid=${payment.amount} expected=${expectedPaise}` }
  }
  if (payment.status !== 'captured') {
    return { ok: false, reason: 'not_captured', detail: `status=${payment.status}` }
  }
  return { ok: true }
}
