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

// /products is now a strict-CSP route (one extra bootstrap-settings fetch); use an ISR page for the store-open cache test.
function pageReq(path = '/products/sea-buckthorn') {
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
    await proxy(pageReq('/products/sea-buckthorn'))
    await proxy(pageReq('/cart'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(31_000)
    await proxy(pageReq('/'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // Nov 2026 verification: the gate used to 307 every page to /maintenance (a robots-disallowed URL). It now answers a 503
  // with Retry-After IN PLACE so crawlers keep the URL indexed and simply retry later.
  it('answers pages with an in-place 503 (Retry-After, no-store, no redirect) when store_open is false, but never static files', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      String(url).includes('store_open')
        ? storeOpenResponse('false')
        : new Response(JSON.stringify([{ key: 'maintenance_message', value: 'Back <b>Monday</b>' }, { key: 'whatsapp_number', value: '919000000000' }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { proxy } = await loadProxy()

    const page = await proxy(pageReq('/products/sea-buckthorn'))
    expect(page.status).toBe(503)
    expect(page.headers.get('location')).toBeNull()
    expect(page.headers.get('x-middleware-rewrite')).toBeNull()
    expect(page.headers.get('retry-after')).toBe('3600')
    expect(page.headers.get('cache-control')).toBe('no-store')
    const html = await page.text()
    expect(html).toContain('Back &lt;b&gt;Monday&lt;/b&gt;')   // admin copy, escaped
    expect(html).toContain('+919000000000')
    expect(html).toContain('noindex')

    const asset = await proxy(pageReq('/logo.png'))
    expect(asset.status).not.toBe(503)
    // The asset request must not even have asked Supabase (one store_open read, for the page).
    expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('store_open'))).toHaveLength(1)
  })

  // VERIFY ROUND (L-9): the gate used to check `req.method === 'GET'` only, so a HEAD of a page while the store was
  // closed answered 200 — a link checker / uptime probe saw an open store. HEAD is the same navigation.
  it('also answers 503 to a HEAD request for a page while the store is closed', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => storeOpenResponse('false'))
    vi.stubGlobal('fetch', fetchMock)
    const { proxy } = await loadProxy()
    const head = await proxy(new NextRequest('https://pahadiroots.com/products/sea-buckthorn', { method: 'HEAD' }))
    expect(head.status).toBe(503)
    expect(head.headers.get('location')).toBeNull()
  })

  it('fails open on a network error and retries after the short failure TTL', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementation(async () => storeOpenResponse('false'))
    vi.stubGlobal('fetch', fetchMock)
    const { proxy } = await loadProxy()

    const first = await proxy(pageReq('/products/sea-buckthorn'))
    expect(first.status).not.toBe(503) // fail-open: site stays up

    // Within 5 s the failure is remembered — no hammering Supabase.
    vi.advanceTimersByTime(2_000)
    await proxy(pageReq('/products/sea-buckthorn'))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // After the failure TTL it asks again and now sees the closed flag.
    vi.advanceTimersByTime(4_000)
    const later = await proxy(pageReq('/products/sea-buckthorn'))
    expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('store_open'))).toHaveLength(2)
    expect(later.status).toBe(503)
  })
})
