/** Nov 2026 audit (data export): a quota hit reserved up front can be refunded when the attempt fails. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() }, getServiceClient: vi.fn(() => ({ rpc: vi.fn(async () => ({ data: true, error: null })) })) }))
vi.mock('@/lib/logger', () => ({ captureError: vi.fn(), logger: { warn: vi.fn(), metric: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const originalFetch = global.fetch
afterEach(() => { global.fetch = originalFetch; vi.unstubAllEnvs() })

describe('releaseRateLimitKv', () => {
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://kv.example')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 't')
  })
  it('sends an atomic never-below-zero decrement for the key', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([{ result: 0 }]), { status: 200 }))
    global.fetch = f as unknown as typeof fetch
    const { releaseRateLimitKv } = await import('@/lib/api/rateLimitKv')
    expect(await releaseRateLimitKv('mw:rl:acct:data_export:u1')).toBe(true)
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body[0][0]).toBe('EVAL')
    expect(body[0]).toContain('mw:rl:acct:data_export:u1')
    expect(body[0][1]).toMatch(/if v > 0 then return redis.call\('DECR'/)
  })
  it('never throws; reports false on KV failure or without KV', async () => {
    global.fetch = vi.fn(async () => { throw new Error('down') }) as unknown as typeof fetch
    const { releaseRateLimitKv } = await import('@/lib/api/rateLimitKv')
    expect(await releaseRateLimitKv('k')).toBe(false)
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    expect(await releaseRateLimitKv('k')).toBe(false)
  })
})

describe('releaseRateLimitShared (in-process counter)', () => {
  it('refunds one hit so the next attempt is allowed again', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    const { checkRateLimit, releaseRateLimitShared } = await import('@/lib/api/serverUtils')
    const key = `release_test:${Math.random()}`
    expect(checkRateLimit(key, 1, 60_000)).toBe(true)
    expect(checkRateLimit(key, 1, 60_000)).toBe(false)
    await releaseRateLimitShared(key)
    expect(checkRateLimit(key, 1, 60_000)).toBe(true)
  })
})
