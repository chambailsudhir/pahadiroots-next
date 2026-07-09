/**
 * filterAndSortProducts.test.ts
 *
 * BUG FIX (low-severity — zero test coverage, found during products-page
 * audit): filter/sort/pagination logic for /products used to live inline
 * inside an async Server Component that calls Supabase directly, so there
 * was no way to unit test it — nobody had, and it's exactly how the
 * variant-pricing and searchParams-Promise bugs went unnoticed for as long
 * as they did. Extracted to lib/filterAndSortProducts.ts and covered here.
 */

import { describe, it, expect } from 'vitest'
import { filterProducts, sortProducts, filterAndSortProducts, paginateProducts, buildPaginationList } from '@/lib/filterAndSortProducts'
import type { Product } from '@/types'

function makeProduct(overrides: Partial<Product> & { id: number }): Product {
  return {
    name: `Product ${overrides.id}`,
    slug: `product-${overrides.id}`,
    emoji: null,
    sku: null,
    category_id: 1,
    state_id: '1',
    is_active: true,
    unit_label: null,
    gst_rate: 5,
    price: 100,
    selling: null,
    mrp: 100,
    cost_price: null,
    available_stock: 10,
    initial_stock: 10,
    short_description: null,
    long_description: null,
    image_url: null,
    tags: null,
    badges_bestseller: false,
    badges_organic: false,
    badges_new: false,
    is_deleted: false,
    created_at: '2026-01-01T00:00:00Z',
    ai_description: null, ai_health_benefits: null, ai_how_to_use: null,
    ai_storage_tips: null, ai_who_should_buy: null, ai_generated_at: null,
    ...overrides,
  } as Product
}

describe('filterProducts', () => {
  const products = [
    makeProduct({ id: 1, category_id: 10, state_id: 'a', available_stock: 5 }),
    makeProduct({ id: 2, category_id: 20, state_id: 'b', available_stock: 0 }),
    makeProduct({ id: 3, category_id: 10, state_id: 'b', available_stock: 3 }),
  ]

  it('returns everything unchanged when no filters are given', () => {
    expect(filterProducts(products, {})).toHaveLength(3)
  })

  it('filters by category_id', () => {
    const result = filterProducts(products, { categoryId: 10 })
    expect(result.map(p => p.id)).toEqual([1, 3])
  })

  it('filters by state_id', () => {
    const result = filterProducts(products, { stateId: 'b' })
    expect(result.map(p => p.id)).toEqual([2, 3])
  })

  it('filters out-of-stock products when inStockOnly is set', () => {
    const result = filterProducts(products, { inStockOnly: true })
    expect(result.map(p => p.id)).toEqual([1, 3])
  })

  it('combines category + state + in-stock filters (AND, not OR)', () => {
    const result = filterProducts(products, { categoryId: 10, stateId: 'b', inStockOnly: true })
    expect(result.map(p => p.id)).toEqual([3])
  })

  it('does not mutate the input array', () => {
    const copy = [...products]
    filterProducts(products, { categoryId: 10 })
    expect(products).toEqual(copy)
  })
})

describe('sortProducts', () => {
  it('sorts price_asc by effective (variant-aware) price, not raw product.price', () => {
    const products = [
      makeProduct({ id: 1, price: 500 }),
      makeProduct({ id: 2, price: 100, product_variants: [
        { id: 1, product_id: 2, size: '250g', price: 50, mrp: null, available_stock: 5, is_active: true },
      ] }),
      makeProduct({ id: 3, price: 300 }),
    ]
    const result = sortProducts(products, 'price_asc')
    expect(result.map(p => p.id)).toEqual([2, 3, 1]) // 50, 300, 500
  })

  it('sorts price_desc correctly', () => {
    const products = [makeProduct({ id: 1, price: 100 }), makeProduct({ id: 2, price: 300 })]
    expect(sortProducts(products, 'price_desc').map(p => p.id)).toEqual([2, 1])
  })

  it('sorts newest by created_at descending', () => {
    const products = [
      makeProduct({ id: 1, created_at: '2026-01-01T00:00:00Z' }),
      makeProduct({ id: 2, created_at: '2026-03-01T00:00:00Z' }),
    ]
    expect(sortProducts(products, 'newest').map(p => p.id)).toEqual([2, 1])
  })

  describe('popular — the weak-sort bug fix', () => {
    it('puts bestsellers before non-bestsellers', () => {
      const products = [
        makeProduct({ id: 1, badges_bestseller: false }),
        makeProduct({ id: 2, badges_bestseller: true }),
      ]
      expect(sortProducts(products, 'popular').map(p => p.id)).toEqual([2, 1])
    })

    it('ranks WITHIN the bestseller bucket by review_count (the actual fix)', () => {
      const products = [
        makeProduct({ id: 1, badges_bestseller: true, review_count: 5 }),
        makeProduct({ id: 2, badges_bestseller: true, review_count: 50 }),
        makeProduct({ id: 3, badges_bestseller: true, review_count: 20 }),
      ]
      // Previously: pure boolean split meant these three kept arbitrary
      // input order since they're all `true`. Now: ranked by review_count.
      expect(sortProducts(products, 'popular').map(p => p.id)).toEqual([2, 3, 1])
    })

    it('ranks WITHIN the non-bestseller bucket too, not just bestsellers', () => {
      const products = [
        makeProduct({ id: 1, badges_bestseller: false, review_count: 2 }),
        makeProduct({ id: 2, badges_bestseller: false, review_count: 30 }),
      ]
      expect(sortProducts(products, 'popular').map(p => p.id)).toEqual([2, 1])
    })

    it('falls back to newest-first when review counts tie (deterministic, not arbitrary)', () => {
      const products = [
        makeProduct({ id: 1, badges_bestseller: true, review_count: 10, created_at: '2026-01-01T00:00:00Z' }),
        makeProduct({ id: 2, badges_bestseller: true, review_count: 10, created_at: '2026-05-01T00:00:00Z' }),
      ]
      expect(sortProducts(products, 'popular').map(p => p.id)).toEqual([2, 1])
    })

    it('treats a missing review_count as 0, not a crash', () => {
      const products = [
        makeProduct({ id: 1, badges_bestseller: true, review_count: null }),
        makeProduct({ id: 2, badges_bestseller: true, review_count: 5 }),
      ]
      expect(sortProducts(products, 'popular').map(p => p.id)).toEqual([2, 1])
    })
  })

  it('does not mutate the input array (returns a new sorted array)', () => {
    const products = [makeProduct({ id: 1, price: 300 }), makeProduct({ id: 2, price: 100 })]
    const original = [...products]
    sortProducts(products, 'price_asc')
    expect(products).toEqual(original)
  })
})

describe('filterAndSortProducts (combined)', () => {
  it('filters first, then sorts the filtered result', () => {
    const products = [
      makeProduct({ id: 1, category_id: 10, price: 500 }),
      makeProduct({ id: 2, category_id: 20, price: 50 }), // filtered out
      makeProduct({ id: 3, category_id: 10, price: 100 }),
    ]
    const result = filterAndSortProducts(products, { categoryId: 10 }, 'price_asc')
    expect(result.map(p => p.id)).toEqual([3, 1])
  })
})

describe('paginateProducts', () => {
  const items = Array.from({ length: 50 }, (_, i) => i + 1)

  it('slices the correct page and reports totalPages', () => {
    const { pageItems, totalPages, totalCount } = paginateProducts(items, 1, 24)
    expect(pageItems).toHaveLength(24)
    expect(pageItems[0]).toBe(1)
    expect(totalPages).toBe(3) // 50 / 24 -> 3 pages
    expect(totalCount).toBe(50)
  })

  it('returns the correct second page', () => {
    const { pageItems } = paginateProducts(items, 2, 24)
    expect(pageItems[0]).toBe(25)
    expect(pageItems).toHaveLength(24)
  })

  it('returns the partial final page', () => {
    const { pageItems } = paginateProducts(items, 3, 24)
    expect(pageItems).toHaveLength(2) // 50 - 48
  })

  it('returns an empty page for an out-of-range page number (matches pre-existing behavior)', () => {
    const { pageItems } = paginateProducts(items, 99, 24)
    expect(pageItems).toHaveLength(0)
  })
})

describe('filterProducts — price range (premium UX feature)', () => {
  const products = [
    makeProduct({ id: 1, price: 100 }),
    makeProduct({ id: 2, price: 300 }),
    makeProduct({ id: 3, price: 500 }),
  ]

  it('filters out products below minPrice', () => {
    const result = filterProducts(products, { minPrice: 300 })
    expect(result.map(p => p.id)).toEqual([2, 3])
  })

  it('filters out products above maxPrice', () => {
    const result = filterProducts(products, { maxPrice: 300 })
    expect(result.map(p => p.id)).toEqual([1, 2])
  })

  it('applies both bounds together as an inclusive range', () => {
    const result = filterProducts(products, { minPrice: 200, maxPrice: 400 })
    expect(result.map(p => p.id)).toEqual([2])
  })

  it('uses the effective (variant-aware) price, not just the top-level price', () => {
    const variantProduct = makeProduct({
      id: 4, price: 999,
      product_variants: [{ id: 1, product_id: 4, price: 150, mrp: 150, size: '250g', available_stock: 5, is_active: true }],
    } as any)
    // top-level price (999) is outside the range, but the effective (base variant) price (150) is inside it
    const result = filterProducts([variantProduct], { minPrice: 100, maxPrice: 200 })
    expect(result).toHaveLength(1)
  })
})

describe('filterProducts — in-stock filter uses effective (variant-aware) stock', () => {
  /**
   * BUG FIX: previously checked raw `product.available_stock`, which could
   * disagree with what ProductCard actually displays for a variant product.
   */
  it('excludes a product whose base variant is out of stock, even if the top-level field says otherwise', () => {
    const product = makeProduct({
      id: 1, available_stock: 50, // top-level says plenty in stock...
      product_variants: [{ id: 1, product_id: 1, price: 100, mrp: 100, size: '1kg', available_stock: 0, is_active: true }],
    } as any)
    // ...but the (only, cheapest) active variant is out of stock, which is what the card shows
    expect(filterProducts([product], { inStockOnly: true })).toHaveLength(0)
  })

  it('includes a product whose base variant has stock, even if the top-level field says zero', () => {
    const product = makeProduct({
      id: 1, available_stock: 0,
      product_variants: [{ id: 1, product_id: 1, price: 100, mrp: 100, size: '1kg', available_stock: 4, is_active: true }],
    } as any)
    expect(filterProducts([product], { inStockOnly: true })).toHaveLength(1)
  })
})

describe('buildPaginationList — ellipsis pagination', () => {
  /**
   * BUG FIX (premium UX — was on the "not yet built" list): the pagination
   * bar used to render every single page number, e.g. 1 through 40 with no
   * collapsing — unusable once the catalog grows past a page or two.
   */
  it('shows every page when the total is small enough to not need collapsing', () => {
    expect(buildPaginationList(1, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('collapses a large page count around the current page with ellipses', () => {
    const result = buildPaginationList(6, 20)
    expect(result[0]).toBe(1)
    expect(result[result.length - 1]).toBe(20)
    expect(result).toContain('ellipsis')
    expect(result).toContain(6)
  })

  it('never emits two ellipses back to back', () => {
    const result = buildPaginationList(10, 20)
    for (let i = 1; i < result.length; i++) {
      if (result[i] === 'ellipsis') expect(result[i - 1]).not.toBe('ellipsis')
    }
  })

  it('does not show an ellipsis when the current page is near the start', () => {
    const result = buildPaginationList(1, 20)
    // window around page 1 reaches close to the left edge, only one ellipsis (near the end) expected
    expect(result.filter(x => x === 'ellipsis')).toHaveLength(1)
  })

  it('returns an empty array for zero pages', () => {
    expect(buildPaginationList(1, 0)).toEqual([])
  })
})
