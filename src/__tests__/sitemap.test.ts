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

const settingsState: { v: Record<string, string> } = { v: { show_blog: 'true' } }
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  settingsState.v = { show_blog: 'true' }
  vi.doMock('@/lib/getSiteSettings', async () => ({
    getSiteSettings: vi.fn(async () => settingsState.v),
    isEnabled: (await import('@/lib/siteSettingsHelpers')).isEnabled,
  }))
})
// Regions are only listed when they hold at least one live product (Nov 2026 verification), so the region tests seed one.
const HP_PRODUCT = { slug: 'apple', updated_at: null, image_url: null, category_id: 9, state_id: 'hp' }

function makeChain(rows: unknown[], capturedFilters: Record<string, unknown>[]) {
  const chain: any = {
    eq: (col: string, val: unknown) => { capturedFilters.push({ [col]: val }); return chain },
    order: () => chain,
    range: () => chain,
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
          select: () => makeChain(table === 'states' ? [{ id: 'hp' }] : table === 'products' ? [HP_PRODUCT] : [], filters),
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
          select: () => makeChain(table === 'states' ? [{ id: 'hp' }] : table === 'products' ? [HP_PRODUCT] : [], filters),
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
        order: () => chain,
        range: () => chain,
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
      }
      return chain
    }
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        from: (table: string) => ({
          select: () => (table === 'states' ? fullChain([{ id: 'hp' }]) : table === 'products' ? fullChain([HP_PRODUCT]) : fullChain([])),
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
            table === 'states' ? [{ id: 'hp', updated_at: knownDate }] : table === 'products' ? [HP_PRODUCT] : [],
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

  it('SEO fix — includes all 4 policy pages (shipping, returns, privacy, terms), previously absent entirely', async () => {
    vi.doMock('@/lib/supabase', () => ({
      supabase: {
        from: () => ({ select: () => makeChain([], []) }),
      },
    }))

    const { default: sitemap } = await import('@/app/sitemap')
    const entries = await sitemap()

    for (const slug of ['shipping', 'returns', 'privacy', 'terms']) {
      expect(entries.some(e => e.url.endsWith(`/policies/${slug}`))).toBe(true)
    }
  })

  it('does not stamp the build time on everything: pages take their content\'s last change; policy pages a fixed review date', async () => {
    vi.doMock('@/lib/supabase', () => ({
      supabase: { from: (table: string) => ({ select: () => makeChain(
        table === 'products' ? [{ slug: 'a', updated_at: '2026-09-01T00:00:00Z', image_url: null, category_id: 1 }, { slug: 'b', updated_at: '2026-10-05T00:00:00Z', image_url: null, category_id: 2 }]
        : table === 'categories' ? [{ id: 1, slug: 'honey' }, { id: 2, slug: 'ghee' }] : [], []) }) },
    }))
    const { default: sitemap } = await import('@/app/sitemap')
    const e = await sitemap()
    const at = (suffix: string) => new Date(e.find(x => x.url.endsWith(suffix))!.lastModified as Date).toISOString()
    expect(at('/products')).toBe('2026-10-05T00:00:00.000Z')            // newest product
    expect(at('/collections/honey')).toBe('2026-09-01T00:00:00.000Z')   // only its own products
    expect(at('/collections/ghee')).toBe('2026-10-05T00:00:00.000Z')
    expect(at('/policies/privacy')).toBe('2026-10-01T00:00:00.000Z')    // fixed, not "now"
  })

  it.each(['products', 'categories', 'states', 'blog_posts'])('R4-04: a %s read error is rethrown — a half-empty sitemap would tell Google those pages are gone', async (failing) => {
    const boom = { message: `${failing} unavailable`, code: '57014' }
    function chain(rows: unknown[], error: unknown) {
      const c: any = { eq: () => c, order: () => c, range: () => c, then: (res: (v: unknown) => unknown) => Promise.resolve({ data: error ? null : rows, error }).then(res) }
      return c
    }
    vi.doMock('@/lib/supabase', () => ({
      supabase: { from: (table: string) => ({ select: () => chain(table === 'states' ? [{ id: 'hp' }] : [], table === failing ? boom : null) }) },
    }))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { default: sitemap } = await import('@/app/sitemap')
    await expect(sitemap()).rejects.toBe(boom)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[sitemap]'), boom)
    errSpy.mockRestore()
  })

  it('Nov 2026 audit: a collection with no live products is NOT submitted to search engines', async () => {
    vi.doMock('@/lib/supabase', () => ({
      supabase: { from: (table: string) => ({ select: () => makeChain(
        table === 'products' ? [{ slug: 'a', updated_at: '2026-09-01T00:00:00Z', image_url: null, category_id: 1 }]
        : table === 'categories' ? [{ id: 1, slug: 'honey' }, { id: 2, slug: 'shilajit' }] : [], []) }) },
    }))
    const { default: sitemap } = await import('@/app/sitemap')
    const urls = (await sitemap()).map(x => x.url)
    expect(urls.some(u => u.endsWith('/collections/honey'))).toBe(true)
    expect(urls.some(u => u.endsWith('/collections/shilajit'))).toBe(false)   // empty → left out until it has stock
  })

  it('Nov 2026 verification: a region with no live products is left out of the sitemap', async () => {
    vi.doMock('@/lib/supabase', () => ({
      supabase: { from: (table: string) => ({ select: () => makeChain(
        table === 'products' ? [{ ...HP_PRODUCT, state_id: 'HP' }] : table === 'states' ? [{ id: 'hp' }, { id: 'jk' }] : [], []) }) },
    }))
    const { default: sitemap } = await import('@/app/sitemap')
    const urls = (await sitemap()).map(x => x.url)
    expect(urls.some(u => u.endsWith('/regions/hp'))).toBe(true)
    expect(urls.some(u => u.endsWith('/regions/jk'))).toBe(false)
    expect(urls.some(u => u.endsWith('/regions'))).toBe(true)   // the hub stays
  })

  it('Nov 2026 verification: /blog (+ posts), /our-stories and /mountain-stories follow their admin toggles', async () => {
    vi.doMock('@/lib/supabase', () => ({
      supabase: { from: (table: string) => ({ select: () => makeChain(table === 'blog_posts' ? [{ slug: 'post-1', updated_at: null, published_at: null }] : [], []) }) },
    }))
    settingsState.v = { show_blog: 'false', about_page_enabled: 'false', show_life_in_mountains: 'False' }
    let { default: sitemap } = await import('@/app/sitemap')
    let urls = (await sitemap()).map(x => x.url)
    for (const gone of ['/blog', '/blog/post-1', '/our-stories', '/mountain-stories']) expect(urls.some(u => u.endsWith(gone))).toBe(false)

    vi.resetModules()
    settingsState.v = { show_blog: 'true' }
    ;({ default: sitemap } = await import('@/app/sitemap'))
    urls = (await sitemap()).map(x => x.url)
    for (const there of ['/blog', '/blog/post-1', '/our-stories', '/mountain-stories']) expect(urls.some(u => u.endsWith(there))).toBe(true)
  })
})
