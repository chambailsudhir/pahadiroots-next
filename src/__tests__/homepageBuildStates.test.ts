/**
 * homepageBuildStates.test.ts
 *
 * Covers buildStates() in src/app/page.tsx (the homepage's data-shaping step
 * for the ExploreByRegion widget).
 *
 * Bugs covered:
 *   #1 (3rd instance) — same case-mismatch pattern as /regions/page.tsx and
 *      /regions/[slug]/page.tsx: product.state_id was compared against
 *      states.id with no case normalization.
 *   #4 — products were passed to ProductCard without toCardProductData()
 *      stripping the unused AI-content fields first, shipping them into the
 *      RSC payload for nothing (the exact anti-pattern already fixed on
 *      /regions/[slug], but missed here).
 *
 * buildStates() was made an exported function specifically so it could be
 * tested directly, without rendering the entire homepage tree. It calls the
 * shared getNormalizedProducts() helper internally (see storeData.ts), so
 * that's what gets mocked here rather than storeData.products.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase:         {},
  getServiceClient: () => ({}),
}))
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag:  vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

function makeStoreData(states: any[]) {
  return {
    products: [],
    product_images: [],
    product_variants: [],
    categories: [],
    settings: {},
    states,
    state_images: [],
  }
}

describe('buildStates', () => {
  it('bug #1 — matches a product to its state even when state_id casing differs from the state\'s own id', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getNormalizedProducts: vi.fn(async () => ([
        { id: 1, name: 'Wild Honey', slug: 'wild-honey', price: 500, state_id: 'HP' },
        { id: 2, name: 'Rajma',      slug: 'rajma',      price: 200, state_id: 'uk' },
      ])),
    }))

    const { buildStates } = await import('@/app/page')
    const storeData = makeStoreData([{ id: 'hp', name: 'Himachal Pradesh', description: null }])

    const result = await buildStates(storeData as any)

    expect(result).toHaveLength(1)
    expect(result[0].products).toHaveLength(1)
    expect((result[0].products[0] as any).name).toBe('Wild Honey')
  })

  it('bug #4 — strips AI-content fields from products before they\'re handed to ProductCard', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getNormalizedProducts: vi.fn(async () => ([
        {
          id: 1, name: 'Wild Honey', slug: 'wild-honey', price: 500, state_id: 'hp',
          long_description: 'A very long description...',
          short_description: 'Short desc',
          tags: ['organic', 'raw'],
          ai_description: 'AI generated text',
          ai_health_benefits: 'AI health text',
          ai_how_to_use: 'AI usage text',
          ai_storage_tips: 'AI storage text',
          ai_who_should_buy: 'AI buyer text',
        },
      ])),
    }))

    const { buildStates } = await import('@/app/page')
    const storeData = makeStoreData([{ id: 'hp', name: 'Himachal Pradesh', description: null }])

    const result = await buildStates(storeData as any)
    const product = result[0].products[0] as any

    // toCardProductData() explicitly nulls these out — see normalizeProduct.ts.
    expect(product.long_description).toBeNull()
    expect(product.short_description).toBeNull()
    expect(product.tags).toBeNull()
    expect(product.ai_description).toBeFalsy()
    expect(product.ai_health_benefits).toBeFalsy()
  })

  it('caps products per state at 4, matching the homepage widget\'s display limit', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getNormalizedProducts: vi.fn(async () => (
        Array.from({ length: 8 }, (_, i) => ({
          id: i, name: `Product ${i}`, slug: `product-${i}`, price: 100, state_id: 'hp',
        }))
      )),
    }))

    const { buildStates } = await import('@/app/page')
    const storeData = makeStoreData([{ id: 'hp', name: 'Himachal Pradesh', description: null }])

    const result = await buildStates(storeData as any)
    expect(result[0].products).toHaveLength(4)
  })

  it('returns an empty array when there are no states (and never calls getNormalizedProducts needlessly)', async () => {
    const getNormalizedProducts = vi.fn(async () => ([]))
    vi.doMock('@/lib/storeData', () => ({ getNormalizedProducts }))

    const { buildStates } = await import('@/app/page')
    const result = await buildStates(makeStoreData([]) as any)

    expect(result).toEqual([])
    expect(getNormalizedProducts).not.toHaveBeenCalled()
  })
})
