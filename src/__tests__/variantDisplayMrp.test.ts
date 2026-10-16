import { describe, it, expect } from 'vitest'
import { variantDisplayMrp, variantLineMrp } from '@/lib/pricing/linePricing'

// Real shapes from the live catalogue (Oct 2026): variant.price is GST-inclusive,
// variant.original_price is the EX-GST base, products.mrp is the printed MRP.
const manali = { id: 1, selling_price: 388.54, price: 370.04, mrp: 500 }
const v250 = { id: 1, product_id: 1, price: 388.54, original_price: 370.04 }
const v1kg = { id: 3, product_id: 1, price: 679.95, original_price: 647.57 }

describe('variantDisplayMrp', () => {
  it('never uses the ex-GST original_price as an MRP (the old bug)', () => {
    expect(variantDisplayMrp({ ...v250, price: 388.54, original_price: 370.04 }, { id: 1 })).toBe(388.54)
  })
  it('uses the product MRP for the headline variant only', () => {
    expect(variantDisplayMrp(v250, manali)).toBe(500)
    expect(variantDisplayMrp(v1kg, manali)).toBe(679.95)   // a different size: no invented discount
  })
  it('prefers an explicit variant compare_at_price when it exceeds the price', () => {
    expect(variantDisplayMrp({ ...v1kg, compare_at_price: 900 }, manali)).toBe(900)
  })
  it('ignores a compare_at_price / MRP that is not above the selling price', () => {
    expect(variantDisplayMrp({ ...v250, compare_at_price: 388.54 }, { ...manali, mrp: 388.54 })).toBe(388.54)
    expect(variantDisplayMrp({ ...v250, compare_at_price: 100 }, { ...manali, mrp: 100 })).toBe(388.54)
    expect(variantDisplayMrp({ ...v250, compare_at_price: null }, { id: 1, mrp: null })).toBe(388.54)
  })
  it('is never below the selling price, and 0 for a priceless variant', () => {
    for (const mrp of [0, 10, 388.54, 500, NaN, undefined]) {
      expect(variantDisplayMrp(v250, { ...manali, mrp })).toBeGreaterThanOrEqual(388.54)
    }
    expect(variantDisplayMrp({ id: 9, product_id: 1, price: 0 }, manali)).toBe(0)
  })
  it('variantLineMrp (cart + order pricing) follows the same rule', () => {
    expect(variantLineMrp(v250, manali)).toBe(500)
    expect(variantLineMrp(v1kg, manali)).toBe(679.95)
  })
})
