/**
 * P3 — an idempotency key is only a retry if the request is the same request.
 * Covers the pure comparison used by createOrder(). Route mapping to 409 is
 * covered in paymentOrderRoutes.test.ts.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase:         { from: vi.fn() },
  getServiceClient: vi.fn(() => ({ from: vi.fn() })),
}))
import { describeIdempotencyMismatch, IdempotencyConflictError } from '@/lib/services/orderService'

const stored = (over: Partial<Parameters<typeof describeIdempotencyMismatch>[0]> = {}) => ({
  orderStatus: 'pending', paymentMethod: 'razorpay', loyaltyPoints: 0,
  items: [{ product_id: 'p1', variant_id: 'v1', quantity: 2 }],
  ...over,
})
const req = (over: Partial<Parameters<typeof describeIdempotencyMismatch>[1]> = {}) => ({
  paymentMethod: 'razorpay', loyaltyPoints: 0,
  items: [{ productId: 'p1', variantId: 'v1', qty: 2 }],
  ...over,
})

describe('describeIdempotencyMismatch', () => {
  it('identical request → null (genuine retry)', () => {
    expect(describeIdempotencyMismatch(stored(), req())).toBeNull()
  })

  it('item order does not matter', () => {
    const s = stored({ items: [
      { product_id: 'p1', variant_id: 'v1', quantity: 1 },
      { product_id: 'p2', variant_id: 'v2', quantity: 3 },
    ] })
    const r = req({ items: [
      { productId: 'p2', variantId: 'v2', qty: 3 },
      { productId: 'p1', variantId: 'v1', qty: 1 },
    ] })
    expect(describeIdempotencyMismatch(s, r)).toBeNull()
  })

  it('product without variants: client sends productId as variantId, server stored the real variant → still a match', () => {
    const s = stored({ items: [{ product_id: 'p9', variant_id: 'resolved-variant', quantity: 1 }] })
    const r = req({ items: [{ productId: 'p9', variantId: 'p9', qty: 1 }] })
    expect(describeIdempotencyMismatch(s, r)).toBeNull()
  })

  it('quantity changed → mismatch', () => {
    expect(describeIdempotencyMismatch(stored(), req({ items: [{ productId: 'p1', variantId: 'v1', qty: 3 }] }))).toMatch(/items or quantities/)
  })

  it('different variant of the same product → mismatch', () => {
    expect(describeIdempotencyMismatch(stored(), req({ items: [{ productId: 'p1', variantId: 'v2', qty: 2 }] }))).not.toBeNull()
  })

  it('item added / removed → mismatch', () => {
    expect(describeIdempotencyMismatch(stored(), req({ items: [
      { productId: 'p1', variantId: 'v1', qty: 2 }, { productId: 'p2', variantId: 'v2', qty: 1 },
    ] }))).toMatch(/item count/)
  })

  it('payment method switched razorpay → cod (the abandoned online order must not be "placed")', () => {
    expect(describeIdempotencyMismatch(stored(), req({ paymentMethod: 'cod' }))).toMatch(/payment method/)
  })

  it('loyalty points changed → mismatch', () => {
    expect(describeIdempotencyMismatch(stored(), req({ loyaltyPoints: 50 }))).toMatch(/loyalty/)
  })

  it.each(['cancelled', 'payment_failed'])('stored order is %s → mismatch even for an identical request', (status) => {
    expect(describeIdempotencyMismatch(stored({ orderStatus: status }), req())).toMatch(status)
  })

  it('duplicate lines are matched one-to-one (no double-counting a single stored row)', () => {
    const r = req({ items: [
      { productId: 'p1', variantId: 'v1', qty: 2 }, { productId: 'p1', variantId: 'v1', qty: 2 },
    ] })
    expect(describeIdempotencyMismatch(stored(), r)).not.toBeNull()
  })
})

describe('IdempotencyConflictError', () => {
  it('carries a stable code and a customer-safe message', () => {
    const e = new IdempotencyConflictError('items changed')
    expect(e.code).toBe('IDEMPOTENCY_CONFLICT')
    expect(e.message).not.toMatch(/items changed/) // internal reason never shown to customers
    expect(e.reason).toBe('items changed')
  })
})
