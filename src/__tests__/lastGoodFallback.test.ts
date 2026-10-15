/**
 * lastGoodFallback.test.ts — when Supabase stalls, the cart read-endpoints
 * serve the last good value instead of an error (Oct 2026: free-tier DB
 * stalls of 5–12 s were turning cart-settings / coupon-hints / cart-upsells
 * into 4 s timeouts → HTTP 500).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { rememberGood, recallGood, _clearLastGood } from '@/lib/api/lastGood'
import { logger } from '@/lib/logger'

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
  _clearLastGood()
  vi.clearAllMocks()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })

const ok   = (body: unknown) => ({ ok: true,  status: 200, json: async () => body })
const down = () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))

describe('lastGood store', () => {
  it('returns a remembered value with its age', () => {
    rememberGood('k', { a: 1 })
    const r = recallGood<{ a: number }>('k', 1000)
    expect(r?.value).toEqual({ a: 1 })
    expect(r!.ageMs).toBeGreaterThanOrEqual(0)
  })
  it('forgets values older than maxAge', () => {
    vi.useFakeTimers()
    rememberGood('k', 1)
    vi.advanceTimersByTime(5000)
    expect(recallGood('k', 1000)).toBeNull()
  })
  it('is bounded (oldest evicted)', () => {
    for (let i = 0; i < 80; i++) rememberGood(`k${i}`, i)
    expect(recallGood('k0', 1e9)).toBeNull()
    expect(recallGood('k79', 1e9)?.value).toBe(79)
  })
})

describe('GET /api/v1/cart-settings', () => {
  it('serves the last good settings (200, flagged stale, warned) when the DB then times out', async () => {
    const { GET } = await import('@/app/api/v1/cart-settings/route')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok([{ key: 'cod_fee', value: '49' }])))
    const first = await GET()
    expect(first.status).toBe(200)

    vi.stubGlobal('fetch', vi.fn().mockImplementation(down))
    const second = await GET()
    expect(second.status).toBe(200)
    expect(second.headers.get('X-Data-Stale')).toBe('1')
    expect(second.headers.get('Cache-Control')).toBe('no-store')
    expect(await second.json()).toEqual({ settings: { cod_fee: '49' } })
    expect(logger.warn).toHaveBeenCalledWith('cart_settings_served_stale', expect.anything())
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('still returns 500 + empty settings when nothing was ever read (cold instance)', async () => {
    const { GET } = await import('@/app/api/v1/cart-settings/route')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(down))
    const res = await GET()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ settings: {} })
  })

  it('never serves settings older than 15 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { GET } = await import('@/app/api/v1/cart-settings/route')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok([{ key: 'cod_fee', value: '49' }])))
    await GET()
    vi.setSystemTime(Date.now() + 16 * 60_000)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(down))
    expect((await GET()).status).toBe(500)
  })

  it('uses the short timeout only when a last-good copy exists', async () => {
    const { GET } = await import('@/app/api/v1/cart-settings/route')
    const spy = vi.spyOn(AbortSignal, 'timeout')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok([])))
    await GET()                       // cold → 4 s
    await GET()                       // warm → 2 s
    expect(spy.mock.calls.map(c => c[0])).toEqual([4000, 2000])
  })
})

describe('GET /api/v1/coupon-hints', () => {
  it('serves last good hints when the DB then fails', async () => {
    const { GET } = await import('@/app/api/v1/coupon-hints/route')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok([
      { code: 'WELCOME10', type: 'percent', value: 10, min_order: null, expires_at: null },
    ])))
    expect((await GET()).status).toBe(200)

    vi.stubGlobal('fetch', vi.fn().mockImplementation(down))
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Data-Stale')).toBe('1')
    expect((await res.json()).hints).toEqual([{ code: 'WELCOME10', label: '10% off' }])
  })

  it('returns 500 on a cold instance (monitors still see real outages)', async () => {
    const { GET } = await import('@/app/api/v1/coupon-hints/route')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(down))
    expect((await GET()).status).toBe(500)
  })
})

describe('GET /api/v1/cart-upsells', () => {
  const req = (qs = '') => ({ nextUrl: new URL(`https://x.test/api/v1/cart-upsells${qs}`) }) as never

  it('serves the last good upsells for the same cart contents when the DB fails', async () => {
    const { GET } = await import('@/app/api/v1/cart-upsells/route')
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(ok([{ id: 'v1', product_id: 'p1', is_active: true, available_stock: 5, price: 100, original_price: 120, variant_value: '500g' }]))
      .mockResolvedValueOnce(ok([{ id: 'p1', name: 'Honey', slug: 'honey', emoji: null, gst_rate: 5, state_id: null, badges: [] }]))
      .mockResolvedValueOnce(ok([])))
    const first = await (await GET(req('?variantIds=aaa'))).json()
    expect(first.upsells).toHaveLength(1)

    vi.stubGlobal('fetch', vi.fn().mockImplementation(down))
    const res = await GET(req('?variantIds=aaa'))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Data-Stale')).toBe('1')
    expect((await res.json()).upsells).toHaveLength(1)

    // different cart contents → different key → no cross-contamination
    expect((await GET(req('?variantIds=bbb'))).status).toBe(500)
  })
})
