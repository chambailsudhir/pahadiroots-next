/**
 * rateLimitKv.test.ts
 *
 * checkRateLimitKv() previously failed OPEN (allowed every request) whenever
 * Upstash KV was unconfigured or unhealthy — which is the confirmed live
 * production state right now (UPSTASH_REDIS_REST_URL/TOKEN show as configured
 * in Vercel's dashboard, but a documented Vercel "Sensitive" env var runtime
 * bug means the value doesn't reliably reach the function). This suite covers
 * the new Postgres-backed fallback (checkRateLimitDb, via the rate_limit_check
 * RPC) added so orders/coupons/payments retain real rate-limit protection
 * instead of depending entirely on Upstash or on Vercel's dashboard behaving.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock supabase + logger BEFORE importing the module under test ──────────
// vi.hoisted is required here (not plain top-level consts) because vi.mock
// factories are hoisted above imports — a plain const would be a TDZ
// ReferenceError at the point the hoisted factory runs.
const mocks = vi.hoisted(() => ({
  rpc:            vi.fn(),
  captureError:   vi.fn(),
  loggerWarn:     vi.fn(),
  loggerMetric:   vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase:         { from: vi.fn() },
  getServiceClient: vi.fn(() => ({ rpc: mocks.rpc })),
}))

vi.mock('@/lib/logger', () => ({
  captureError: mocks.captureError,
  logger: { warn: mocks.loggerWarn, metric: mocks.loggerMetric, error: vi.fn() },
}))

import { checkRateLimitKv } from '@/lib/api/rateLimitKv'

const originalEnv = { ...process.env }
const originalFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...originalEnv }
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = { ...originalEnv }
})

describe('checkRateLimitKv — Upstash configured and healthy', () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL   = 'https://fake-kv.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
  })

  it('allows the request when the KV count is within limit', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      // BUG FIX: real Upstash pipeline responses are objects — {result: N} —
      // not [name, value] tuples. This mock previously matched the same
      // wrong shape the buggy code assumed, which is exactly why this test
      // suite didn't catch the "always blocks" bug that live testing found.
      json: async () => [{ result: 1 }, { result: 'OK' }],
    }) as unknown as typeof fetch

    const allowed = await checkRateLimitKv('mw:rl:orders_ip:1.2.3.4', 10, 60)
    expect(allowed).toBe(true)
    expect(mocks.rpc).not.toHaveBeenCalled() // healthy KV path never touches the DB fallback
  })

  it('blocks the request when the KV count exceeds limit', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ result: 11 }, { result: 'OK' }],
    }) as unknown as typeof fetch

    const allowed = await checkRateLimitKv('mw:rl:orders_ip:1.2.3.4', 10, 60)
    expect(allowed).toBe(false)
  })

  it('falls back to the DB check when KV responds with a non-OK status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch
    mocks.rpc.mockResolvedValue({ data: true, error: null })

    const allowed = await checkRateLimitKv('mw:rl:coupon:1.2.3.4', 5, 60)
    expect(allowed).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('rate_limit_check', {
      p_key: 'mw:rl:coupon:1.2.3.4', p_limit: 5, p_window_sec: 60,
    })
    expect(mocks.loggerMetric).toHaveBeenCalledWith('kv.error', 1, 'count', expect.objectContaining({ status: 500 }))
  })

  it('falls back to the DB check when the KV request throws (network/timeout)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed')) as unknown as typeof fetch
    mocks.rpc.mockResolvedValue({ data: false, error: null })

    const allowed = await checkRateLimitKv('mw:rl:payments_ip:1.2.3.4', 10, 60)
    expect(allowed).toBe(false) // DB fallback's own answer is respected, not silently allowed
    expect(mocks.rpc).toHaveBeenCalled()
  })
})

describe('checkRateLimitKv — Upstash not configured (the live production state)', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  it('never calls fetch, and defers entirely to the DB fallback', async () => {
    global.fetch = vi.fn() as unknown as typeof fetch
    mocks.rpc.mockResolvedValue({ data: true, error: null })

    const allowed = await checkRateLimitKv('mw:rl:orders_phone:9999999999', 3, 60)
    expect(allowed).toBe(true)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith('rate_limit_check', {
      p_key: 'mw:rl:orders_phone:9999999999', p_limit: 3, p_window_sec: 60,
    })
  })

  it('respects the DB fallback blocking a request over limit (not a blanket fail-open)', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    const allowed = await checkRateLimitKv('mw:rl:orders_phone:9999999999', 3, 60)
    expect(allowed).toBe(false)
  })

  it('still emits the alert:true captureError in production so ops visibility is unchanged', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    // @ts-expect-error — NODE_ENV is readonly in the type, fine to override in a test
    process.env.NODE_ENV = 'production'
    mocks.rpc.mockResolvedValue({ data: true, error: null })

    await checkRateLimitKv('mw:rl:coupon:1.2.3.4', 5, 60)

    expect(mocks.captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'rateLimitKv.missing_config', alert: true }),
    )
    // @ts-expect-error — restoring
    process.env.NODE_ENV = prevNodeEnv
  })

  it('only fails open as an absolute last resort — when the DB fallback itself errors', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } })
    const allowed = await checkRateLimitKv('mw:rl:orders_ip:1.2.3.4', 10, 60)
    expect(allowed).toBe(true)
    expect(mocks.loggerMetric).toHaveBeenCalledWith(
      'kv.db_fallback.error', 1, 'count', expect.objectContaining({ key_prefix: expect.any(String) }),
    )
  })

  it('only fails open as an absolute last resort — when getServiceClient/rpc throws', async () => {
    mocks.rpc.mockRejectedValue(new Error('supabase client init failed'))
    const allowed = await checkRateLimitKv('mw:rl:orders_ip:1.2.3.4', 10, 60)
    expect(allowed).toBe(true)
  })
})

describe('checkRateLimitKv — real Upstash response shape (regression for the live "blocks everything" bug)', () => {
  // BUG FIX (CRITICAL): a customer's very first, single checkout click showed
  // "Too many requests" — not an actual limit being exceeded. Root cause: the
  // code indexed Upstash's pipeline response as [["INCR", n], ["EXPIRE", ok]]
  // tuples, but Upstash's real format (per upstash.com/blog/pipeline) is an
  // array of {result: value} objects. result[0][1] on a real {result: 1}
  // object reads a nonexistent property → undefined, and `undefined <= limit`
  // is ALWAYS false in JS — so once Upstash was actually reachable, every
  // single call returned "blocked" regardless of the true count. The original
  // version of this test suite used the same wrong mock shape as the buggy
  // code, which is exactly why it didn't catch this — these tests use the
  // real, documented Upstash shape instead.
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL   = 'https://fake-kv.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
  })

  it('[BUG FIX] allows a single request with the real {result: 1} response shape', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ result: 1 }, { result: 'OK' }],
    }) as unknown as typeof fetch

    const allowed = await checkRateLimitKv('mw:rl:orders_phone:9876543210', 3, 60)
    expect(allowed).toBe(true)
    expect(mocks.rpc).not.toHaveBeenCalled() // must not need the DB fallback for a normal healthy response
  })

  it('blocks only once the real count actually exceeds the limit', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ result: 4 }, { result: 'OK' }],
    }) as unknown as typeof fetch

    const allowed = await checkRateLimitKv('mw:rl:orders_phone:9876543210', 3, 60)
    expect(allowed).toBe(false)
  })

  it('falls back to the DB check on a malformed/unexpected response shape rather than silently blocking forever', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ error: 'ERR wrong type' }, { result: 'OK' }],
    }) as unknown as typeof fetch
    mocks.rpc.mockResolvedValue({ data: true, error: null })

    const allowed = await checkRateLimitKv('mw:rl:orders_phone:9876543210', 3, 60)
    expect(allowed).toBe(true)
    expect(mocks.rpc).toHaveBeenCalled()
  })
})
