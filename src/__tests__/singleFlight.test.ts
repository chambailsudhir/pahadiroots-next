/**
 * singleFlight.test.ts
 *
 * Covers the CRITICAL fix for the production timeout-storm incident: Vercel
 * logs showed dozens of concurrent "getSiteSettings timed out" / 500 errors
 * across /regions/* and cart-settings/coupon-hints/cart-upsells firing
 * within the same few seconds. Root cause: getSiteSettings()'s own
 * documented "BUG 27" stampede race, and the equivalent gap in
 * getStoreData() — unstable_cache doesn't prevent concurrent callers from
 * all missing a cold cache at once and each firing an independent,
 * fully-redundant fetch.
 *
 * These tests prove the fix actually coalesces concurrent calls into ONE
 * underlying Supabase request, not just that the code compiles.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.resetModules() // fresh module-level _cache/_inFlight state per test
  vi.clearAllMocks()
})

describe('getSiteSettings — single-flight de-duplication', () => {
  it('fires exactly ONE Supabase query when 20 concurrent callers all hit a cold cache at once', async () => {
    let queryCount = 0
    const client = {
      from: () => ({
        select: () => new Promise(resolve => {
          queryCount++
          // Simulate real network latency — if calls weren't coalesced,
          // all 20 would be in flight simultaneously during this window.
          setTimeout(() => resolve({ data: [{ key: 'cod_enabled', value: 'true' }], error: null }), 20)
        }),
      }),
    }
    vi.doMock('@/lib/supabase', () => ({
      supabase: client,
      getServiceClient: () => client,
    }))

    const { getSiteSettings } = await import('@/lib/getSiteSettings')

    const results = await Promise.all(Array.from({ length: 20 }, () => getSiteSettings()))

    expect(queryCount).toBe(1)
    expect(results.every(r => r.cod_enabled === 'true')).toBe(true)
  })

  it('a fresh burst AFTER the first fetch completes reuses the warm cache — still zero extra queries', async () => {
    let queryCount = 0
    const client = {
      from: () => ({
        select: () => { queryCount++; return Promise.resolve({ data: [], error: null }) },
      }),
    }
    vi.doMock('@/lib/supabase', () => ({ supabase: client, getServiceClient: () => client }))

    const { getSiteSettings } = await import('@/lib/getSiteSettings')
    await getSiteSettings()                 // populates cache
    await Promise.all([getSiteSettings(), getSiteSettings(), getSiteSettings()]) // cache hits

    expect(queryCount).toBe(1)
  })

  it('recovers on the NEXT call after a failed fetch (in-flight slot is released, not stuck)', async () => {
    let attempt = 0
    const client = {
      from: () => ({
        select: () => {
          attempt++
          return attempt === 1
            ? Promise.reject(new Error('network blip'))
            : Promise.resolve({ data: [{ key: 'cod_enabled', value: 'true' }], error: null })
        },
      }),
    }
    vi.doMock('@/lib/supabase', () => ({ supabase: client, getServiceClient: () => client }))

    const { getSiteSettings } = await import('@/lib/getSiteSettings')
    const first = await getSiteSettings()  // fails → falls back to DEFAULTS, cache NOT populated
    expect(first.cod_enabled).not.toBe('true') // default is 'false'

    const second = await getSiteSettings() // must retry, not hang forever on a stuck in-flight promise
    expect(second.cod_enabled).toBe('true')
    expect(attempt).toBe(2)
  })
})

describe('getStoreData — single-flight de-duplication', () => {
  it('fires exactly one products query when many concurrent callers (simulating parallel page builds) hit a cold cache at once', async () => {
    let productsCallCount = 0
    const client = {
      from: (table: string) => {
        if (table === 'products') {
          const chain: any = {
            select: () => chain,
            eq:     () => chain,
            order:  () => chain,
            range:  () => new Promise(resolve => {
              productsCallCount++
              setTimeout(() => resolve({ data: [], error: null }), 15)
            }),
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
    vi.doMock('next/cache', () => ({
      unstable_cache: (fn: (...a: unknown[]) => unknown) => fn, // bypass Next's cache layer in tests
      revalidateTag:  vi.fn(),
    }))
    vi.doMock('@/lib/supabase', () => ({ supabase: client, getServiceClient: () => client }))

    const { getStoreData } = await import('@/lib/storeData')

    await Promise.all(Array.from({ length: 15 }, () => getStoreData(true)))

    expect(productsCallCount).toBe(1)
  })
})
