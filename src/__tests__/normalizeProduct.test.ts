/**
 * normalizeProduct.test.ts
 *
 * BUG FIX covered here (found via a careful re-audit after the cart-upsells
 * incident, prompted by "check line by line"): the exact same
 * product_variants.mrp bug (that column doesn't exist — confirmed via live
 * schema inspection; the real column is original_price) also existed in:
 *   - normalizeProduct.ts's exported PRODUCT_SELECT constant
 *   - wishlist/page.tsx's own hand-duplicated select string
 *   - blog/[slug]/page.tsx's own hand-duplicated select string
 *
 * This means the wishlist page (a significant, frequently-used feature) and
 * blog product-mentions have been silently broken in production this whole
 * time — the query fails, `data` comes back null/empty, and the page just
 * renders an empty list with no visible error. Exactly zero tests existed
 * for normalizeProduct.ts before this file, which is how a duplicated,
 * subtly-wrong query string went unnoticed for so long.
 */

import { describe, it, expect } from 'vitest'
import { normalizeProduct, normalizeProducts, applyProductImages, getEffectivePrice } from '@/lib/normalizeProduct'

describe('normalizeProduct — variant mrp mapping (the actual bug)', () => {
  it('maps variant.mrp from original_price (the real column), not a literal mrp field', () => {
    const raw = {
      id: 1, name: 'Wild Honey', slug: 'wild-honey', badges: [],
      product_variants: [
        { id: 10, price: 250, original_price: 300, variant_value: '500g', available_stock: 5, is_active: true },
      ],
    }
    const result = normalizeProduct(raw as any)
    expect(result.product_variants![0].mrp).toBe(300)
  })

  it('falls back to price when original_price is absent (no discount configured)', () => {
    const raw = {
      id: 1, name: 'Wild Honey', slug: 'wild-honey', badges: [],
      product_variants: [
        { id: 10, price: 250, variant_value: '500g', available_stock: 5, is_active: true },
      ],
    }
    const result = normalizeProduct(raw as any)
    expect(result.product_variants![0].mrp).toBe(250)
  })

  it('maps size from variant_value (the real column, not a literal size field)', () => {
    const raw = {
      id: 1, name: 'Wild Honey', slug: 'wild-honey', badges: [],
      product_variants: [
        { id: 10, price: 250, original_price: 300, variant_value: '1kg', available_stock: 5, is_active: true },
      ],
    }
    const result = normalizeProduct(raw as any)
    expect(result.product_variants![0].size).toBe('1kg')
  })

  it('handles a product with no variants at all without throwing', () => {
    const raw = { id: 1, name: 'Wild Honey', slug: 'wild-honey', badges: [] }
    const result = normalizeProduct(raw as any)
    expect(result.product_variants).toEqual([])
  })

  it('normalizeProducts maps every product in a list correctly', () => {
    const raw = [
      { id: 1, name: 'A', slug: 'a', badges: [], product_variants: [{ id: 1, price: 100, original_price: 150, available_stock: 1, is_active: true }] },
      { id: 2, name: 'B', slug: 'b', badges: [], product_variants: [{ id: 2, price: 200, original_price: 250, available_stock: 1, is_active: true }] },
    ]
    const result = normalizeProducts(raw as any)
    expect(result.map(p => p.product_variants![0].mrp)).toEqual([150, 250])
  })
})

describe('normalizeProduct — badges derivation', () => {
  it('derives badges_bestseller/organic/new from the real badges array column', () => {
    const raw = { id: 1, name: 'X', slug: 'x', badges: ['bestseller', 'organic'] }
    const result = normalizeProduct(raw as any)
    expect(result.badges_bestseller).toBe(true)
    expect(result.badges_organic).toBe(true)
    expect(result.badges_new).toBe(false)
  })

  it('handles a null/missing badges array without throwing', () => {
    const raw = { id: 1, name: 'X', slug: 'x' }
    const result = normalizeProduct(raw as any)
    expect(result.badges_bestseller).toBe(false)
  })
})

describe('applyProductImages', () => {
  it('overrides image_url with the lowest-sort_order image and stores all urls', () => {
    const products = [{ id: 1, name: 'X', slug: 'x', image_url: 'old.jpg' }] as any
    const images = [
      { product_id: 1, image_url: 'b.jpg', sort_order: 2 },
      { product_id: 1, image_url: 'a.jpg', sort_order: 1 },
    ]
    const result = applyProductImages(products, images)
    expect(result[0].image_url).toBe('a.jpg')
    expect((result[0] as any)._images).toEqual(['a.jpg', 'b.jpg'])
  })

  it('leaves products unchanged when there are no matching images', () => {
    const products = [{ id: 1, name: 'X', slug: 'x', image_url: 'old.jpg' }] as any
    const result = applyProductImages(products, [{ product_id: 999, image_url: 'z.jpg', sort_order: 1 }])
    expect(result[0].image_url).toBe('old.jpg')
  })
})

describe('getEffectivePrice — the products-listing-page pricing bug', () => {
  /**
   * BUG FIX: /products, /regions, /regions/[slug], /collections/[slug] and
   * the homepage BestSellers/NewArrivals sections all rendered ProductCard
   * with product_variants never attached (see storeData.ts attachVariants
   * fix), so every card fell back to the top-level product.price even for
   * multi-variant products, and "Price: Low -> High" sorted on that same
   * possibly-wrong value. getEffectivePrice() is the single source of truth
   * both the sort and the card must use so they can never disagree again.
   */
  it('returns the lowest active variant price when variants exist', () => {
    const product = normalizeProduct({
      id: 1, name: 'Honey', slug: 'honey', badges: [], price: 999, mrp: 999,
      product_variants: [
        { id: 1, price: 450, original_price: 500, variant_value: '1kg', available_stock: 3, is_active: true },
        { id: 2, price: 250, original_price: 300, variant_value: '500g', available_stock: 5, is_active: true },
      ],
    } as any)
    expect(getEffectivePrice(product)).toBe(250)
  })

  it('ignores inactive variants when picking the lowest price', () => {
    const product = normalizeProduct({
      id: 1, name: 'Honey', slug: 'honey', badges: [], price: 999,
      product_variants: [
        { id: 1, price: 100, variant_value: '250g', available_stock: 0, is_active: false },
        { id: 2, price: 250, variant_value: '500g', available_stock: 5, is_active: true },
      ],
    } as any)
    expect(getEffectivePrice(product)).toBe(250)
  })

  it('falls back to the top-level product price when there are no variants', () => {
    const product = normalizeProduct({ id: 1, name: 'Honey', slug: 'honey', badges: [], price: 599 } as any)
    expect(getEffectivePrice(product)).toBe(599)
  })
})
