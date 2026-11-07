import { z } from 'zod'
import { MAX_LINE_QTY } from '@/lib/cartLimits'

// Strict CSP on /checkout and /account forbids eval. Zod 4 probes `Function("")` at first use to decide whether it may
// JIT-compile parsers; the probe itself is reported as a CSP violation. jitless skips the probe (and the JIT).
z.config({ jitless: true })
import { INDIA_STATES } from '@/lib/account/constants'
import { pinProblem } from '@/lib/pinState'

// GST depends on the delivery state (same state as the seller = CGST + SGST, otherwise IGST), so the
// server accepts only a real Indian state or union territory and stores its canonical spelling. The
// checkout form already offers a dropdown, but a direct API call or an old saved address could send free
// text such as "Utter prades", which silently broke the GST split.
const STATE_LOOKUP = new Map<string, string>(INDIA_STATES.map(s => [s.toLowerCase(), s]))

// ─── Address Schema ────────────────────────────────────────────────────────────

export const addressSchema = z.object({
  name:    z.string().trim().min(2).max(100),
  phone:   z.string().trim().regex(/^[6-9]\d{9}$/, 'Invalid Indian mobile number'),
  flat:    z.string().trim().min(1).max(200),
  area:    z.string().trim().max(200).optional().default(''),
  city:    z.string().trim().min(2).max(100),
  state:   z.string().trim().min(2).max(100).transform((v, ctx) => {
    const canonical = STATE_LOOKUP.get(v.toLowerCase())
    if (!canonical) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Select a valid Indian state or union territory' })
      return z.NEVER
    }
    return canonical
  }),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Invalid 6-digit pincode'),
  label:   z.enum(['Home', 'Office', 'Parents', 'Friends', 'Others']).optional(),
}).superRefine((a, ctx) => {
  // CHK-001 (Nov 2026 audit): reject non-existent / non-deliverable PINs and a PIN that contradicts the state.
  // Authoritative copy of the check the checkout form runs for fast feedback. See lib/pinState.ts.
  const problem = pinProblem(a.pincode, a.state)
  if (problem) ctx.addIssue({ code: 'custom', path: ['pincode'], message: problem })
})

// ─── Order Schema ──────────────────────────────────────────────────────────────

// PS1: product/variant ids are interpolated into PostgREST filters (id=in.(...)) by
// createOrder, so they must be plain identifiers (numeric ids or UUIDs). Anything with
// commas, parentheses, dots or quotes could change the meaning of that filter.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
export const orderItemSchema = z.object({
  productId:  z.string().regex(SAFE_ID, 'Invalid product id'),
  variantId:  z.string().regex(SAFE_ID, 'Invalid variant id'),
  qty:        z.number().int().min(1).max(MAX_LINE_QTY),
})

export const createOrderSchema = z.object({
  address:                addressSchema,
  // BUG FIX: no uniqueness check on variantIds.  A client could submit two items
  // with the same variantId (e.g. qty=2 and qty=3 for the same variant).  Each
  // item passes the per-item schema, but createOrder() processes them separately:
  //   • reserveStockAtomicForOrder() decrements stock TWICE (stock goes negative)
  //   • create_order_with_items RPC inserts TWO order_items rows for the variant
  //   • the customer is charged for both quantities individually (correct total
  //     amount but inflated shipping and loyalty calculations can diverge)
  // Fix: superRefine rejects any payload where the same variantId appears more
  // than once.  The client should merge duplicate items into a single item with
  // a combined qty before submitting.
  items: z.array(orderItemSchema).min(1).max(30).superRefine((items, ctx) => {
    const seen = new Set<string>()
    items.forEach((item, i) => {
      if (seen.has(item.variantId)) {
        ctx.addIssue({
          code:    z.ZodIssueCode.custom,
          path:    [i, 'variantId'],
          message: `Duplicate variantId "${item.variantId}" — merge into a single item`,
        })
      }
      seen.add(item.variantId)
    })
  }),
  payment_method:         z.enum(['razorpay', 'cod']),
  coupon_code:            z.string().trim().max(50).optional(),
  idempotency_key:        z.string().uuid(),
  customer_email:         z.string().email().optional().or(z.literal('')),
  // ── Loyalty coins ────────────────────────────────────────────────────────
  loyalty_points_redeemed: z.number().int().min(0).max(100_000).optional().default(0),
  // Nov 2026: token from /api/v1/cod-verify/confirm for a risky COD order (see lib/server/codVerification.ts).
  cod_verification_token:  z.string().max(200).optional(),
})

// ─── Payment Schema ────────────────────────────────────────────────────────────
// BUG FIX: all fields were z.string() with no length or format constraints.
// An attacker could send arbitrarily long strings into the HMAC computation.
// Added explicit caps and a regex on razorpay_signature (SHA-256 = 64 hex chars).
export const verifyPaymentSchema = z.object({
  razorpay_order_id:   z.string().min(1).max(64),
  razorpay_payment_id: z.string().min(1).max(64),
  // SHA-256 HMAC digest is always exactly 64 lowercase hex characters
  razorpay_signature:  z.string().regex(/^[0-9a-f]{64}$/, 'Invalid signature format'),
  order_id:            z.string().min(1).max(50),
})

// ─── Coupon Schema ─────────────────────────────────────────────────────────────

export const validateCouponSchema = z.object({
  code:     z.string().trim().min(1).max(50),
  // BUG FIX: subtotal had no upper bound — a client could send Number.MAX_SAFE_INTEGER.
  // That value flows into `Math.round(subtotal * data.value / 100)` inside
  // validateCouponServer, producing a discount equal to MAX_SAFE_INTEGER (when
  // max_discount is null it falls back to subtotal).  That discount then reaches
  // calcPriceSummary where `afterDiscount = Math.max(0, subtotal - discount - loyalty)`
  // = 0, making the entire order total equal to just the shipping charge regardless
  // of actual order value.  Cap at 1,000,000 (₹10 lakh) — well above any realistic
  // single order while still defending against arithmetic abuse.
  subtotal: z.number().positive().max(1_000_000),
  // Optional — lets the client-facing pre-check apply the per-customer
  // limit (coupons.user_limit) before order creation, not just at final
  // submit. Not required: on the cart page (before an address/phone is
  // known) this is simply omitted and the check is skipped here — the
  // authoritative enforcement in orderService.createOrder still catches
  // it at order time regardless of whether this pre-check ran it.
  phone: z.string().trim().max(20).optional(),
  // Nov 2026 ("one person / one address"): checkout also tells the pre-check WHERE it is delivering so a one-time coupon already used
  // at this address is refused early. Lenient on purpose — a half-typed value must never turn into a 400 that strips a valid coupon.
  pincode: z.string().trim().max(10).optional(),
  address: z.string().trim().max(400).optional(),
  // Per-line amounts so a coupon limited to certain categories is previewed on the eligible lines only (as createOrder does).
  // Optional and lenient: an old client that omits it just gets the whole-cart preview; createOrder stays authoritative.
  lines: z.array(z.object({ productId: z.union([z.string().max(64), z.number()]), amount: z.number().min(0).max(1_000_000) })).max(100).optional(),
})

// ─── Review Schema ─────────────────────────────────────────────────────────────

export const reviewSchema = z.object({
  // BUG FIX: was `z.string().min(1)`, left over from when reviews.product_id
  // was mistakenly `uuid` in the DB (fixed via migration to match products.id,
  // which is `bigint`). Matches notifyStockSchema's product_id validation.
  product_id:    z.number().int().positive(),
  // Verified-purchase reviews (Nov 2026): the order that contained the product. The customer and the public display
  // name are NEVER taken from the body - the server builds them from the session.
  order_id:      z.coerce.number().int().positive(),
  rating:        z.number().int().min(1).max(5),
  // Tags are stripped and the text trimmed/capped at 1000 server-side; this bound only refuses absurd bodies.
  comment:       z.string().max(5000).optional(),
})

// ─── Stock Notification Schema ──────────────────────────────────────────────
// BUG FIX (P1, homepage audit): backs the "Notify Me" button on out-of-stock
// products (ProductCard.tsx), which previously had no capture mechanism at
// all — see db_migration_v10_stock_notifications.sql for the table this
// validates input for.
export const notifyStockSchema = z.object({
  email:      z.string().email().toLowerCase().trim(),
  product_id: z.number().int().positive(),
})

// ─── Abandoned Cart Schemas ─────────────────────────────────────────────────
// Backs the checkout-side cart-abandonment capture (CheckoutClient.tsx debounced
// save) and the order-success conversion mark. One row per browsing session —
// see analytics_sessions.session_id / abandoned_carts.session_id.
export const abandonedCartItemSchema = z.object({
  product_id: z.number().int().positive().optional(),
  name:       z.string().trim().max(200),
  qty:        z.number().int().positive(),
  price:      z.number().nonnegative(),
})

// A cart-draft session id is an unguessable random id minted in the browser (a UUID). Requiring a real-length id means nobody can
// target another visitor's draft with a short guessable value (audit C-11).
const CART_SESSION_ID = z.string().trim().regex(/^[A-Za-z0-9_-]{16,100}$/, 'invalid session id')

export const saveAbandonedCartSchema = z.object({
  session_id: CART_SESSION_ID,
  email:      z.string().email().toLowerCase().trim().optional(),
  phone:      z.string().trim().max(20).optional(),
  name:       z.string().trim().max(100).optional(),
  items:      z.array(abandonedCartItemSchema).min(1).max(50),
  cart_total: z.number().nonnegative(),
}).refine(d => !!d.email || !!d.phone, { message: 'email or phone required' })

export const markCartConvertedSchema = z.object({
  session_id: CART_SESSION_ID,
})

// ─── Search Schema ─────────────────────────────────────────────────────────────
export const searchSchema = z.object({
  q:      z.string().trim().min(1).max(100),
  limit:  z.number().int().min(1).max(48).optional().default(24),
  offset: z.number().int().min(0).optional().default(0),
})
