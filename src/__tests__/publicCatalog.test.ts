import { describe, it, expect } from 'vitest'
import { toPublicCatalogProduct, capStock } from '@/lib/publicCatalog'
import { MAX_LINE_QTY } from '@/lib/cartLimits'

// Nov 2026 verification: /api/v1/search-catalog (public, CDN-cached) exposed variant sku / initial_stock and exact stock levels.
describe('public catalogue shape (/api/v1/search-catalog)', () => {
  const product = {
    id: 27, name: 'Sea Buckthorn Juice', slug: 'sea-buckthorn', price: 299, available_stock: 187, created_at: 't', state_id: 1,
    updated_at: 'u', is_deleted: false, initial_stock: 500, sku: 'SBJ', sku_backup: 'x', hsn_code: '2009',
    product_variants: [
      { id: 40, product_id: 27, size: '500ml', price: 299, mrp: 349, available_stock: 187, is_active: true, sort_order: 1,
        sku: 'SBJ-500', initial_stock: 500, created_at: 'c', updated_at: 'u', cost_price: 120 },
      { id: 41, product_id: 27, size: '1l', price: 549, mrp: 649, available_stock: 4, is_active: true, sort_order: 2 },
    ],
  }

  it('caps stock at the cart limit: in-stock, low-stock and max-quantity answers are unchanged, the real level is hidden', () => {
    const out = toPublicCatalogProduct(product) as typeof product
    expect(out.available_stock).toBe(MAX_LINE_QTY)
    expect(out.product_variants[0].available_stock).toBe(MAX_LINE_QTY)
    expect(out.product_variants[1].available_stock).toBe(4)       // a low level (< 10) is still shown as is
    expect(capStock(0)).toBe(0)
    expect(capStock(-3)).toBe(0)
    expect(capStock('abc')).toBe(0)
  })

  it('variants are an allow-list: no sku, initial_stock, timestamps or any other column', () => {
    const v = (toPublicCatalogProduct(product) as typeof product).product_variants[0] as Record<string, unknown>
    expect(Object.keys(v).sort()).toEqual(['available_stock', 'id', 'is_active', 'mrp', 'price', 'product_id', 'size', 'sort_order'])
  })

  it('drops internal product columns but keeps what cards, filters and sorting read', () => {
    const out = toPublicCatalogProduct(product)
    for (const k of ['updated_at', 'is_deleted', 'initial_stock', 'sku', 'sku_backup', 'hsn_code']) expect(out).not.toHaveProperty(k)
    for (const k of ['id', 'name', 'slug', 'price', 'created_at', 'state_id']) expect(out).toHaveProperty(k)
  })
})
