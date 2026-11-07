/**
 * Redesign P0 (Nov 2026): the homepage category tiles and the shop filter chips must only list categories that have
 * a product to buy. Collection URLs stay live; only the links to empty ones disappear.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.doMock('@/lib/supabase', () => ({ supabase: {}, getServiceClient: () => ({}) }))
})

const cats = [
  { id: 1, slug: 'himalayan-honey', name: 'Himalayan Honey', sort_order: 1, show_on_homepage: true },
  { id: 2, slug: 'himalayan-tea',   name: 'Himalayan Tea',   sort_order: 2, show_on_homepage: true },
  { id: 3, slug: 'himalayan-ghee',  name: 'Himalayan Ghee',  sort_order: 3, show_on_homepage: true },
] as any[]

const store = (products: any[]) => ({
  products, product_images: [], product_variants: [], categories: cats, settings: {}, states: [], state_images: [],
}) as any

describe('withProducts', () => {
  it('keeps only categories that have at least one product', async () => {
    const { withProducts } = await import('@/lib/storeData')
    expect(withProducts(cats, [{ category_id: 1 }, { category_id: 3 }, { category_id: 3 }]).map(c => c.slug))
      .toEqual(['himalayan-honey', 'himalayan-ghee'])
  })

  it('matches ids stored as strings', async () => {
    const { withProducts } = await import('@/lib/storeData')
    expect(withProducts(cats, [{ category_id: '2' as any }]).map(c => c.id)).toEqual([2])
  })

  it('hides nothing when the product list is empty or missing (failed read)', async () => {
    const { withProducts } = await import('@/lib/storeData')
    expect(withProducts(cats, [])).toHaveLength(3)
    expect(withProducts(cats, undefined)).toHaveLength(3)
  })
})

describe('homepage and browse category lists', () => {
  it('buildCategories drops empty categories from the homepage tiles', async () => {
    const { buildCategories } = await import('@/lib/storeData')
    expect(buildCategories(store([{ id: 10, category_id: 1 }])).map(c => c.slug)).toEqual(['himalayan-honey'])
  })

  it('buildBrowseCategories drops empty categories from the filter chips', async () => {
    const { buildBrowseCategories } = await import('@/lib/storeData')
    expect(buildBrowseCategories(store([{ id: 10, category_id: 3 }, { id: 11, category_id: 1 }])).map(c => c.slug))
      .toEqual(['himalayan-honey', 'himalayan-ghee'])
  })
})
