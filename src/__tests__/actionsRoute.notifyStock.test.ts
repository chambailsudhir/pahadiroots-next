/**
 * actionsRoute.notifyStock.test.ts
 *
 * Direct route-level tests for POST /api/v1/actions, covering two P1
 * audit fixes with zero prior test coverage:
 *
 *   1. notify_stock — ProductCard's "Notify Me" button previously had no
 *      backend at all. This is the real capture behind it now, writing
 *      to stock_notifications (db_migration_v10).
 *   2. subscribe — the pre-existing (not introduced by this audit)
 *      `subscribers` upsert was sending a `subscribed_at` column that
 *      doesn't exist on the real table (confirmed via live schema
 *      introspection) and never checked the result for an error, so
 *      failures were silent. Now checked and surfaced as a 500.
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
// Double opt-in: `subscribe` only emails a confirmation link.
const mockSendConfirm = vi.fn().mockResolvedValue({ sent: true })
vi.mock('@/lib/server/subscribe', () => ({ sendSubscribeConfirmation: (...a: unknown[]) => mockSendConfirm(...a) }))

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

describe('POST /api/v1/actions — subscribe (double opt-in, audit C-11)', () => {
  beforeEach(() => {
    mockUpsert.mockReset()
    mockFrom.mockClear()
    mockSendConfirm.mockClear()
    mockRateLimit.mockReset().mockResolvedValue(true)
  })

  it('only emails a confirmation link — it does NOT store the address or create a coupon yet', async () => {
    const res = await POST(req({ action: 'subscribe', email: 'Jane@Example.com', name: 'Jane' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, pending: true })
    await vi.waitFor(() => expect(mockSendConfirm).toHaveBeenCalledTimes(1))
    expect(mockSendConfirm).toHaveBeenCalledWith({ email: 'jane@example.com', name: 'Jane', source: null })
    expect(mockFrom).not.toHaveBeenCalled()          // nothing written to subscribers / coupons
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('rejects an invalid email', async () => {
    const res = await POST(req({ action: 'subscribe', email: 'nope' }))
    expect(res.status).toBe(400)
    expect(mockSendConfirm).not.toHaveBeenCalled()
  })

  it('strips HTML from the name before it goes into the email token', async () => {
    await POST(req({ action: 'subscribe', email: 'a@b.co', name: '<script>alert(1)</script>Ann' }))
    await vi.waitFor(() => expect(mockSendConfirm).toHaveBeenCalled())
    expect(mockSendConfirm.mock.calls[0][0].name).toBe('alert(1)Ann')
  })

  it('stops mailing an address after its hourly limit but answers identically (no address enumeration)', async () => {
    mockRateLimit.mockImplementation(async (key: string) => !String(key).startsWith('mw:rl:subscribe_email:'))
    const res = await POST(req({ action: 'subscribe', email: 'victim@example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, pending: true })
    await new Promise(r => setTimeout(r, 20))
    expect(mockSendConfirm).not.toHaveBeenCalled()
  })

  it('limits per address with the shared limiter: 3 per hour', async () => {
    await POST(req({ action: 'subscribe', email: 'jane@example.com' }))
    expect(mockRateLimit).toHaveBeenCalledWith('mw:rl:subscribe_email:jane@example.com', 3, 3600)
  })
})

describe('POST /api/v1/actions — shared IP rate limit (audit C-11)', () => {
  beforeEach(() => { mockRateLimit.mockReset().mockResolvedValue(true); mockSendConfirm.mockClear() })

  it('answers 429 with Retry-After when the shared limiter says the IP is over its budget', async () => {
    mockRateLimit.mockResolvedValue(false)
    const res = await POST(req({ action: 'subscribe', email: 'jane@example.com' }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(mockSendConfirm).not.toHaveBeenCalled()
  })

  it('keys the limit by client IP in the shared store (10 per minute)', async () => {
    await POST(req({ action: 'notify_stock', email: 'jane@example.com', product_id: 1 }))
    expect(mockRateLimit).toHaveBeenCalledWith(expect.stringMatching(/^mw:rl:actions_ip:10\.0\.0\.\d+$/), 10, 60)
  })
})
