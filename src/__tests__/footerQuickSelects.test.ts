/**
 * Footer "Quick Selects" must come from the admin's categories (active, admin sort order), so the
 * footer can never drift from what the owner manages — it used to be a hard-coded list that listed
 * an "Ancient Grains" category that does not exist.
 */
import { describe, it, expect } from 'vitest'
import { quickSelects, kindForCategory, FALLBACK_QUICK_SELECTS } from '@/lib/footerQuickSelects'

// The real categories, in admin sort order.
const live = [
  ['Himalayan Honey', 'himalayan-honey'], ['Shilajit', 'shilajit'], ['Pulses & Dal', 'pulses-and-dal'],
  ['Mountain Juices', 'mountain-juices'], ['Himalayan Tea', 'himalayan-tea'], ['Herbs & Spices', 'herbs-and-spices'],
  ['Heritage Rice', 'heritage-rice'], ['Natural Oils', 'natural-oils'], ['Jams & Preserves', 'jams-and-preserves'],
  ['Himalayan Ghee', 'himalayan-ghee'],
].map(([name, slug]) => ({ name, slug, emoji: null }))

describe('quickSelects', () => {
  it('uses the admin names, order and links — first 6 by default', () => {
    const q = quickSelects(live, {})
    expect(q.map(x => x.label)).toEqual(['Himalayan Honey', 'Shilajit', 'Pulses & Dal', 'Mountain Juices', 'Himalayan Tea', 'Herbs & Spices'])
    expect(q[0].href).toBe('/collections/himalayan-honey')
  })

  it('a renamed / reordered category shows up with no code change', () => {
    const q = quickSelects([{ name: 'Wild Honey', slug: 'himalayan-honey' }, ...live.slice(1)], {})
    expect(q[0]).toMatchObject({ label: 'Wild Honey', href: '/collections/himalayan-honey' })
  })

  it('footer_quick_selects_count controls how many (1–12; junk → 6)', () => {
    expect(quickSelects(live, { footer_quick_selects_count: '10' })).toHaveLength(10)
    expect(quickSelects(live, { footer_quick_selects_count: '0' })).toHaveLength(1)
    expect(quickSelects(live, { footer_quick_selects_count: 'abc' })).toHaveLength(6)
  })

  it('admin emoji wins; otherwise a sensible one per kind', () => {
    expect(quickSelects([{ name: 'Honey', slug: 'honey', emoji: '🐝' }])[0].emoji).toBe('🐝')
    expect(quickSelects([{ name: 'Honey', slug: 'honey' }])[0].emoji).toBe('🍯')
  })

  it('never links an unsafe slug; skips blanks and duplicates', () => {
    const q = quickSelects([{ name: 'Bad', slug: '../admin' }, { name: '', slug: 'x' }, { name: 'Ok', slug: 'ok' }, { name: 'Dup', slug: 'ok' }])
    expect(q.map(x => x.href)).toEqual(['/collections/ok'])
  })

  it('falls back to the static list only when no categories could be loaded', () => {
    expect(quickSelects([])).toHaveLength(FALLBACK_QUICK_SELECTS.length)
    expect(quickSelects(null)).toHaveLength(FALLBACK_QUICK_SELECTS.length)
    expect(quickSelects(undefined, { footer_quick_selects_count: '3' })).toHaveLength(3)
  })

  it('every fallback link points at a real category slug', () => {
    const slugs = new Set(live.map(c => c.slug))
    for (const f of FALLBACK_QUICK_SELECTS) expect(slugs.has(f.href.replace('/collections/', ''))).toBe(true)
  })
})

describe('kindForCategory', () => {
  it.each([
    ['himalayan-honey', 'honey'], ['jams-and-preserves', 'honey'], ['himalayan-ghee', 'ghee'], ['natural-oils', 'ghee'],
    ['shilajit', 'stone'], ['himalayan-tea', 'tea'], ['mountain-juices', 'tea'], ['heritage-rice', 'grain'],
    ['pulses-and-dal', 'grain'], ['herbs-and-spices', 'saffron'], ['brand-new-category', 'saffron'],
  ])('%s → %s', (slug, kind) => { expect(kindForCategory(slug)).toBe(kind) })
})
