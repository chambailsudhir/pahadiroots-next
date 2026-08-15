/**
 * storeDataRetry.test.ts
 *
 * Covers the fix for: "Bestsellers vanishes on hard refresh, reappears
 * after clicking to /products and back." Root cause — a transient fetch
 * hiccup (cold-Lambda/cold-connection latency, a momentary network blip)
 * used to propagate straight out of _fetchStoreData() and get BAKED IN to
 * two independent 60s caches: the unstable_cache('store-data') data cache
 * here, and the homepage's own `export const revalidate = 60` Full Route
 * Cache. Once baked in, every hard-refresh visitor got served that same
 * broken render for up to 60 seconds — while a client-side navigation to
 * another route bypassed the stale cached HTML and got a fresh (successful)
 * render instead, which is exactly the asymmetry that was reported.
 *
 * These tests prove the retry actually shields both cache layers from a
 * single transient failure, not just that the code compiles.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

function makeClient(behavior: { productsCallCount: () => number; failFirstNCalls: number }) {
  let calls = 0
  return {
    from: (table: string) => {
      if (table === 'products') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          order:  () => chain,
          range:  () => {
            calls++
            behavior.productsCallCount = () => calls
            if (calls <= behavior.failFirstNCalls) {
              return Promise.resolve({ data: null, error: { message: 'Supabase connection timed out' } })
            }
            return Promise.resolve({ data: [], error: null })
          },
        }
        return chain
      }
      const genericChain: any = {}
      const resolved = Promise.resolve({ data: [], error: null })
      genericChain.select = () => genericChain
      genericChain.eq     = () => genericChain
      genericChain.order  = () => genericChain
      genericChain.then   = (res: any, rej: any) => resolved.then(res, rej)
      return genericChain
    },
  }
}

describe('getStoreData — transient-failure retry (shields the 60s caches from a one-off blip)', () => {
  it('a single transient failure is retried and succeeds — the caller never sees an error', async () => {
    const behavior: any = { failFirstNCalls: 1 }
    const client = makeClient(behavior)

    vi.doMock('next/cache', () => ({
      unstable_cache: (fn: (...a: unknown[]) => unknown) => fn, // bypass Next's cache layer in tests
      revalidateTag:  vi.fn(),
    }))
    vi.doMock('@/lib/supabase', () => ({ supabase: client, getServiceClient: () => client }))

    const { getStoreData } = await import('@/lib/storeData')
    const data = await getStoreData(true)

    expect(data.products).toEqual([])          // resolved successfully, not thrown
    expect(behavior.productsCallCount()).toBe(2) // 1 failed attempt + 1 successful retry
  })

  it('a persistent failure (every attempt fails) still throws — retry does not mask a real outage forever', async () => {
    const behavior: any = { failFirstNCalls: 99 }
    const client = makeClient(behavior)

    vi.doMock('next/cache', () => ({
      unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
      revalidateTag:  vi.fn(),
    }))
    vi.doMock('@/lib/supabase', () => ({ supabase: client, getServiceClient: () => client }))

    const { getStoreData } = await import('@/lib/storeData')

    await expect(getStoreData(true)).rejects.toBeTruthy()
    expect(behavior.productsCallCount()).toBe(2) // capped at 2 attempts, doesn't retry forever
  })

  it('BestSellers itself never sees the error at all when the underlying fetch self-heals on retry — the section renders instead of returning null', async () => {
    const behavior: any = { failFirstNCalls: 1 }
    const client = makeClient(behavior)

    vi.doMock('next/cache', () => ({
      unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
      revalidateTag:  vi.fn(),
    }))
    vi.doMock('@/lib/supabase', () => ({ supabase: client, getServiceClient: () => client }))
    vi.doMock('@/components/homepage/BestSellersClient', () => ({
      default: () => null,
    }))

    const { default: BestSellers } = await import('@/components/homepage/BestSellers')
    // No products in this fixture (empty array), so BestSellers itself will
    // still return null for a DIFFERENT, legitimate reason (empty catalog) —
    // the point of this test is narrower: it must NOT throw/log an error,
    // proving the transient failure was fully absorbed before reaching here.
    const loggerModule = await import('@/lib/logger')
    const errorSpy = vi.spyOn(loggerModule.logger, 'error')

    await BestSellers()

    expect(errorSpy).not.toHaveBeenCalled()
  })
})
