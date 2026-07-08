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
})
