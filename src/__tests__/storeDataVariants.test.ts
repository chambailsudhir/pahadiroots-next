/**
 * storeDataVariants.test.ts
 *
 * BUG FIX (CRITICAL — data/pricing integrity) covered here:
 * storeData.ts fetched `product_variants` as a flat array on every
 * getStoreData() call but nothing ever grouped it by product_id and merged
 * it back onto the individual products. Every consumer of
 * getProductsWithImages() — the /products listing page, /regions/[slug],
 * /collections/[slug] (which called applyProductImages() directly, bypassing
 * the helper entirely), and the homepage BestSellers/NewArrivals sections —
 * always rendered ProductCard with `product.product_variants === undefined`,
 * so every card silently fell back to the top-level product.price/mrp even
 * for multi-variant products, while the PDP (which fetches variants directly)
 * correctly showed the lowest active variant's price. Listing price and PDP
 * price could disagree for the same product.
 *
 * Zero tests existed for storeData.ts's product/variant wiring before this
 * file, which is how this went unnoticed across five separate pages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.doMock('@/lib/supabase', () => ({
    supabase: {},
    getServiceClient: () => ({}),
  }))
})

describe('attachVariants', () => {
  it('groups variants by product_id and attaches them to the matching product', async () => {
    const { attachVariants } = await import('@/lib/storeData')
    const products = [
      { id: 1, name: 'Wild Honey', slug: 'wild-honey', price: 999, mrp: 999 },
      { id: 2, name: 'Turmeric', slug: 'turmeric', price: 199, mrp: 199 },
    ] as any

    const variants = [
      { id: 10, product_id: 1, price: 450, mrp: null, variant_value: '1kg', available_stock: 3, is_active: true },
      { id: 11, product_id: 1, price: 250, mrp: null, variant_value: '500g', available_stock: 5, is_active: true },
      { id: 12, product_id: 2, price: 150, mrp: null, variant_value: '250g', available_stock: 2, is_active: true },
    ] as any

    const result = attachVariants(products, variants)

    expect(result[0].product_variants).toHaveLength(2)
    expect(result[1].product_variants).toHaveLength(1)
    // sorted ascending by price
    expect(result[0].product_variants![0].price).toBe(250)
    expect(result[0].product_variants![1].price).toBe(450)
  })

  it('excludes inactive variants entirely', async () => {
    const { attachVariants } = await import('@/lib/storeData')
    const products = [{ id: 1, name: 'X', slug: 'x', price: 100 }] as any
    const variants = [
      { id: 1, product_id: 1, price: 50, is_active: false, available_stock: 0 },
      { id: 2, product_id: 1, price: 90, is_active: true, available_stock: 4 },
    ] as any
    const result = attachVariants(products, variants)
    expect(result[0].product_variants).toHaveLength(1)
    expect(result[0].product_variants![0].price).toBe(90)
  })

  it('maps mrp from original_price the same way normalizeProduct does elsewhere', async () => {
    const { attachVariants } = await import('@/lib/storeData')
    const products = [{ id: 1, name: 'X', slug: 'x', price: 100 }] as any
    const variants = [
      { id: 1, product_id: 1, price: 250, original_price: 300, is_active: true, available_stock: 1 } as any,
    ]
    const result = attachVariants(products, variants)
    expect((result[0].product_variants![0] as any).mrp).toBe(300)
  })

  it('leaves a product untouched when it has no matching variants (no crash, no empty array injected)', async () => {
    const { attachVariants } = await import('@/lib/storeData')
    const products = [{ id: 1, name: 'X', slug: 'x', price: 100 }] as any
    const result = attachVariants(products, [{ id: 1, product_id: 999, price: 50, is_active: true, available_stock: 1 } as any])
    expect(result[0].product_variants).toBeUndefined()
  })

  it('is a no-op (returns the same products, unmodified) when there are no variants at all', async () => {
    const { attachVariants } = await import('@/lib/storeData')
    const products = [{ id: 1, name: 'X', slug: 'x', price: 100 }] as any
    const result = attachVariants(products, [])
    expect(result).toEqual(products)
  })
})

describe('getProductsWithImages — the actual bug fix', () => {
  it('returns products with BOTH images and variants merged in, given a full StoreData shape', async () => {
    const { getProductsWithImages } = await import('@/lib/storeData')
    const storeData = {
      products: [{ id: 1, name: 'Honey', slug: 'honey', price: 999, image_url: 'old.jpg' }],
      product_images: [{ product_id: 1, image_url: 'new.jpg', sort_order: 1 }],
      product_variants: [
        { id: 10, product_id: 1, price: 450, is_active: true, available_stock: 2 },
      ],
    } as any

    const result = getProductsWithImages(storeData)

    expect(result[0].image_url).toBe('new.jpg')
    expect(result[0].product_variants).toHaveLength(1)
    expect(result[0].product_variants![0].price).toBe(450)
  })
})
