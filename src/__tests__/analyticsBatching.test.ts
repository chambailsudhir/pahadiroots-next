/**
 * analyticsBatching.test.ts — DISK-IO FIX (Oct 2026).
 * Supabase warned the project was about to deplete its Disk IO budget; visitor analytics wrote two rows
 * (session upsert + event insert) per page view. The browser now queues events and the route writes ONE bulk
 * insert per batch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ sbAdmin: vi.fn() }))
vi.mock('@/lib/api/serverUtils', () => ({ sbAdmin: mocks.sbAdmin, hasForeignOrigin: () => false }))
// The route now uses the shared (cross-instance) limiter instead of the per-instance in-memory one.
vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/logger', () => ({ captureError: vi.fn() }))

const ev = (over: Record<string, unknown> = {}) => ({ session_id: 's1', visitor_id: 'v1', event_type: 'page_view', path: '/', ...over })
const post = (body: unknown) => new NextRequest('http://x/api/v1/analytics/track', {
  method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile', 'content-type': 'application/json' }, body: JSON.stringify(body),
})

describe('POST /api/v1/analytics/track — batched writes', () => {
  beforeEach(() => { mocks.sbAdmin.mockReset(); mocks.sbAdmin.mockResolvedValue(undefined) })

  it('writes one session upsert and ONE bulk event insert for a batch of 5 events', async () => {
    const { POST } = await import('@/app/api/v1/analytics/track/route')
    const res = await POST(post({ events: [ev({ landing_page: '/' }), ev(), ev(), ev(), ev({ event_type: 'search' })] }))
    expect(res.status).toBe(200)
    expect(mocks.sbAdmin).toHaveBeenCalledTimes(2)
    const [, evPath, rows, prefer] = mocks.sbAdmin.mock.calls[1]
    expect(evPath).toBe('/rest/v1/analytics_events?on_conflict=dedupe_key')
    expect(prefer).toBe('resolution=ignore-duplicates,return=minimal')
    expect(rows).toHaveLength(5)
    const keys = new Set(rows.map((r: object) => Object.keys(r).sort().join()))
    expect(keys.size).toBe(1) // PostgREST bulk insert needs uniform keys
  })

  it('does not blank landing_page when the first event is not in this batch', async () => {
    const { POST } = await import('@/app/api/v1/analytics/track/route')
    await POST(post({ events: [ev()] }))
    const sess = mocks.sbAdmin.mock.calls[0][2]
    expect('landing_page' in sess).toBe(false)
    expect(sess.device_type).toBe('mobile')
  })

  it('keeps accepting a single legacy event', async () => {
    const { POST } = await import('@/app/api/v1/analytics/track/route')
    expect((await POST(post(ev()))).status).toBe(200)
    expect(mocks.sbAdmin.mock.calls[1][2]).toHaveLength(1)
  })

  it('drops invalid events, caps the batch at 20, and rejects an all-invalid request', async () => {
    const { POST } = await import('@/app/api/v1/analytics/track/route')
    await POST(post({ events: [ev({ event_type: 'nope' }), ...Array.from({ length: 30 }, () => ev())] }))
    expect(mocks.sbAdmin.mock.calls[1][2]).toHaveLength(19) // first 20 taken, 1 invalid dropped
    mocks.sbAdmin.mockClear()
    expect((await POST(post({ events: [ev({ session_id: '' })] }))).status).toBe(400)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })
})

// Overview audit OV-080: purchase events are idempotent per order.
describe('POST /api/v1/analytics/track — purchase idempotency', () => {
  beforeEach(() => { mocks.sbAdmin.mockReset(); mocks.sbAdmin.mockResolvedValue(undefined) })

  it('a purchase event carries dedupe_key "purchase:<order number>"; every other event carries null (and every row has the same keys)', async () => {
    const { POST } = await import('@/app/api/v1/analytics/track/route')
    await POST(post({ events: [ev(), ev({ event_type: 'purchase', metadata: { order_id: 'ORD-2026-00131', value: 100 } })] }))
    const rows = mocks.sbAdmin.mock.calls[1][2]
    expect(rows.map((r: any) => r.dedupe_key)).toEqual([null, 'purchase:ORD-2026-00131'])
    expect(new Set(rows.map((r: object) => Object.keys(r).sort().join())).size).toBe(1)
  })

  it('a purchase without a usable order number gets no key (it is still recorded, just not deduplicated)', async () => {
    const { POST } = await import('@/app/api/v1/analytics/track/route')
    await POST(post({ events: [ev({ event_type: 'purchase', metadata: {} }), ev({ event_type: 'purchase', metadata: { order_id: 42 } }), ev({ event_type: 'purchase', metadata: { order_id: 'x'.repeat(61) } })] }))
    expect(mocks.sbAdmin.mock.calls[1][2].map((r: any) => r.dedupe_key)).toEqual([null, null, null])
  })

  it('the same order sent twice in one batch is sent as two rows with the SAME key — the database (unique index + ignore-duplicates) keeps one', async () => {
    const { POST } = await import('@/app/api/v1/analytics/track/route')
    const p = ev({ event_type: 'purchase', metadata: { order_id: 'ORD-9' } })
    await POST(post({ events: [p, p] }))
    const rows = mocks.sbAdmin.mock.calls[1][2]
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r: any) => r.dedupe_key))).toEqual(new Set(['purchase:ORD-9']))
    expect(mocks.sbAdmin.mock.calls[1][3]).toMatch(/ignore-duplicates/)
  })
})
