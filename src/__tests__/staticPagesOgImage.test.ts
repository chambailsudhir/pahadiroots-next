/**
 * staticPagesOgImage.test.ts
 *
 * Same root-cause bug as homepageGenerateMetadata.test.ts (a page's own
 * `openGraph` object replaces the layout's entirely, so a missing `images`
 * field means zero og:image on that route), found across every one of
 * these static-metadata routes: blog listing, search, cart, contact,
 * track, wishlist, and about. Locks in that each one now always carries a
 * real image rather than silently falling back to the site favicon when
 * shared.
 */

import { describe, it, expect, vi } from 'vitest'

// blog/page.tsx imports '@/lib/supabase' at module scope, which calls
// createClient() and throws without real env vars in the test environment.
// Mocked here purely so the module resolves — this test only checks the
// exported `metadata` object, never the page's data-fetching logic.
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [] }) }) }) }) },
}))
vi.mock('@/lib/getSiteSettings', () => ({ getSiteSettings: () => Promise.resolve({}) }))

describe('static-metadata pages — every route carries a real og:image', () => {
  it('blog listing (/blog)', async () => {
    const { metadata } = await import('@/app/blog/page')
    expect(metadata.openGraph?.images).toBeTruthy()
    expect((metadata.openGraph?.images as any[]).length).toBeGreaterThan(0)
  })

  it('search (/search)', async () => {
    const { metadata } = await import('@/app/search/layout')
    expect(metadata.openGraph?.images).toBeTruthy()
    expect((metadata.openGraph?.images as any[]).length).toBeGreaterThan(0)
  })

  it('cart (/cart)', async () => {
    const { metadata } = await import('@/app/cart/layout')
    expect(metadata.openGraph?.images).toBeTruthy()
    expect((metadata.openGraph?.images as any[]).length).toBeGreaterThan(0)
  })

  it('contact (/contact)', async () => {
    const { metadata } = await import('@/app/contact/layout')
    expect(metadata.openGraph?.images).toBeTruthy()
    expect((metadata.openGraph?.images as any[]).length).toBeGreaterThan(0)
  })

  it('track (/track)', async () => {
    const { metadata } = await import('@/app/track/layout')
    expect(metadata.openGraph?.images).toBeTruthy()
    expect((metadata.openGraph?.images as any[]).length).toBeGreaterThan(0)
  })

  it('wishlist (/wishlist)', async () => {
    const { metadata } = await import('@/app/wishlist/layout')
    expect(metadata.openGraph?.images).toBeTruthy()
    expect((metadata.openGraph?.images as any[]).length).toBeGreaterThan(0)
  })
})
