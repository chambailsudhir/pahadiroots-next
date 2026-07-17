// @vitest-environment jsdom
/**
 * regionDetailPage.test.ts
 *
 * Covers src/app/regions/[slug]/page.tsx.
 *
 * Bugs covered:
 *   #1  case-mismatch state_id filter — the OLD code only lowercased
 *       state.id, never the product's own state_id, so it could never
 *       actually catch a casing mismatch. This test proves the current
 *       version does.
 *   #3  detail page previously never used REGION_META — hardcoded dark-green
 *       hero + raw (possibly null) state.description only. Now uses
 *       meta.panelBg / meta.description / meta.pills.
 *   #13 no canonical URL in generateMetadata
 *   #14 no openGraph block in generateMetadata
 *   #15 404 case didn't set robots: noindex
 *   #19 low-contrast empty-state text (#999 → #666, both instances)
 *   #20 breadcrumb said "Home / Products / Regions / {State}" — wrong
 *       hierarchy, and "Regions" wasn't even a link
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/image', () => ({
  default: (props: { alt: string; src: string }) =>
    React.createElement('img', { alt: props.alt, src: props.src }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

const HP_STATE = { id: 'hp', name: 'Himachal Pradesh', description: 'Raw DB description.' }

describe('generateMetadata', () => {
  it('bug #13/#14 — sets canonical + openGraph for a valid state', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getStoreData: vi.fn(async () => ({ states: [HP_STATE], state_images: [] })),
      getNormalizedProducts: vi.fn(async () => ([])),
    }))

    const { generateMetadata } = await import('@/app/regions/[slug]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'hp' }) })

    expect(meta.alternates?.canonical).toContain('/regions/hp')
    expect(meta.openGraph).toBeDefined()
    expect((meta.openGraph as any).url).toContain('/regions/hp')
    expect((meta.openGraph as any).images?.[0]).toBeDefined()
  })

  it('bug #15 — sets robots: noindex when the state does not exist', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getStoreData: vi.fn(async () => ({ states: [HP_STATE], state_images: [] })),
      getNormalizedProducts: vi.fn(async () => ([])),
    }))

    const { generateMetadata } = await import('@/app/regions/[slug]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'nonexistent' }) })

    expect(meta.robots).toEqual({ index: false, follow: false })
  })

  it('#3 follow-on — SEO description matches the curated meta.description, not just the raw DB value, ' +
     'so the search snippet and the on-page copy don\'t silently disagree', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getStoreData: vi.fn(async () => ({ states: [HP_STATE], state_images: [] })),
      getNormalizedProducts: vi.fn(async () => ([])),
    }))

    const { generateMetadata } = await import('@/app/regions/[slug]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'hp' }) })

    // The curated copy for 'hp' starts with "Himachal Pradesh — Dev Bhoomi" —
    // if this were still reading raw state.description it would instead be
    // "Raw DB description."
    expect(meta.description).toMatch(/Dev Bhoomi/)
  })
})

describe('RegionPage (default export)', () => {
  it('bug #1 — filters products by state_id case-insensitively', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getStoreData: vi.fn(async () => ({ states: [HP_STATE], state_images: [] })),
      getNormalizedProducts: vi.fn(async () => ([
        { id: 1, name: 'Wild Honey', slug: 'wild-honey', state_id: 'HP' },
        { id: 2, name: 'Rajma',      slug: 'rajma',      state_id: 'uk' },
      ])),
    }))
    vi.doMock('@/lib/normalizeProduct', () => ({
      toCardProductData: (p: any) => p,
    }))
    vi.doMock('@/components/product/ProductCard', () => ({
      default: ({ product }: { product: { name: string } }) =>
        React.createElement('div', { 'data-testid': 'product-card' }, product.name),
    }))

    const { default: RegionPage } = await import('@/app/regions/[slug]/page')
    const element = await RegionPage({ params: Promise.resolve({ slug: 'hp' }) })
    render(element as React.ReactElement)

    expect(screen.getByText('Wild Honey')).toBeTruthy()
    expect(screen.queryByText('Rajma')).toBeNull()
  })

  it('bug #3 — hero uses the per-region panelBg color, and shows curated description + pills', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getStoreData: vi.fn(async () => ({ states: [HP_STATE], state_images: [] })),
      getNormalizedProducts: vi.fn(async () => ([])),
    }))
    vi.doMock('@/lib/normalizeProduct', () => ({ toCardProductData: (p: any) => p }))
    vi.doMock('@/components/product/ProductCard', () => ({ default: () => null }))

    const { default: RegionPage } = await import('@/app/regions/[slug]/page')
    const element = await RegionPage({ params: Promise.resolve({ slug: 'hp' }) })
    const { container } = render(element as React.ReactElement)

    // Curated copy, not the raw "Raw DB description." fallback.
    expect(screen.getByText(/Dev Bhoomi, the Land of Gods/)).toBeTruthy()
    // At least one of the curated pills renders.
    expect(screen.getByText(/Kangra Tea/)).toBeTruthy()
    // Hero background is the HP-specific gradient, not the old hardcoded
    // '#1a3a1e,#2d5a35' default used for every state pre-fix. jsdom
    // normalizes hex colors to rgb() when serializing the style attribute
    // (verified by inspecting actual render output), so we match on that.
    const hero = container.querySelector('div[style*="linear-gradient(135deg, rgb(26, 58, 30), rgb(45, 82, 51))"]')
    expect(hero).toBeTruthy()
  })

  it('bug #20 — breadcrumb reads Home / Regions / {State}, not Home / Products / Regions / {State}, ' +
     'and "Regions" is a real link to /regions', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getStoreData: vi.fn(async () => ({ states: [HP_STATE], state_images: [] })),
      getNormalizedProducts: vi.fn(async () => ([])),
    }))
    vi.doMock('@/lib/normalizeProduct', () => ({ toCardProductData: (p: any) => p }))
    vi.doMock('@/components/product/ProductCard', () => ({ default: () => null }))

    const { default: RegionPage } = await import('@/app/regions/[slug]/page')
    const element = await RegionPage({ params: Promise.resolve({ slug: 'hp' }) })
    render(element as React.ReactElement)

    expect(screen.queryByText('Products', { selector: 'a' })).toBeNull()
    const regionsLink = screen.getByRole('link', { name: 'Regions' })
    expect(regionsLink.getAttribute('href')).toBe('/regions')
  })

  it('bug #19 — empty-state text and product-count badge use #666, not the low-contrast #999', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getStoreData: vi.fn(async () => ({ states: [HP_STATE], state_images: [] })),
      getNormalizedProducts: vi.fn(async () => ([])), // no products → empty state renders
    }))
    vi.doMock('@/lib/normalizeProduct', () => ({ toCardProductData: (p: any) => p }))
    vi.doMock('@/components/product/ProductCard', () => ({ default: () => null }))

    const { default: RegionPage } = await import('@/app/regions/[slug]/page')
    const element = await RegionPage({ params: Promise.resolve({ slug: 'hp' }) })
    const { container } = render(element as React.ReactElement)

    const html = container.innerHTML
    // #999 = rgb(153, 153, 153); #666 = rgb(102, 102, 102) — jsdom
    // normalizes hex to rgb() (verified against actual render output).
    expect(html).not.toContain('rgb(153, 153, 153)')
    // both the empty-state paragraph and the (0) count badge
    expect((html.match(/rgb\(102, 102, 102\)/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('calls notFound() for an unknown state', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getStoreData: vi.fn(async () => ({ states: [HP_STATE], state_images: [] })),
      getNormalizedProducts: vi.fn(async () => ([])),
    }))

    const { default: RegionPage } = await import('@/app/regions/[slug]/page')
    await expect(RegionPage({ params: Promise.resolve({ slug: 'nonexistent' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND')
  })
})

