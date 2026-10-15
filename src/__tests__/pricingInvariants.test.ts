/**
 * F-16 — pricing invariants. Whole-rupee rounding and "free shipping is judged after discounts" are
 * deliberate policy (see pricingService.ts); these tests lock the arithmetic so a refactor cannot
 * change what customers are charged without a test failing.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn() },
  getServiceClient: vi.fn(() => ({ from: vi.fn() })),
}))
import { calcPriceSummary } from '@/lib/services/pricingService'
import type { CartItem, AppliedCoupon, SiteSettings } from '@/types'

const item = (o: Partial<CartItem> = {}): CartItem => ({
  productId: '1', variantId: 'v1', name: 'P', slug: 'p', image: null, emoji: null, size: '250g',
  price: 200, mrp: 250, gstRate: 5, qty: 1, maxQty: 10, isOrganic: false, isHimalayan: false, isBestseller: false, ...o,
})
const settings = (o: Record<string, string> = {}) =>
  ({ free_shipping_min: '799', flat_shipping_charge: '99', prepaid_discount_pct: '0', cod_surcharge_amount: '0', ...o }) as unknown as SiteSettings

describe('F-16 total invariant', () => {
  it.each([
    ['decimal line prices, COD',      [item({ price: 209.52, qty: 3 })], null,                                         'cod',      0],
    ['decimal prices, prepaid 5%',    [item({ price: 333.33, qty: 3 }), item({ price: 99.99, qty: 2 })], null,         'razorpay', 0],
    ['coupon + loyalty + shipping',   [item({ price: 150.5, qty: 2 })], { code: 'X', discount: 50, type: 'flat' },     'cod',      30],
    ['coupon larger than the order',  [item({ price: 100, qty: 1 })],   { code: 'X', discount: 5000, type: 'flat' },   'razorpay', 0],
  ] as Array<[string, CartItem[], AppliedCoupon | null, 'cod' | 'razorpay', number]>)('%s', (_n, items, coupon, method, coins) => {
    const s = calcPriceSummary(items, settings({ prepaid_discount_pct: '5', cod_surcharge_amount: '20' }), coupon, method, coins)
    expect(Number.isInteger(s.subtotal)).toBe(true)
    expect(Number.isInteger(s.total)).toBe(true)
    // afterDiscount is clamped at 0 BEFORE shipping/COD/prepaid are applied (a coupon can never push
    // the goods value negative), so the invariant is stated on that clamped value.
    const afterDiscount = Math.max(0, s.subtotal - s.discount - s.loyaltyDiscount)
    expect(s.total).toBe(Math.max(0, afterDiscount + s.shipping + s.codSurcharge - s.prepaidDiscount))
    expect(s.total).toBeGreaterThanOrEqual(0)
    // Razorpay is charged total × 100 paise — must be exact.
    expect(Number.isInteger(s.total * 100)).toBe(true)
  })

  it('free shipping is judged AFTER the coupon: threshold − 1, exactly, and + 1', () => {
    const cfg = settings({ free_shipping_min: '500' })
    const at = (discount: number) =>
      calcPriceSummary([item({ price: 600, qty: 1 })], cfg, { code: 'X', discount, type: 'flat' }, 'cod').isFreeShipping
    expect(at(99)).toBe(true)    // 501 ≥ 500
    expect(at(100)).toBe(true)   // 500 ≥ 500 (boundary is inclusive)
    expect(at(101)).toBe(false)  // 499 < 500
  })

  it('free_shipping_min = 0 means every order ships free', () => {
    const s = calcPriceSummary([item({ price: 10, qty: 1 })], settings({ free_shipping_min: '0' }), null, 'cod')
    expect(s.isFreeShipping).toBe(true)
    expect(s.shipping).toBe(0)
  })
})
