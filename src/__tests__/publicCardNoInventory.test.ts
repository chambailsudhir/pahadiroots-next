// R3-2 (Nov 2026): every public listing card and the PDP sold-% bar keep exact inventory and SKUs out of the page.
import { describe, it, expect } from 'vitest'
import { toCardProductData, toHomeCardData } from '@/lib/normalizeProduct'
import { soldPercent } from '@/lib/publicCatalog'

const row: any = {
  id: 1, name: 'Wild Honey', slug: 'wild-honey', price: 450, selling_price: 450, mrp: 500, available_stock: 187,
  initial_stock: 400, sku: 'SKU-1', sku_backup: 'SKU-OLD', hsn_code: '0409', is_active: true, status: 'active',
  product_variants: [{ id: 70, product_id: 1, size: '500 g', price: 420, mrp: 500, available_stock: 4, initial_stock: 50,
    sku: 'V-SKU-70', cost_price: 200, is_active: true }],
}

describe('public cards carry no exact inventory or SKU', () => {
  it('listing card (toCardProductData)', () => {
    const c: any = toCardProductData(row)
    for (const k of ['initial_stock', 'sku', 'sku_backup', 'hsn_code']) expect(c[k]).toBeUndefined()
    expect(c.available_stock).toBe(50)
    const v = c.product_variants[0]
    for (const k of ['sku', 'initial_stock', 'cost_price']) expect(v[k]).toBeUndefined()
    expect(v.available_stock).toBe(4)            // low stock stays exact below the cap, so "only 4 left" still works
  })
  it('homepage card (toHomeCardData)', () => {
    const c: any = toHomeCardData(row)
    expect(c.available_stock).toBe(50)
    expect(c.initial_stock).toBeUndefined()
    expect(c.product_variants[0].sku).toBeUndefined()
  })
  it('PDP sold percentage is computed server-side and clamped', () => {
    expect(soldPercent(187, 400)).toBe(53)
    expect(soldPercent(0, 400)).toBe(95)
    expect(soldPercent(10, null)).toBeNull()
    expect(soldPercent(10, 0)).toBeNull()
  })
})
