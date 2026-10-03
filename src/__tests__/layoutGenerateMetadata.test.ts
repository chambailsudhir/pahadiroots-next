/**
 * layoutGenerateMetadata.test.ts
 *
 * Covers generateMetadata() in src/app/layout.tsx — previously untested
 * (listed as a known coverage gap in the audit session summary). This was
 * a real P1 fix: the admin panel's entire SEO tab (meta_title,
 * meta_description, meta_keywords, og_image) had zero effect on the live
 * site because layout.tsx exported a static `metadata` object instead of
 * generateMetadata(). These tests lock in that the live settings actually
 * reach the page, and that the fallbacks (unchanged from the old static
 * values) still work when a field is blank.
 *
 * layout.tsx also does heavy module-level work unrelated to
 * generateMetadata() (loads next/font/google, imports Header/Footer/etc,
 * fetches categories/states for RootLayout itself) — all mocked out below
 * so this file exercises generateMetadata() in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetSiteSettings = vi.fn()
vi.mock('@/lib/getSiteSettings', () => ({
  getSiteSettings: () => mockGetSiteSettings(),
}))

vi.mock('next/font/google', () => ({
  Playfair_Display: () => ({ variable: '--font-playfair' }),
  Lato: () => ({ variable: '--font-lato' }),
}))

vi.mock('@/lib/server/sanitize', () => ({ sanitizeHtml: (s: string) => s }))
// Layout reads categories/states via the cached getCatalogMeta() now (not
// Supabase directly) — see app/layout.tsx.
vi.mock('@/lib/storeData', () => ({
  getCatalogMeta: async () => ({ categories: [], states: [], state_images: [], settings: {} }),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [] }) }) }) }) },
}))

// RootLayout itself renders these, but generateMetadata() never touches
// them — stubbed purely so the module import resolves.
vi.mock('@/components/layout/Header', () => ({ default: () => null }))
vi.mock('@/components/layout/Footer', () => ({ default: () => null }))
vi.mock('@/components/layout/MobileMenu', () => ({ default: () => null }))
vi.mock('@/app/providers', () => ({ Providers: ({ children }: any) => children }))
vi.mock('@/components/ui/SkipLink', () => ({ default: () => null }))
vi.mock('@/components/ui/ScrollRestorationFix', () => ({ default: () => null }))
vi.mock('@/components/cart/CartDrawer', () => ({ default: () => null }))
vi.mock('@/components/search/SearchOverlay', () => ({ default: () => null }))
vi.mock('@/components/auth/AuthModal', () => ({ default: () => null }))
vi.mock('@/components/auth/GoogleAuthHandler', () => ({ default: () => null }))
vi.mock('@/components/ProfilePrefetcher', () => ({ default: () => null }))

const { generateMetadata } = await import('@/app/layout')

beforeEach(() => {
  mockGetSiteSettings.mockReset()
})

describe('generateMetadata() — admin SEO tab actually reaches the page', () => {
  it('uses meta_title / meta_description / meta_keywords / og_image from settings when set', async () => {
    mockGetSiteSettings.mockResolvedValue({
      site_name: 'HimVeda',
      meta_title: 'Buy Himalayan Honey Online — HimVeda',
      meta_description: 'Real admin-written SEO copy, not the fallback.',
      meta_keywords: 'himalayan honey, sea buckthorn, pahadi roots',
      og_image: 'https://cdn.example.com/real-og-banner.jpg',
    })

    const metadata = await generateMetadata()

    expect(metadata.title).toEqual({
      default: 'Buy Himalayan Honey Online — HimVeda',
      template: '%s | HimVeda',
    })
    expect(metadata.description).toBe('Real admin-written SEO copy, not the fallback.')
    expect(metadata.keywords).toEqual(['himalayan honey', 'sea buckthorn', 'pahadi roots'])
    expect(metadata.openGraph?.images).toEqual([
      { url: 'https://cdn.example.com/real-og-banner.jpg', width: 1200, height: 630, alt: 'Buy Himalayan Honey Online — HimVeda' },
    ])
  })

  it('falls back to the original hardcoded values when settings fields are blank', async () => {
    mockGetSiteSettings.mockResolvedValue({})

    const metadata = await generateMetadata()

    expect((metadata.title as any).default).toBe('HimVeda by Pahadi Roots — Natural Himalayan Products')
    expect(metadata.description).toMatch(/Pure, natural products sourced directly/)
    expect(metadata.keywords).toEqual(['himalayan products', 'natural honey', 'pahadi', 'mountain foods', 'natural', 'India'])
  })

  it("falls back og:image to logo.png, not the nonexistent og-default.jpg", async () => {
    mockGetSiteSettings.mockResolvedValue({})

    const metadata = await generateMetadata()

    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: '/logo.png' }),
    ])
  })

  it('splits and trims comma-separated meta_keywords, dropping empty entries', async () => {
    mockGetSiteSettings.mockResolvedValue({ meta_keywords: 'honey,  sea buckthorn ,, spices' })

    const metadata = await generateMetadata()

    expect(metadata.keywords).toEqual(['honey', 'sea buckthorn', 'spices'])
  })
})
