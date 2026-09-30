// @vitest-environment jsdom
/**
 * HomePage.showBestSellers.test.tsx
 *
 * Covers the fix wiring settings.show_best_sellers into HomePage (src/app/page.tsx).
 *
 * Before this fix, show_best_sellers existed as a real, admin-configurable
 * site_settings key (same migration batch as show_trust_bar/show_new_arrivals/
 * show_reviews_section) but was never read in page.tsx — <BestSellers /> was
 * always rendered unconditionally, so toggling the setting in admin had zero
 * effect on the storefront either way.
 *
 * Every homepage child component is mocked to a simple identifiable stub so
 * this test exercises ONLY HomePage's own conditional-rendering logic, not
 * the children's internals (which have their own dedicated test files).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('@/lib/supabase', () => ({
  supabase:         {},
  getServiceClient: () => ({}),
}))
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag:  vi.fn(),
}))

const mockGetSiteSettings = vi.fn()
vi.mock('@/lib/getSiteSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/getSiteSettings')>()
  return { ...actual, getSiteSettings: () => mockGetSiteSettings() }
})

vi.mock('@/lib/storeData', () => ({
  getStoreData:          vi.fn(async () => ({
    products: [], product_images: [], product_variants: [],
    categories: [], settings: {}, states: [], state_images: [],
  })),
  buildCategories:       vi.fn(() => []),
  getNormalizedProducts: vi.fn(async () => []),
}))

// Stub every child component with a simple, greppable test id so we can
// assert on presence/absence without depending on their real rendering.
vi.mock('@/components/homepage/HeroBanner',      () => ({ default: () => <div data-testid="hero" /> }))
vi.mock('@/components/homepage/TrustBar',        () => ({ default: () => <div data-testid="trust-bar" /> }))
vi.mock('@/components/homepage/CategoryTiles',   () => ({ default: () => <div data-testid="category-tiles" /> }))
vi.mock('@/components/homepage/BestSellers',     () => ({ default: () => <div data-testid="best-sellers" /> }))
vi.mock('@/components/homepage/ExploreByRegion', () => ({ default: () => <div data-testid="explore-by-region" /> }))
vi.mock('@/components/homepage/WhySection',      () => ({ default: () => <div data-testid="why-section" /> }))
vi.mock('@/components/homepage/ReviewsPreview',  () => ({ default: () => <div data-testid="reviews-preview" /> }))
vi.mock('@/components/homepage/NewArrivals',     () => ({ default: () => <div data-testid="new-arrivals" /> }))
vi.mock('@/components/homepage/FeaturedBanner',  () => ({ default: () => <div data-testid="featured-banner" /> }))
vi.mock('@/components/story/BrandStory',      () => ({ default: () => <div data-testid="brand-story" /> }))
vi.mock('@/components/story/WhereTheyBegin',  () => ({ default: () => <div data-testid="where-they-begin" /> }))
vi.mock('@/components/story/RegionStories',   () => ({ default: () => <div data-testid="region-stories" /> }))
vi.mock('@/components/story/LifeInMountains', () => ({ default: () => <div data-testid="life-in-mountains" /> }))

function baseSettings(overrides: Record<string, string> = {}) {
  return {
    show_trust_bar:       'true',
    show_best_sellers:    'true',
    show_new_arrivals:    'true',
    show_reviews_section: 'true',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('HomePage — show_best_sellers wiring', () => {
  it('renders <BestSellers /> when show_best_sellers is "true"', async () => {
    mockGetSiteSettings.mockResolvedValue(baseSettings({ show_best_sellers: 'true' }))

    const HomePage = (await import('@/app/page')).default
    const el = await HomePage()
    render(el as React.ReactElement)

    expect(screen.getByTestId('best-sellers')).toBeTruthy()
  })

  it('does NOT render <BestSellers /> when show_best_sellers is "false"', async () => {
    mockGetSiteSettings.mockResolvedValue(baseSettings({ show_best_sellers: 'false' }))

    const HomePage = (await import('@/app/page')).default
    const el = await HomePage()
    render(el as React.ReactElement)

    expect(screen.queryByTestId('best-sellers')).toBeNull()
  })

  it('defaults to showing BestSellers when show_best_sellers is unset (matches isEnabled default-true behaviour)', async () => {
    const settings = baseSettings()
    delete (settings as any).show_best_sellers
    mockGetSiteSettings.mockResolvedValue(settings)

    const HomePage = (await import('@/app/page')).default
    const el = await HomePage()
    render(el as React.ReactElement)

    expect(screen.getByTestId('best-sellers')).toBeTruthy()
  })

  it('show_best_sellers=false does not affect other section toggles (they stay independently controlled)', async () => {
    mockGetSiteSettings.mockResolvedValue(baseSettings({
      show_best_sellers: 'false',
      show_trust_bar:    'true',
      show_new_arrivals: 'false',
    }))

    const HomePage = (await import('@/app/page')).default
    const el = await HomePage()
    render(el as React.ReactElement)

    expect(screen.queryByTestId('best-sellers')).toBeNull()
    expect(screen.getByTestId('trust-bar')).toBeTruthy()
    expect(screen.queryByTestId('new-arrivals')).toBeNull()
    // Sections with no toggle at all must always render regardless.
    expect(screen.getByTestId('category-tiles')).toBeTruthy()
    expect(screen.getByTestId('hero')).toBeTruthy()
  })
})
