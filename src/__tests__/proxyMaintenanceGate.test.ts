/**
 * proxyMaintenanceGate.test.ts
 *
 * Covers MAINTENANCE_EXEMPT_PATTERN — the allow-list that decides which
 * paths bypass the store-closed → /maintenance redirect in src/proxy.ts.
 *
 * This regex is the single point of failure for three different outages if
 * it's wrong in either direction:
 *   - Too narrow (misses /api or /auth): closing the store would break the
 *     Razorpay webhook, health checks, and the OAuth callback for anyone
 *     mid-login.
 *   - Too broad (matches real storefront paths like /products or /about):
 *     "Close Store" in the admin panel would silently do nothing for those
 *     pages.
 *   - Missing /maintenance itself: infinite redirect loop the moment the
 *     store is closed.
 */

import { describe, it, expect } from 'vitest'
import { MAINTENANCE_EXEMPT_PATTERN } from '@/proxy'

describe('MAINTENANCE_EXEMPT_PATTERN', () => {
  it('exempts API routes (webhooks, health checks, cron must keep working)', () => {
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/api/v1/webhook/razorpay')).toBe(true)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/api/health')).toBe(true)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/api/v1/cron/retry-failed-emails')).toBe(true)
  })

  it('exempts /auth routes (OAuth callback must not be locked out mid-login)', () => {
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/auth/google-callback')).toBe(true)
  })

  it('exempts /maintenance itself (no redirect loop)', () => {
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/maintenance')).toBe(true)
  })

  it('exempts Next internals and well-known static files', () => {
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/_next/static/chunk.js')).toBe(true)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/favicon.ico')).toBe(true)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/robots.txt')).toBe(true)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/sitemap.xml')).toBe(true)
  })

  it('does NOT exempt real storefront pages — these must be gated', () => {
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/')).toBe(false)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/products')).toBe(false)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/products/himalayan-honey')).toBe(false)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/checkout')).toBe(false)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/cart')).toBe(false)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/new-arrivals')).toBe(false)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/account')).toBe(false)
  })

  it('does not accidentally match paths that merely contain an exempt word', () => {
    // e.g. a hypothetical /products/api-guide page shouldn't be treated as
    // exempt just because "api" appears in it — the pattern is anchored.
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/products/api-guide')).toBe(false)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/collections/authentic-honey')).toBe(false)
  })
  // Issue C1 (Oct 2026 audit)
  it('exempts static files served from /public (never gated, never redirected)', () => {
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/logo.png')).toBe(true)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/images/hero/banner.WEBP')).toBe(true)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/js/ai-assistant.js')).toBe(true)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/footer-himalaya.jpg')).toBe(true)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/manifest.webmanifest')).toBe(true)
  })

  it('exempt words need a path boundary — look-alike top-level pages stay gated', () => {
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/authentic-honey')).toBe(false)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/api-docs')).toBe(false)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/maintenance-tips')).toBe(false)
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/robots.txt.html')).toBe(false)
  })

  it('exempts the bare /api, /auth, /maintenance and /_next roots too', () => {
    for (const p of ['/api', '/auth', '/maintenance', '/_next']) {
      expect(MAINTENANCE_EXEMPT_PATTERN.test(p)).toBe(true)
    }
  })

  it('does not treat a dotted product slug as a static file', () => {
    expect(MAINTENANCE_EXEMPT_PATTERN.test('/products/honey-1.5kg')).toBe(false)
  })
})
