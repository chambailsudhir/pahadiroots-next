/**
 * proxyMatcher.test.ts
 *
 * Guards the `config.matcher` of src/proxy.ts. The matcher decides which
 * requests INVOKE the proxy at all — and every invocation is billed as Fluid
 * Active CPU. (Oct 2026: the old catch-all matcher made middleware ~42% of the
 * project's CPU on a low-traffic store, because every /public asset, prefetch
 * and read-only API call spun it up.)
 *
 * Two failure modes this protects against:
 *   - Too broad  → CPU burn returns (assets / GET APIs invoke the proxy again).
 *   - Too narrow → the maintenance gate or the global rate limit silently stops
 *                  running for a route it must cover.
 */

import { describe, it, expect } from 'vitest'
import { config } from '@/proxy'

type MatcherObj = { source: string; missing?: { type: string; key: string; value?: string }[] }
const [pageEntry, apiEntry] = config.matcher as [MatcherObj, string]

// Next compiles `source` with path-to-regexp; for these pure-regex sources a
// whole-path anchored RegExp is an equivalent check.
const pageRe = new RegExp(`^${pageEntry.source}$`)
const apiRe  = new RegExp(`^${apiEntry}$`)

describe('proxy matcher — page entry (maintenance gate)', () => {
  it.each([
    '/', '/products', '/products/wild-honey', '/collections/honey', '/regions/kangra',
    '/cart', '/checkout', '/blog/some-post', '/authentic-honey', '/maintenance-tips',
    '/products/honey-1.5kg', // dot in a slug is NOT a static-file extension
  ])('invokes the proxy for page route %s', (path) => {
    expect(pageRe.test(path)).toBe(true)
  })

  it.each([
    '/logo.png', '/enjoy/hero.jpg', '/js/ai-assistant.js', '/favicon.ico', '/robots.txt',
    '/sitemap.xml', '/manifest.webmanifest', '/fonts/a.woff2', '/footer-himalaya.jpg',
    '/_next/static/chunks/a.js', '/_next/image', '/api/health', '/api/v1/store-data',
    '/auth/google-callback', '/maintenance', '/maintenance/foo',
  ])('does NOT invoke the proxy for %s', (path) => {
    expect(pageRe.test(path)).toBe(false)
  })

  it('skips router prefetch requests', () => {
    const keys = (pageEntry.missing ?? []).map(m => `${m.key}${m.value ? '=' + m.value : ''}`)
    expect(keys).toContain('next-router-prefetch')
    expect(keys).toContain('purpose=prefetch')
  })
})

describe('proxy matcher — API entry (global rate limit)', () => {
  it.each([
    '/api/v1/orders', '/api/v1/payments', '/api/v1/coupons', '/api/v1/actions',
    '/api/v1/loyalty', '/api/v1/cart/validate', '/api/v1/webhook/razorpay',
    '/api/v1/revalidate', '/api/v1/some-future-route', // new routes are covered by default
  ])('still rate-limits %s', (path) => {
    expect(apiRe.test(path)).toBe(true)
  })

  it.each([
    '/api/v1/analytics/track', '/api/v1/cart-settings', '/api/v1/cart-upsells',
    '/api/v1/coupon-hints', '/api/v1/search-catalog', '/api/v1/store-data',
    '/api/v1/cron/expire-pending-orders', '/api/v1/orders/lookup', '/api/v1/orders/track',
    '/api/v1/loyalty/history',
  ])('does NOT invoke the proxy for GET-only / self-limited %s', (path) => {
    expect(apiRe.test(path)).toBe(false)
  })
})
