// ─────────────────────────────────────────────────────────────
// orderService — DIFF / PATCH GUIDE for loyalty support
//
// File: src/lib/services/orderService.ts
//
// The createOrder INPUT interface needs ONE new optional field.
// The INSERT into orders needs TWO new columns.
// Find the sections marked below and apply the changes.
// ─────────────────────────────────────────────────────────────
//
// ── CHANGE 1 ── Add to CreateOrderInput interface ~line 135
// ─────────────────────────────────────────────────────────────
//
// BEFORE:
//   couponCode?:      string
//   idempotencyKey:   string
//
// AFTER:
//   couponCode?:             string
//   idempotencyKey:          string
//   loyaltyPointsRedeemed?:  number   // ← ADD THIS LINE
//
// ─────────────────────────────────────────────────────────────
// ── CHANGE 2 ── In calcPriceSummary call ~line 170
// ─────────────────────────────────────────────────────────────
//
// The pricingService already accepts loyaltyDiscount as 3rd arg.
// The createOrder call needs to convert points → ₹:
//
// BEFORE:
//   const pricing = calcPriceSummary(cartItems, settings, appliedCoupon)
//
// AFTER:
//   const loyaltyDiscount = Math.floor(
//     (input.loyaltyPointsRedeemed ?? 0) *
//     parseFloat(settings.loyalty_points_value || '0.25')
//   )
//   const pricing = calcPriceSummary(cartItems, settings, appliedCoupon, input.paymentMethod, loyaltyDiscount)
//
// ─────────────────────────────────────────────────────────────
// ── CHANGE 3 ── In the orders INSERT ~line 225
// ─────────────────────────────────────────────────────────────
//
// BEFORE:
//   .insert({
//     order_number:    orderNumber,
//     customer_id:     custId,
//     total_amount:    pricing.total,
//     subtotal:        pricing.subtotal,
//     coupon_discount: pricing.discount,
//     tax:             pricing.gstTotal,
//     shipping_charge: pricing.shipping,
//     order_status:    'pending',
//     payment_status:  'pending',
//     payment_method:  input.paymentMethod,
//     idempotency_key: input.idempotencyKey,
//   })
//
// AFTER:
//   .insert({
//     order_number:            orderNumber,
//     customer_id:             custId,
//     total_amount:            pricing.total,
//     subtotal:                pricing.subtotal,
//     coupon_discount:         pricing.discount,
//     tax:                     pricing.gstTotal,
//     shipping_charge:         pricing.shipping,
//     order_status:            'pending',
//     payment_status:          'pending',
//     payment_method:          input.paymentMethod,
//     idempotency_key:         input.idempotencyKey,
//     loyalty_points_redeemed: input.loyaltyPointsRedeemed ?? 0,   // ← ADD
//   })
//
// ─────────────────────────────────────────────────────────────
// ── CHANGE 4 ── Return customerId alongside order
// ─────────────────────────────────────────────────────────────
//
// BEFORE (end of createOrder):
//   return { order: { ... }, alreadyExists: false }
//
// AFTER:
//   return { order: { ... }, alreadyExists: false, customerId: custId }
//
// NOTE: custId comes from PostgREST which returns bigint as string.
// The loyalty RPC helpers already call Number(customerId) so this is safe.
//
// ─────────────────────────────────────────────────────────────
// ── CHANGE 5 ── Update OrdersResponse type (orderService.ts top)
// ─────────────────────────────────────────────────────────────
//
// In OrdersResponseSchema, the stats object definition:
//
// BEFORE:
//   stats: z.object({
//     delivered: z.number(),
//     active:    z.number(),
//     cancelled: z.number(),
//     spent:     z.number(),
//   }).optional(),
//
// AFTER:
//   stats: z.object({
//     delivered:      z.number(),
//     active:         z.number(),
//     cancelled:      z.number(),
//     spent:          z.number(),
//     loyalty_points: z.number().optional().default(0),   // ← ADD
//   }).optional(),
//
// ─────────────────────────────────────────────────────────────
// END PATCH GUIDE
// ─────────────────────────────────────────────────────────────

export {}  // keep TypeScript happy as a module
