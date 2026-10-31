/**
 * actionsRoute.notifyStock.test.ts
 *
 * Direct route-level tests for POST /api/v1/actions, covering two P1
 * audit fixes with zero prior test coverage:
 *
 *   1. notify_stock — ProductCard's "Notify Me" button previously had no
 *      backend at all. This is the real capture behind it now, writing
 *      to stock_notifications (db_migration_v10).
 *   2. the shared per-IP rate limit on the whole dispatcher.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// next/server's after() throws "called outside a request scope" when a
// route handler is invoked directly (as these tests do) rather than through
// Next's real request pipeline, which does establish that scope. Mocked
// here to run the deferred callback fire-and-forget (matching real
// production semantics — non-blocking, doesn't delay the response) instead
// of throwing and turning every after()-using action into a false 500.
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (cb: () => void | Promise<void>) => { void cb() } }
})

const mockUpsert = vi.fn()
const mockFrom   = vi.fn(() => ({ upsert: mockUpsert }))

vi.mock('@/lib/supabase', () => ({
  getServiceClient: vi.fn(() => ({ from: mockFrom })),
}))
vi.mock('@/lib/server/email', () => ({
  sendTransactionalEmail: vi.fn().mockResolvedValue(undefined),
}))
// Shared (cross-instance) limiter — the route no longer uses the per-instance in-memory one.
const mockRateLimit = vi.fn().mockResolvedValue(true)
vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: (...a: unknown[]) => mockRateLimit(...a) }))

import { POST } from '@/app/api/v1/actions/route'

let ipCounter = 0
function req(body: Record<string, unknown>) {
  ipCounter++
  return new NextRequest('http://localhost/api/v1/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${ipCounter}` },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/actions — notify_stock (P1 fix)', () => {
  beforeEach(() => {
    mockUpsert.mockReset()
    mockFrom.mockClear()
  })

  it('writes a real row to stock_notifications instead of doing nothing', async () => {
    mockUpsert.mockResolvedValue({ error: null })

    const res = await POST(req({ action: 'notify_stock', email: 'jane@example.com', product_id: 101 }))
    const json = await res.json()

    expect(json).toEqual({ success: true })
    expect(mockFrom).toHaveBeenCalledWith('stock_notifications')
    expect(mockUpsert).toHaveBeenCalledWith(
      { product_id: 101, email: 'jane@example.com' },
      { onConflict: 'product_id,email', ignoreDuplicates: true },
    )
  })

  it('rejects an invalid email instead of writing garbage to the table', async () => {
    const res = await POST(req({ action: 'notify_stock', email: 'not-an-email', product_id: 101 }))
    expect(res.status).toBe(400)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('rejects a missing product_id', async () => {
    const res = await POST(req({ action: 'notify_stock', email: 'jane@example.com' }))
    expect(res.status).toBe(400)
  })

  it('returns a 500 (not a false success) when the DB write fails', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'db down' } })

    const res = await POST(req({ action: 'notify_stock', email: 'jane@example.com', product_id: 101 }))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/v1/actions — shared IP rate limit (audit C-11)', () => {
  beforeEach(() => { mockRateLimit.mockReset().mockResolvedValue(true) })

  it('answers 429 with Retry-After when the shared limiter says the IP is over its budget', async () => {
    mockRateLimit.mockResolvedValue(false)
    const res = await POST(req({ action: 'notify_stock', email: 'jane@example.com', product_id: 1 }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
  })

  it('keys the limit by client IP in the shared store (10 per minute)', async () => {
    await POST(req({ action: 'notify_stock', email: 'jane@example.com', product_id: 1 }))
    expect(mockRateLimit).toHaveBeenCalledWith(expect.stringMatching(/^mw:rl:actions_ip:10\.0\.0\.\d+$/), 10, 60)
  })
})
