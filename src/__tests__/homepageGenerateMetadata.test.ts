/**
 * homepageGenerateMetadata.test.ts
 *
 * Covers generateMetadata() in src/app/page.tsx — the root cause of a real,
 * live bug: sharing pahadiroots.com (the homepage — the single most-shared
 * URL on the site) in WhatsApp/Facebook showed the site's plain leaf
 * favicon instead of the real logo.
 *
 * Root cause: a page's own `openGraph`/`twitter` object REPLACES the
 * layout's entirely in Next.js (no deep-merge of nested fields). This
 * page's openGraph had no `images` field, so the homepage had zero
 * og:image in production, and chat apps fell back to the favicon. This
 * test locks in that the homepage's own openGraph/twitter always carries
 * an image, sourced from settings.og_image with a /logo.png fallback,
 * exactly matching layout.tsx's existing fallback behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetSiteSettings = vi.fn()
vi.mock('@/lib/getSiteSettings', () => ({
  getSiteSettings: () => mockGetSiteSettings(),
  isEnabled: (v: any, d = true) => (v === undefined ? d : v === 'true' || v === true),
}))

vi.mock('@/lib/storeData', () => ({
  getStoreData: vi.fn(),
  buildCategories: vi.fn(),
  getNormalizedProducts: vi.fn(),
}))
vi.mock('@/lib/normalizeProduct', () => ({ toCardProductData: vi.fn() }))
vi.mock('@/components/homepage/HeroBanner', () => ({ default: () => null }))
vi.mock('@/components/homepage/TrustBar', () => ({ default: () => null }))
vi.mock('@/components/homepage/CategoryTiles', () => ({ default: () => null }))
vi.mock('@/components/homepage/BestSellers', () => ({ default: () => null }))
vi.mock('@/components/homepage/ExploreByRegion', () => ({ default: () => null }))
vi.mock('@/components/homepage/WhySection', () => ({ default: () => null }))
vi.mock('@/components/homepage/ReviewsPreview', () => ({ default: () => null }))
vi.mock('@/components/homepage/NewArrivals', () => ({ default: () => null }))
vi.mock('@/components/homepage/FeaturedBanner', () => ({ default: () => null }))

const { generateMetadata } = await import('@/app/page')

beforeEach(() => {
  mockGetSiteSettings.mockReset()
})

describe('generateMetadata() (homepage) — og:image regression', () => {
  it('includes the real og_image from settings in openGraph AND twitter', async () => {
    mockGetSiteSettings.mockResolvedValue({
      site_name: 'HimVeda by Pahadi Roots',
      meta_title: 'HimVeda by Pahadi Roots | Pure Himalayan Natural Products',
      og_image: 'https://cdn.example.com/hero-banner.jpg',
    })

    const metadata = await generateMetadata()

    expect(metadata.openGraph?.images).toEqual([
      { url: 'https://cdn.example.com/hero-banner.jpg', width: 1200, height: 630, alt: 'HimVeda by Pahadi Roots | Pure Himalayan Natural Products' },
    ])
    expect((metadata.twitter as any)?.images).toEqual(['https://cdn.example.com/hero-banner.jpg'])
  })

  it('falls back to /logo.png (never an empty/missing image) when og_image is blank', async () => {
    mockGetSiteSettings.mockResolvedValue({})

    const metadata = await generateMetadata()

    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: '/logo.png' }),
    ])
    expect((metadata.twitter as any)?.images).toEqual(['/logo.png'])
  })
})
