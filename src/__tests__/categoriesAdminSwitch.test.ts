/**
 * Owner decision (Nov 2026): the admin "active" switch alone decides which categories are listed. Categories with no
 * products yet still appear on the homepage strip and in the shop filters (empty collection pages show a
 * "not available yet" state instead of "0 Products").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.doMock('@/lib/supabase', () => ({ supabase: {}, getServiceClient: () => ({}) }))
})

const store = {
  products: [{ id: 10, category_id: 1 }], product_images: [], product_variants: [], settings: {}, states: [], state_images: [],
  categories: [
    { id: 1, slug: 'himalayan-honey', name: 'Himalayan Honey', sort_order: 1, show_on_homepage: true },
    { id: 2, slug: 'himalayan-tea',   name: 'Himalayan Tea',   sort_order: 2, show_on_homepage: true },
  ],
} as any

describe('categories follow the admin switch, not product count', () => {
  it('shop filter chips include categories with no products', async () => {
    const { buildBrowseCategories } = await import('@/lib/storeData')
    expect(buildBrowseCategories(store).map(c => c.slug)).toEqual(['himalayan-honey', 'himalayan-tea'])
  })

  it('homepage strip includes categories with no products', async () => {
    const { buildCategories } = await import('@/lib/storeData')
    expect(buildCategories(store).map(c => c.slug)).toEqual(['himalayan-honey', 'himalayan-tea'])
  })
})
