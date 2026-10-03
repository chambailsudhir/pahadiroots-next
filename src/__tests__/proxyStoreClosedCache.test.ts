/**
 * proxyStoreClosedCache.test.ts — Issue C1 (Oct 2026 audit)
 *
 * The maintenance gate used to await a Supabase REST call on every page
 * request. proxy.ts now remembers the store_open answer in module memory
 * (30 s after a success, 5 s after a failure) and stays fail-open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

async function loadProxy() {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  return import('@/proxy')
}

function pageReq(path = '/products') {
  return new NextRequest(`https://pahadiroots.com${path}`, { method: 'GET' })
}

function storeOpenResponse(value: string) {
  return new Response(JSON.stringify([{ value }]), { status: 200 })
}

describe('proxy store-closed cache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-03T10:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('reads store_open once and reuses it for 30 s', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => storeOpenResponse('true'))
    vi.stubGlobal('fetch', fetchMock)
    const { proxy } = await loadProxy()

    await proxy(pageReq('/'))
    await proxy(pageReq('/products'))
    await proxy(pageReq('/cart'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(31_000)
    await proxy(pageReq('/'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('redirects pages to /maintenance when store_open is false, but never static files', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => storeOpenResponse('false'))
    vi.stubGlobal('fetch', fetchMock)
    const { proxy } = await loadProxy()

    const page = await proxy(pageReq('/products'))
    expect(page.status).toBeGreaterThanOrEqual(300)
    expect(page.status).toBeLessThan(400)
    expect(page.headers.get('location')).toContain('/maintenance')

    const asset = await proxy(pageReq('/logo.png'))
    expect(asset.headers.get('location')).toBeNull()
    // The asset request must not even have asked Supabase (one call, for the page).
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails open on a network error and retries after the short failure TTL', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementation(async () => storeOpenResponse('false'))
    vi.stubGlobal('fetch', fetchMock)
    const { proxy } = await loadProxy()

    const first = await proxy(pageReq('/products'))
    expect(first.headers.get('location')).toBeNull() // fail-open: site stays up

    // Within 5 s the failure is remembered — no hammering Supabase.
    vi.advanceTimersByTime(2_000)
    await proxy(pageReq('/products'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // After the failure TTL it asks again and now sees the closed flag.
    vi.advanceTimersByTime(4_000)
    const later = await proxy(pageReq('/products'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(later.headers.get('location')).toContain('/maintenance')
  })
})
