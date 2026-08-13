/**
 * storeDataCategoryImages.test.ts
 *
 * BUG FIX covered here: imgFor()/buildCategories() had zero test coverage
 * before this file. That's how a category (Himalayan Honey) silently shipped
 * with no image for an unknown length of time — categories.image_url sat
 * unpopulated while every category card actually depended on a
 * case-sensitive site_settings key (coll_img_<slug>) built from a name/slug
 * that had drifted from what was actually stored, and nothing caught it.
 *
 * Root cause (confirmed against live DB, not guessed): categories.image_url
 * is the real column — already used elsewhere (admin Catalogue tab) — but
 * imgFor() only fell back to it as a last resort AFTER four different
 * settings-key lookup attempts, all of which are case-sensitive plain object
 * key lookups. "Himalayan Honey" (slug: himalayan-honey) had its image saved
 * under "coll_img_Himalayan-honey" (capital H) — none of the four lookup
 * attempts (slug / name / name.toLowerCase() / id) matched it, so the
 * category rendered with no image at all, silently, in production.
 *
 * imgFor() now treats categories.image_url as the single source of truth,
 * and only consults the legacy settings keys as an observable (logged)
 * fallback — see storeData.ts for the full rationale.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.doMock('@/lib/supabase', () => ({
    supabase: {},
    getServiceClient: () => ({}),
  }))
})

describe('imgFor', () => {
  it('uses categories.image_url directly when set — no settings lookup needed', async () => {
    const { imgFor } = await import('@/lib/storeData')
    const cat = { id: 1, slug: 'himalayan-honey', name: 'Himalayan Honey', image_url: 'https://cdn.example.com/honey.jpg' } as any
    // Deliberately includes a legacy key that would match if the code
    // regressed to checking settings first — proves image_url wins.
    const settings = { 'coll_img_himalayan-honey': 'https://cdn.example.com/WRONG.jpg' }
    expect(imgFor(cat, settings)).toBe('https://cdn.example.com/honey.jpg')
  })

  it('regression guard: resolves correctly even when the legacy settings key is mis-cased relative to slug', async () => {
    const { imgFor } = await import('@/lib/storeData')
    // Mirrors the exact real-world case (himalayan-honey vs coll_img_Himalayan-honey):
    // with image_url populated (post-migration state), the mis-cased legacy key is
    // irrelevant — this is the actual production fix being verified.
    const cat = { id: 1, slug: 'himalayan-honey', name: 'Himalayan Honey', image_url: 'https://cdn.example.com/honey.jpg' } as any
    const settings = { 'coll_img_Himalayan-honey': 'https://cdn.example.com/legacy.jpg' }
    expect(imgFor(cat, settings)).toBe('https://cdn.example.com/honey.jpg')
  })

  it('falls back to legacy coll_img_<slug> settings key when image_url is empty', async () => {
    const { imgFor } = await import('@/lib/storeData')
    const cat = { id: 2, slug: 'heritage-rice', name: 'Heritage Rice', image_url: null } as any
    const settings = { 'coll_img_heritage-rice': 'https://cdn.example.com/rice.jpg' }
    expect(imgFor(cat, settings)).toBe('https://cdn.example.com/rice.jpg')
  })

  it('falls back through name / lowercase-name / id when slug does not match any settings key', async () => {
    const { imgFor } = await import('@/lib/storeData')
    const cat = { id: 9, slug: 'jams-and-preserves', name: 'Jams & Preserves', image_url: null } as any
    const settings = { 'coll_img_9': 'https://cdn.example.com/jams.jpg' }
    expect(imgFor(cat, settings)).toBe('https://cdn.example.com/jams.jpg')
  })

  it('returns empty string when neither image_url nor any legacy key matches — never throws, never returns undefined', async () => {
    const { imgFor } = await import('@/lib/storeData')
    const cat = { id: 3, slug: 'shilajit', name: 'Shilajit', image_url: null } as any
    expect(imgFor(cat, {})).toBe('')
  })
})

describe('buildCategories', () => {
  it('attaches image_url from categories.image_url for every category, matching live-DB shape post-migration', async () => {
    const { buildCategories } = await import('@/lib/storeData')
    const storeData = {
      categories: [
        { id: 1, slug: 'himalayan-honey', name: 'Himalayan Honey', image_url: 'https://cdn.example.com/honey.jpg', sort_order: 0, is_active: true },
        { id: 2, slug: 'heritage-rice', name: 'Heritage Rice', image_url: 'https://cdn.example.com/rice.jpg', sort_order: 0, is_active: true },
      ],
      settings: {},
    } as any

    const result = buildCategories(storeData)
    expect(result.find((c: any) => c.slug === 'himalayan-honey')?.image_url).toBe('https://cdn.example.com/honey.jpg')
    expect(result.find((c: any) => c.slug === 'heritage-rice')?.image_url).toBe('https://cdn.example.com/rice.jpg')
  })

  it('still respects coll_hidden_<slug> as a legacy fallback when show_on_homepage is unset', async () => {
    const { buildCategories } = await import('@/lib/storeData')
    const storeData = {
      categories: [
        { id: 1, slug: 'discontinued', name: 'Discontinued', image_url: null, sort_order: 0, is_active: true },
      ],
      settings: { coll_hidden_discontinued: 'true' },
    } as any

    expect(buildCategories(storeData)).toHaveLength(0)
  })

  it('uses categories.show_on_homepage directly and ignores a stale legacy coll_hidden_ key', async () => {
    const { buildCategories } = await import('@/lib/storeData')
    const storeData = {
      categories: [
        { id: 1, slug: 'himalayan-honey', name: 'Himalayan Honey', image_url: null, sort_order: 0, is_active: true, show_on_homepage: true },
      ],
      // Stale legacy key says hidden — show_on_homepage:true must win.
      settings: { 'coll_hidden_himalayan-honey': 'true' },
    } as any

    expect(buildCategories(storeData)).toHaveLength(1)
  })

  it('hides a category when show_on_homepage is explicitly false, regardless of legacy settings', async () => {
    const { buildCategories } = await import('@/lib/storeData')
    const storeData = {
      categories: [
        { id: 1, slug: 'discontinued', name: 'Discontinued', image_url: null, sort_order: 0, is_active: true, show_on_homepage: false },
      ],
      settings: {},
    } as any

    expect(buildCategories(storeData)).toHaveLength(0)
  })
})
