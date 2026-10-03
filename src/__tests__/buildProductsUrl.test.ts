/**
 * buildProductsUrl.test.ts
 *
 * Covers the shared /products filter-URL builder extracted so the desktop
 * sidebar (server component) and the new MobileFilterBar drawer (client
 * component, added to fix the "sidebar just vanishes on mobile" bug) build
 * identical hrefs from one source of truth instead of two hand-duplicated
 * query-string builders that could silently drift apart.
 */

import { describe, it, expect } from 'vitest'
import { buildProductsUrl } from '@/lib/buildProductsUrl'

const base = { sort: 'newest', category: '', state: '', instock: false }

describe('buildProductsUrl', () => {
  it('returns the bare /products path when no filters are active', () => {
    expect(buildProductsUrl(base, {})).toBe('/products')
  })

  it('always resets to page 1 when changing a filter (no override needed)', () => {
    expect(buildProductsUrl(base, { category: 'honey' })).toBe('/products?category=honey')
  })

  it('preserves an existing sort when only the category changes', () => {
    const url = buildProductsUrl({ ...base, sort: 'price_asc' }, { category: 'spices' })
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('sort')).toBe('price_asc')
    expect(params.get('category')).toBe('spices')
  })

  it('omits sort=newest from the querystring (it is the default)', () => {
    const url = buildProductsUrl(base, { category: 'grains' })
    expect(url).not.toContain('sort=')
  })

  it('explicitly clearing a filter via undefined override removes it from the URL', () => {
    const withState = { ...base, state: '4' }
    expect(buildProductsUrl(withState, { state: undefined })).toBe('/products')
  })

  it('sets page only when explicitly overridden above 1', () => {
    const url = buildProductsUrl(base, { page: '3' })
    expect(url).toBe('/products?page=3')
  })

  it('represents instock=true explicitly and omits it when false', () => {
    expect(buildProductsUrl(base, { instock: 'true' })).toContain('instock=true')
    expect(buildProductsUrl(base, {})).not.toContain('instock')
  })

  it('includes minPrice/maxPrice when set as overrides', () => {
    const url = buildProductsUrl(base, { minPrice: '200', maxPrice: '800' })
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('minPrice')).toBe('200')
    expect(params.get('maxPrice')).toBe('800')
  })

  // Issue 6.5 (Oct 2026 audit): the price range is bounded by the category's
  // own products, so it is reset when the category changes (it used to carry
  // over, which could yield zero results or an inverted range).
  it('resets the price range when the category changes', () => {
    const withPrice = { ...base, minPrice: '100', maxPrice: '500' }
    const url = buildProductsUrl(withPrice, { category: 'honey' })
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('minPrice')).toBeNull()
    expect(params.get('maxPrice')).toBeNull()
    expect(params.get('category')).toBe('honey')
  })

  it('keeps the price range when the category override equals the current category', () => {
    const withPrice = { ...base, category: 'honey', minPrice: '100', maxPrice: '500' }
    const params = new URLSearchParams(buildProductsUrl(withPrice, { category: 'honey' }).split('?')[1])
    expect(params.get('minPrice')).toBe('100')
    expect(params.get('maxPrice')).toBe('500')
  })

  it('explicitly clearing the price range removes both params', () => {
    const withPrice = { ...base, minPrice: '100', maxPrice: '500' }
    const url = buildProductsUrl(withPrice, { minPrice: undefined, maxPrice: undefined })
    expect(url).not.toContain('minPrice')
    expect(url).not.toContain('maxPrice')
  })
})
