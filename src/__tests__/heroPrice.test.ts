import { describe, it, expect } from 'vitest'
import { heroFromPrice } from '@/lib/heroPrice'

const prod = (id: number, o: Record<string, unknown> = {}) => ({ id, slug: `p${id}`, category_id: 1, price: 500, selling_price: 500, mrp: 600, available_stock: 5, product_variants: [], ...o }) as any
const cats = [{ id: 1, slug: 'himalayan-honey' }, { id: 2, slug: 'tea' }]

describe('heroFromPrice', () => {
  it('uses the lowest in-stock price in the linked collection', () => {
    const ps = [prod(1, { selling_price: 450 }), prod(2, { selling_price: 350 }), prod(3, { selling_price: 100, available_stock: 0 }), prod(4, { category_id: 2, selling_price: 90 })]
    expect(heroFromPrice('/collections/himalayan-honey', cats, ps)).toBe(350)
  })
  it('uses a single product when the link is a product page', () => {
    expect(heroFromPrice('/products/p2', cats, [prod(1), prod(2, { selling_price: 275 })])).toBe(275)
  })
  it('returns null for other links, unknown collections and empty/out-of-stock pools', () => {
    expect(heroFromPrice('/about', cats, [prod(1)])).toBeNull()
    expect(heroFromPrice('/collections/nope', cats, [prod(1)])).toBeNull()
    expect(heroFromPrice('/collections/tea', cats, [prod(1)])).toBeNull()
    expect(heroFromPrice('/collections/himalayan-honey', cats, [prod(1, { available_stock: 0 })])).toBeNull()
    expect(heroFromPrice(undefined, cats, [])).toBeNull()
  })
})
