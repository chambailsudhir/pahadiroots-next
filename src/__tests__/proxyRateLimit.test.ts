/**
 * proxyRateLimit.test.ts
 *
 * Regression test for the same class of bug found and fixed in
 * rateLimitKv.ts and api/auth/route.ts during a live debugging session:
 * Upstash's pipeline REST API returns an array of RESULT OBJECTS —
 * [{"result": 1}, {"result": "OK"}] — not [["INCR", 1], ["EXPIRE", "OK"]]
 * tuples. This file's version of the bug ran the OPPOSITE direction from the
 * other two: `undefined > GLOBAL_LIMIT` is always false in JavaScript, so
 * this global edge-level limiter could never trigger at all — it silently
 * did nothing for every request instead of blocking abusive traffic. Lower
 * severity than the route-level bugs (this is defense-in-depth, not the only
 * protection layer), but a real gap worth covering directly.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

vi.mock('@/lib/getSiteSettings', () => ({
  getSiteSettings: vi.fn().mockResolvedValue({ storeOpen: true }),
}))

const originalEnv = { ...process.env }
const originalFetch = global.fetch

function postRequest(pathname: string) {
  return new NextRequest(`https://pahadiroots-next.vercel.app${pathname}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.7' },
  })
}

beforeEach(() => {
  process.env = { ...originalEnv }
  process.env.UPSTASH_REDIS_REST_URL   = 'https://fake-kv.upstash.io'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe('proxy() global rate limiter — real Upstash response shape', () => {
  it('[BUG FIX] blocks with 429 once the real count exceeds the global limit', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      // A count comfortably above any reasonable GLOBAL_LIMIT — the exact
      // threshold isn't the point of this test, just that a real numeric
      // result this high must trigger a block.
      json: async () => [{ result: 100000 }, { result: 'OK' }],
    }) as unknown as typeof fetch

    const res = await proxy(postRequest('/api/v1/orders'))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toMatch(/too many requests/i)
  })

  it('allows the request through when the real count is well within limit', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ result: 1 }, { result: 'OK' }],
    }) as unknown as typeof fetch

    const res = await proxy(postRequest('/api/v1/orders'))
    expect(res.status).not.toBe(429)
  })

  it('fails open (does not throw or false-block) on a malformed/unexpected response shape', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ error: 'ERR wrong type' }, { result: 'OK' }],
    }) as unknown as typeof fetch

    const res = await proxy(postRequest('/api/v1/orders'))
    expect(res.status).not.toBe(429)
  })
})
