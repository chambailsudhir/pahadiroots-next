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
  items:                  z.array(orderItemSchema).min(1).max(30),
  payment_method:         z.enum(['razorpay', 'cod']),
  coupon_code:            z.string().trim().max(50).optional(),
  idempotency_key:        z.string().uuid(),
  customer_email:         z.string().email().optional().or(z.literal('')),
  // ── Loyalty coins ────────────────────────────────────────────────────────
  loyalty_points_redeemed: z.number().int().min(0).max(100_000).optional().default(0),
})

// ─── Payment Schema ────────────────────────────────────────────────────────────

export const verifyPaymentSchema = z.object({
  razorpay_order_id:   z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature:  z.string(),
  order_id:            z.string().min(1),
})

// ─── Coupon Schema ─────────────────────────────────────────────────────────────

export const validateCouponSchema = z.object({
  code:     z.string().trim().min(1).max(50),
  subtotal: z.number().positive(),
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
