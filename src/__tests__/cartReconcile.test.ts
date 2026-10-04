/** C1 — applying the server's live view of each line to the persisted cart. */
import { describe, it, expect } from 'vitest'
import { reconcileCartLines, describeCartChanges, type LiveLineDTO } from '@/lib/cartReconcile'
import type { CartItem } from '@/types'

const item = (over: Partial<CartItem> = {}): CartItem => ({
  productId: 'p1', variantId: 'v1', name: 'Wild Honey', slug: 'honey', image: null, emoji: null, size: '500g',
  price: 500, mrp: 600, gstRate: 5, qty: 2, maxQty: undefined as unknown as number,
  isOrganic: false, isHimalayan: false, isBestseller: false, ...over,
})
const line = (over: Partial<LiveLineDTO> = {}): LiveLineDTO => ({
  productId: 'p1', variantId: 'v1', status: 'ok', name: 'Wild Honey', price: 500, mrp: 600, available: 10, ...over,
})

describe('reconcileCartLines', () => {
  it('unchanged line → no changes; maxQty is restored from live stock (C3)', () => {
    const { items, changes } = reconcileCartLines([item()], [line({ available: 7 })])
    expect(changes).toEqual([])
    expect(items[0].maxQty).toBe(7)
    expect(items[0].qty).toBe(2)
  })

  it('price increase → price+mrp refreshed and reported', () => {
    const { items, changes } = reconcileCartLines([item()], [line({ price: 650, mrp: 700 })])
    expect(items[0]).toMatchObject({ price: 650, mrp: 700 })
    expect(changes).toEqual([{ type: 'price_changed', variantId: 'v1', name: 'Wild Honey', from: 500, to: 650 }])
  })

  it('price decrease is reported too', () => {
    const { changes } = reconcileCartLines([item()], [line({ price: 450 })])
    expect(changes[0]).toMatchObject({ type: 'price_changed', from: 500, to: 450 })
  })

  it('mrp-only change is applied silently (display only)', () => {
    const { items, changes } = reconcileCartLines([item()], [line({ mrp: 640 })])
    expect(changes).toEqual([])
    expect(items[0].mrp).toBe(640)
  })

  it('fewer units in stock than the cart holds → quantity reduced and reported', () => {
    const { items, changes } = reconcileCartLines([item({ qty: 5 })], [line({ status: 'insufficient_stock', available: 3 })])
    expect(items[0].qty).toBe(3)
    expect(items[0].maxQty).toBe(3)
    expect(changes).toEqual([{ type: 'qty_reduced', variantId: 'v1', name: 'Wild Honey', from: 5, to: 3 }])
  })

  it('out of stock / unavailable → line removed', () => {
    const a = reconcileCartLines([item()], [line({ status: 'out_of_stock', available: 0 })])
    expect(a.items).toEqual([])
    expect(a.changes[0]).toMatchObject({ type: 'removed', reason: 'out_of_stock' })
    const b = reconcileCartLines([item()], [line({ status: 'unavailable', available: 0, price: 0 })])
    expect(b.items).toEqual([])
    expect(b.changes[0]).toMatchObject({ type: 'removed', reason: 'unavailable' })
  })

  it('judges quantity against the cart as it is NOW (customer edited it while the request was in flight)', () => {
    // server was asked about qty 5 and said insufficient (3 available); customer has since dropped to 2
    const { items, changes } = reconcileCartLines([item({ qty: 2 })], [line({ status: 'insufficient_stock', available: 3 })])
    expect(items[0].qty).toBe(2)
    expect(changes).toEqual([])
  })

  it('lines the server did not return, or whose productId does not match, are left alone', () => {
    const other = item({ variantId: 'v2', productId: 'p2', name: 'Other' })
    const mismatched = item({ variantId: 'v3', productId: 'p3', name: 'Mismatch' })
    const { items, changes } = reconcileCartLines([other, mismatched], [line({ variantId: 'v3', productId: 'pX', price: 1 })])
    expect(items).toEqual([other, mismatched])
    expect(changes).toEqual([])
  })

  it('a ₹0 live price (unpriced) never overwrites a good price', () => {
    const { items, changes } = reconcileCartLines([item()], [line({ price: 0 })])
    expect(items[0].price).toBe(500)
    expect(changes).toEqual([])
  })

  it('handles several lines independently', () => {
    const { items, changes } = reconcileCartLines(
      [item(), item({ variantId: 'v2', productId: 'p2', name: 'Salt', qty: 1 })],
      [line({ price: 520 }), line({ variantId: 'v2', productId: 'p2', name: 'Salt', status: 'out_of_stock', available: 0 })],
    )
    expect(items.map(i => i.variantId)).toEqual(['v1'])
    expect(changes.map(c => c.type)).toEqual(['price_changed', 'removed'])
  })
})

describe('describeCartChanges', () => {
  it('writes one customer-readable sentence per change', () => {
    const msgs = describeCartChanges([
      { type: 'price_changed', variantId: 'v1', name: 'Wild Honey', from: 500, to: 649.5 },
      { type: 'qty_reduced',   variantId: 'v2', name: 'Salt', from: 5, to: 1 },
      { type: 'removed',       variantId: 'v3', name: 'Ghee', reason: 'out_of_stock' },
      { type: 'removed',       variantId: 'v4', name: 'Tea',  reason: 'unavailable' },
    ])
    expect(msgs[0]).toBe('The price of Wild Honey changed from ₹500 to ₹649.50.')
    expect(msgs[1]).toBe('Only 1 of Salt is in stock — quantity changed from 5 to 1.')
    expect(msgs[2]).toMatch(/Ghee is out of stock/)
    expect(msgs[3]).toMatch(/Tea is no longer available/)
  })
})
