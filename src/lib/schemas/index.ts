import { z } from 'zod'

// ─── Address Schema ────────────────────────────────────────────────────────────

export const addressSchema = z.object({
  name:    z.string().trim().min(2).max(100),
  phone:   z.string().trim().regex(/^[6-9]\d{9}$/, 'Invalid Indian mobile number'),
  flat:    z.string().trim().min(1).max(200),
  area:    z.string().trim().max(200).optional().default(''),
  city:    z.string().trim().min(2).max(100),
  state:   z.string().trim().min(2).max(100),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Invalid 6-digit pincode'),
  label:   z.enum(['Home', 'Office', 'Parents', 'Friends', 'Others']).optional(),
})

// ─── Order Schema ──────────────────────────────────────────────────────────────

export const orderItemSchema = z.object({
  productId:  z.string().min(1),
  variantId:  z.string().min(1),
  qty:        z.number().int().min(1).max(50),
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
})

// ─── Review Schema ─────────────────────────────────────────────────────────────

export const reviewSchema = z.object({
  product_id:    z.string().min(1),
  customer_name: z.string().trim().min(2).max(100),
  rating:        z.number().int().min(1).max(5),
  comment:       z.string().trim().max(1000).optional(),
  order_id:      z.string().min(1).optional(),
})

// ─── Newsletter Schema ─────────────────────────────────────────────────────────

export const newsletterSchema = z.object({
  email: z.string().email(),
  name:  z.string().trim().max(100).optional(),
})

// ─── Subscribe Schema (alias used by cart/route.ts and other routes) ──────────
export const subscribeSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  name:  z.string().trim().max(100).optional(),
})

// ─── Search Schema ─────────────────────────────────────────────────────────────
export const searchSchema = z.object({
  q:      z.string().trim().min(1).max(100),
  limit:  z.number().int().min(1).max(48).optional().default(24),
  offset: z.number().int().min(0).optional().default(0),
})
