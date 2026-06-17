/**
 * cartSettingsRoute.test.ts
 *
 * Direct route-level tests for GET /api/v1/cart-settings.
 *
 * AUDIT GAP: this route had only INDIRECT coverage via useCartPage.handlers
 * .test.ts (which mocks fetch on the *consumer* side). The route handler
 * itself — the key->value transformation, the Cache-Control header fix, and
 * the graceful empty-settings fallback on fetch failure — had ZERO direct
 * test coverage.
 *
 * Covered here:
 *   1. Happy path — Supabase rows are correctly transformed into a flat
 *      { key: value } object.
 *   2. [BUG FIX] Cache-Control header includes BOTH the browser directive
 *      (max-age=60) and the CDN directive (s-maxage=60) — the documented fix
 *      was that s-maxage alone has no effect on the browser, causing a fresh
 *      request on every page mount.
 *   3. On a non-ok Supabase response, the route returns { settings: {} } with
 *      a 500 status — never throws an unhandled error, and never returns a
 *      half-populated settings object.
 *   4. On a network-level fetch rejection (not just a non-ok response), the
 *      same graceful fallback applies.
 *   5. Rows with unexpected/extra keys are passed through as-is (the route
 *      does not currently filter the response to CART_SETTING_KEYS — this
 *      test documents that behaviour so a future change is intentional, not
 *      accidental).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
  vi.resetModules() // module-level _CART_SETTINGS_URL is built from env at import time
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

function mockFetchOnce(ok: boolean, body: unknown, status = ok ? 200 : 500) {
  global.fetch = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof globalThis.fetch
}

describe('GET /api/v1/cart-settings — happy path', () => {
  it('transforms Supabase key/value rows into a flat settings object', async () => {
    mockFetchOnce(true, [
      { key: 'free_shipping_min', value: '799' },
      { key: 'cod_enabled',       value: 'true' },
    ])

    const { GET } = await import('@/app/api/v1/cart-settings/route')
    const res  = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.settings).toEqual({
      free_shipping_min: '799',
      cod_enabled:        'true',
    })
  })

  it('returns an empty settings object when Supabase returns zero rows', async () => {
    mockFetchOnce(true, [])

    const { GET } = await import('@/app/api/v1/cart-settings/route')
    const res  = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.settings).toEqual({})
  })

  // BUG FIX regression: s-maxage alone is a CDN-only directive with no effect
  // on the browser. The fix added `public, max-age=60` so the browser also
  // caches the response, eliminating a redundant fetch on every page mount.
  it('sets BOTH max-age (browser) and s-maxage (CDN) in Cache-Control', async () => {
    mockFetchOnce(true, [{ key: 'free_shipping_min', value: '799' }])

    const { GET } = await import('@/app/api/v1/cart-settings/route')
    const res = await GET()
    const cacheControl = res.headers.get('Cache-Control') ?? ''

    expect(cacheControl).toContain('public')
    expect(cacheControl).toContain('max-age=60')
    expect(cacheControl).toContain('s-maxage=60')
  })

  it('passes through unexpected/extra keys from the DB without filtering', async () => {
    mockFetchOnce(true, [
      { key: 'free_shipping_min', value: '799' },
      { key: 'some_future_admin_key', value: 'unfiltered' },
    ])

    const { GET } = await import('@/app/api/v1/cart-settings/route')
    const res  = await GET()
    const json = await res.json()

    expect(json.settings.some_future_admin_key).toBe('unfiltered')
  })
})

describe('GET /api/v1/cart-settings — failure handling', () => {
  it('returns { settings: {} } with status 500 when Supabase responds non-ok', async () => {
    mockFetchOnce(false, { message: 'relation does not exist' }, 503)

    const { GET } = await import('@/app/api/v1/cart-settings/route')
    const res  = await GET()
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.settings).toEqual({})
  })

  it('returns { settings: {} } with status 500 when fetch rejects (network error)', async () => {
    global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof globalThis.fetch

    const { GET } = await import('@/app/api/v1/cart-settings/route')
    const res  = await GET()
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.settings).toEqual({})
  })

  it('returns { settings: {} } with status 500 when the response times out (AbortError)', async () => {
    global.fetch = vi.fn(async () => {
      throw new DOMException('The operation was aborted', 'AbortError')
    }) as unknown as typeof globalThis.fetch

    const { GET } = await import('@/app/api/v1/cart-settings/route')
    const res  = await GET()
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.settings).toEqual({})
  })

  it('does not throw or crash the process on malformed JSON from Supabase', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token') },
    })) as unknown as typeof globalThis.fetch

    const { GET } = await import('@/app/api/v1/cart-settings/route')
    await expect(GET()).resolves.toBeTruthy()
  })
})

describe('GET /api/v1/cart-settings — request shape', () => {
  it('sends the Supabase anon key (not the service key) in request headers', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true, status: 200, json: async () => [],
    }))
    global.fetch = fetchMock as unknown as typeof globalThis.fetch

    const { GET } = await import('@/app/api/v1/cart-settings/route')
    await GET()

    const [, init] = fetchMock.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.apikey).toBe('test-anon-key')
    expect(headers.Authorization).toBe('Bearer test-anon-key')
  })

  it('requests the site_settings table with a key/value select', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true, status: 200, json: async () => [],
    }))
    global.fetch = fetchMock as unknown as typeof globalThis.fetch

    const { GET } = await import('@/app/api/v1/cart-settings/route')
    await GET()

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/rest/v1/site_settings')
    expect(url).toContain('select=key,value')
  })
})
