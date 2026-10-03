/**
 * searchCatalogRoute.test.ts
 *
 * GET /api/v1/search-catalog (Issue 7, Oct 2026 audit): search used to query
 * Supabase from the browser and skip product_images / state_id. The route now
 * serves the same server-normalized catalogue Browse renders from.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getNormalizedProducts = vi.fn()

vi.mock('@/lib/storeData', () => ({
  getNormalizedProducts: () => getNormalizedProducts(),
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

beforeEach(() => {
  getNormalizedProducts.mockReset()
})

describe('GET /api/v1/search-catalog', () => {
  it('returns the normalized catalogue with product_images-derived image_url and state_id intact', async () => {
    getNormalizedProducts.mockResolvedValue([
      {
        id: 'p1', name: 'Wild Honey', slug: 'wild-honey',
        image_url: 'https://img.test/from-product-images.jpg',
        state_id: 7, category_id: 2,
        long_description: 'very long', ai_description: 'ai text', tags: ['a'],
        product_variants: [{ id: 'v1', price: 500, is_active: true, available_stock: 4 }],
      },
    ])
    const { GET } = await import('@/app/api/v1/search-catalog/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.products).toHaveLength(1)
    const p = json.products[0]
    expect(p.image_url).toBe('https://img.test/from-product-images.jpg')
    expect(p.state_id).toBe(7)
    expect(p.product_variants[0].price).toBe(500)
    // card-sized payload: heavy text fields are stripped
    expect(p.long_description).toBeNull()
    expect(p.ai_description).toBeNull()
  })

  it('sets a 60s shared-cache header matching the Browse listing freshness', async () => {
    getNormalizedProducts.mockResolvedValue([])
    const { GET } = await import('@/app/api/v1/search-catalog/route')
    const res = await GET()
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=60')
  })

  it('returns a 503 with a plain message (no internals) when the catalogue load fails', async () => {
    getNormalizedProducts.mockRejectedValue(new Error('pg: connection refused 10.0.0.5'))
    const { GET } = await import('@/app/api/v1/search-catalog/route')
    const res = await GET()
    expect(res.status).toBe(503)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('10.0.0.5')
    expect(text).toContain('temporarily unavailable')
  })
})
