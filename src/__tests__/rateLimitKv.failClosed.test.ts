/**
 * rateLimitKv.failClosed.test.ts — AUDIT S1-016(a) (track R2b)
 *
 * checkRateLimitKv() failed OPEN when both Upstash and the Postgres fallback errored, so a KV +
 * DB hiccup turned order/payment creation into an uncapped endpoint. checkRateLimitKvStrict()
 * reports the real outcome ('allowed' | 'blocked' | 'unavailable'); mutation routes answer 503 +
 * Retry-After on 'unavailable' (see paymentsRoute.guestAbuse.test.ts). The legacy boolean API keeps
 * its last-resort fail-open for read-mostly routes but now pages ops when it does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), captureError: vi.fn(), warn: vi.fn(), metric: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: {}, getServiceClient: vi.fn(() => ({ rpc: mocks.rpc })) }))
vi.mock('@/lib/logger', () => ({ captureError: mocks.captureError, logger: { warn: mocks.warn, metric: mocks.metric, error: vi.fn() } }))

import { checkRateLimitKv, checkRateLimitKvStrict, RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SEC } from '@/lib/api/rateLimitKv'

const originalEnv = { ...process.env }
const originalFetch = global.fetch
beforeEach(() => { vi.clearAllMocks(); process.env = { ...originalEnv } })
afterEach(() => { global.fetch = originalFetch; process.env = { ...originalEnv } })

describe('checkRateLimitKvStrict — KV unconfigured, DB fallback decides', () => {
  beforeEach(() => { delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN })

  it("returns 'unavailable' (NOT allowed) when the DB fallback errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } })
    expect(await checkRateLimitKvStrict('mw:rl:payments_ip:1.2.3.4', 10, 60)).toBe('unavailable')
    expect(mocks.captureError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ action: 'rateLimitKv.unavailable_fail_closed', alert: true }))
  })

  it("returns 'unavailable' when the DB client throws", async () => {
    mocks.rpc.mockRejectedValue(new Error('client init failed'))
    expect(await checkRateLimitKvStrict('mw:rl:orders_ip:1.2.3.4', 10, 60)).toBe('unavailable')
  })

  it("returns 'unavailable' on an unexpected (non-boolean) fallback result instead of guessing", async () => {
    mocks.rpc.mockResolvedValue({ data: 'yes', error: null })
    expect(await checkRateLimitKvStrict('mw:rl:orders_ip:1.2.3.4', 10, 60)).toBe('unavailable')
  })

  it("maps the fallback's verdict to 'allowed' / 'blocked'", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null })
    expect(await checkRateLimitKvStrict('mw:rl:payments_phone10m:9876543210', 6, 600)).toBe('allowed')
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null })
    expect(await checkRateLimitKvStrict('mw:rl:payments_phone10m:9876543210', 6, 600)).toBe('blocked')
    expect(mocks.rpc).toHaveBeenLastCalledWith('rate_limit_check', { p_key: 'mw:rl:payments_phone10m:9876543210', p_limit: 6, p_window_sec: 600 })
  })
})

describe('checkRateLimitKvStrict — KV configured', () => {
  beforeEach(() => { process.env.UPSTASH_REDIS_REST_URL = 'https://fake-kv.upstash.io'; process.env.UPSTASH_REDIS_REST_TOKEN = 't' })

  it("healthy KV: 'allowed' within the limit, 'blocked' above it, DB never consulted", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => [{ result: 6 }, { result: 'OK' }] })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ result: 7 }, { result: 'OK' }] }) as unknown as typeof fetch
    expect(await checkRateLimitKvStrict('mw:rl:payments_phone10m:9', 6, 600)).toBe('allowed')
    expect(await checkRateLimitKvStrict('mw:rl:payments_phone10m:9', 6, 600)).toBe('blocked')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("KV down AND DB fallback down → 'unavailable'", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    expect(await checkRateLimitKvStrict('mw:rl:payments_ip:1.2.3.4', 10, 60)).toBe('unavailable')
  })

  it('exports a positive Retry-After for routes to send on 503', () => {
    expect(RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SEC).toBeGreaterThan(0)
  })
})

describe('checkRateLimitKv (legacy boolean) — unchanged contract for read-mostly routes, but now observable', () => {
  beforeEach(() => { delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN })

  it('still allows as a last resort when the fallback errors, and pages ops about it', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } })
    expect(await checkRateLimitKv('mw:rl:coupon:1.2.3.4', 5, 60)).toBe(true)
    expect(mocks.captureError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ action: 'rateLimitKv.unavailable_fail_open', alert: true }))
  })

  it('blocks when the fallback says so (no change)', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    expect(await checkRateLimitKv('mw:rl:coupon:1.2.3.4', 5, 60)).toBe(false)
  })
})
