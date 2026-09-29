/**
 * revalidateSettingsRoute.test.ts
 *
 * Direct route-level tests for POST /api/v1/revalidate with { settings: true }.
 *
 * BUG (live report): admin changed site_settings.free_shipping_min (0 -> 100)
 * in pahadi-admin's Settings page; the storefront /checkout page kept showing
 * "FREE" shipping on a sub-threshold order for several minutes afterward.
 *
 * Root cause: src/app/checkout/page.tsx is a server component that calls
 * getSiteSettings() directly and has no `revalidate`/`dynamic` export of its
 * own, so it inherits the root layout's `revalidate = 300` and is cached as
 * its own full-route-cache entry. clearSiteSettingsCache() clears the
 * in-process *data* cache, but nothing previously told Next to throw away
 * /checkout's cached *page* output — revalidatePath('/', 'layout') only
 * covers content rendered by the layout itself (Header/Footer), not a
 * sibling route's own cache entry, exactly as already true (and already
 * fixed) for /api/v1/cart-settings.
 *
 * The same gap existed for every other cached route that reads
 * getSiteSettings() directly: /products/[slug] (free_shipping_min PDP copy,
 * revalidate=3600) and /our-stories (its ~30 about_* fields, revalidate=3600) and
 * /blog (show_blog gate, revalidate=3600).
 *
 * These tests lock in that a { settings: true } revalidation call now clears
 * the in-process cache AND revalidates every one of those routes, in
 * addition to the previously-covered ones.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const revalidatePathMock = vi.fn()

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}))

vi.mock('@/lib/storeData', () => ({
  getStoreData: vi.fn(async () => ({})),
}))

const clearSiteSettingsCacheMock = vi.fn()
vi.mock('@/lib/getSiteSettings', () => ({
  clearSiteSettingsCache: () => clearSiteSettingsCacheMock(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  captureError: vi.fn(),
}))

const SECRET = 'test-revalidate-secret'

function makeRequest(body: unknown) {
  return new Request('https://pahadiroots.com/api/v1/revalidate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest
}

describe('POST /api/v1/revalidate — { settings: true }', () => {
  beforeEach(() => {
    vi.resetModules()
    revalidatePathMock.mockClear()
    clearSiteSettingsCacheMock.mockClear()
    process.env.REVALIDATE_SECRET = SECRET
  })

  it('clears the in-process settings cache and revalidates every route that reads getSiteSettings() server-side', async () => {
    const { POST } = await import('@/app/api/v1/revalidate/route')

    const res = await POST(makeRequest({ settings: true }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(clearSiteSettingsCacheMock).toHaveBeenCalledTimes(1)

    const calledPaths = revalidatePathMock.mock.calls.map(call => call[0])

    // Pre-existing coverage (must not regress)
    expect(calledPaths).toContain('/')
    expect(calledPaths).toContain('/maintenance')
    expect(calledPaths).toContain('/api/v1/cart-settings')

    // The bug: /checkout reads getSiteSettings() directly and was never
    // explicitly revalidated on a settings save.
    expect(calledPaths).toContain('/checkout')

    // Same gap on the other cached routes that read getSiteSettings()
    // directly: /products/[slug] (revalidate=3600), /our-stories (revalidate=3600),
    // /blog (revalidate=3600).
    expect(calledPaths).toContain('/products/[slug]')
    expect(calledPaths).toContain('/our-stories')
    expect(calledPaths).toContain('/blog')

    expect(json.success).toBe(true)
    expect(json.revalidated).toContain('/checkout')
    expect(json.revalidated).toContain('/our-stories')
    expect(json.revalidated).toContain('/blog')
  })

  it('rejects a request with the wrong secret without touching any cache', async () => {
    const { POST } = await import('@/app/api/v1/revalidate/route')

    const req = new Request('https://pahadiroots.com/api/v1/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-secret' },
      body: JSON.stringify({ settings: true }),
    }) as unknown as import('next/server').NextRequest

    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(clearSiteSettingsCacheMock).not.toHaveBeenCalled()
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})
