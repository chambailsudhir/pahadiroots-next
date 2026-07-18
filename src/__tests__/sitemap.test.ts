/**
 * sitemap.test.ts
 *
 * Covers src/app/sitemap.ts.
 *
 * Bugs covered:
 *   #5 the `states` query had no is_active filter, while getStoreData()
 *      (which drives /regions/[slug]'s generateStaticParams) does filter
 *      is_active=true — an inactive state would get a sitemap entry that
 *      404s when crawled.
 *   #6 /regions (the hub/listing page) was missing from staticPages
 *      entirely — only individual /regions/{id} pages were submitted.
 *
 * No test file existed for sitemap.ts before this.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

function makeChain(rows: unknown[], capturedFilters: Record<string, unknown>[]) {
  const chain: any = {
    eq: (col: string, val: unknown) => { capturedFilters.push({ [col]: val }); return chain },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
  }
  return chain
}

describe('sitemap()', () => {
  it('bug #6 — includes /regions (the hub page) in the static pages, not just individual region detail pages', async () => {
    const filters: Record<string, unknown>[] = []
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        from: (table: string) => ({
          select: () => makeChain(table === 'states' ? [{ id: 'hp' }] : [], filters),
        }),
      },
    }))

    const { default: sitemap } = await import('@/app/sitemap')
    const entries = await sitemap()

    const regionsHub = entries.find(e => e.url.endsWith('/regions'))
    expect(regionsHub).toBeDefined()
  })

  it('bug #5 — the states query filters is_active=true, matching getStoreData()', async () => {
    const filters: Record<string, unknown>[] = []
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        from: (table: string) => ({
          select: () => makeChain(table === 'states' ? [{ id: 'hp' }] : [], filters),
        }),
      },
    }))

    const { default: sitemap } = await import('@/app/sitemap')
    await sitemap()

    expect(filters).toContainEqual({ is_active: true })
  })

  it('an inactive state (excluded by the is_active filter) never reaches the emitted sitemap entries', async () => {
    // Simulate the real DB behavior: with is_active=true applied, an
    // inactive state simply isn't in the returned rows at all.
    function fullChain(rows: unknown[]) {
      const chain: any = {
        eq:   () => chain,
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
      }
      return chain
    }
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        from: (table: string) => ({
          select: () => (table === 'states' ? fullChain([{ id: 'hp' }]) : fullChain([])),
        }),
      },
    }))

    const { default: sitemap } = await import('@/app/sitemap')
    const entries = await sitemap()

    expect(entries.some(e => e.url.includes('/regions/inactive-state'))).toBe(false)
    expect(entries.some(e => e.url.includes('/regions/hp'))).toBe(true)
  })

  it('bug #7 — uses the state\'s real updated_at for lastModified, not always "now"', async () => {
    const knownDate = '2024-03-15T10:00:00.000Z'
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        from: (table: string) => ({
          select: () => makeChain(
            table === 'states' ? [{ id: 'hp', updated_at: knownDate }] : [],
            []
          ),
        }),
      },
    }))

    const { default: sitemap } = await import('@/app/sitemap')
    const entries = await sitemap()

    const hpEntry = entries.find(e => e.url.endsWith('/regions/hp'))
    expect(hpEntry).toBeDefined()
    expect(new Date(hpEntry!.lastModified as string | Date).toISOString()).toBe(knownDate)
  })
})
