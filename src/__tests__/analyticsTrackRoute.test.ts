/**
 * POST /api/v1/analytics/track — abuse hardening (audit C-11): shared rate limit, foreign-site rejection,
 * bounded free-form fields. Normal first-party beacons must keep working.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const sbAdmin = vi.fn().mockResolvedValue([])
vi.mock('@/lib/api/serverUtils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/serverUtils')>('@/lib/api/serverUtils')
  return { ...actual, sbAdmin: (...a: unknown[]) => sbAdmin(...a) }
})
const rateLimit = vi.fn().mockResolvedValue(true)
vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: (...a: unknown[]) => rateLimit(...a) }))

import { POST } from '@/app/api/v1/analytics/track/route'

const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
const ev = (over: Record<string, unknown> = {}) => ({ session_id: 's1', visitor_id: 'v1', event_type: 'page_view', path: '/', ...over })
const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new NextRequest('http://localhost/api/v1/analytics/track', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA, 'x-forwarded-for': '10.2.2.2', ...headers }, body: JSON.stringify(body) }))
const eventsWritten = () => sbAdmin.mock.calls.find(c => String(c[1]).includes('analytics_events'))?.[2] as Record<string, unknown>[] | undefined

beforeEach(() => { sbAdmin.mockClear(); rateLimit.mockReset().mockResolvedValue(true) })

describe('analytics track route hardening', () => {
  it('accepts a normal first-party event (same origin) and stores it', async () => {
    const res = await call(ev(), { origin: 'https://www.pahadiroots.com' })
    expect(res.status).toBe(200)
    expect(eventsWritten()).toHaveLength(1)
  })

  it('still accepts a beacon that carries no Origin/Referer header (sendBeacon can omit them)', async () => {
    expect((await call(ev())).status).toBe(200)
    expect(eventsWritten()).toHaveLength(1)
  })

  it('rejects events posted from another website', async () => {
    const res = await call(ev(), { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(sbAdmin).not.toHaveBeenCalled()
  })

  it('uses the shared limiter (240/min per IP) and answers 429 when exceeded', async () => {
    await call(ev())
    expect(rateLimit).toHaveBeenCalledWith('mw:rl:analytics_ip:10.2.2.2', 240, 60)
    rateLimit.mockResolvedValue(false)
    const res = await call(ev())
    expect(res.status).toBe(429)
  })

  it('does not store oversized metadata (>2000 chars) or non-object metadata', async () => {
    await call({ events: [ev({ metadata: { blob: 'x'.repeat(5000) } }), ev({ metadata: ['a'] }), ev({ metadata: { ok: 1 } })] })
    const rows = eventsWritten()!
    expect(rows.map(r => r.metadata)).toEqual([{}, {}, { ok: 1 }])
  })

  it('drops invalid ids and counts instead of storing them', async () => {
    await call(ev({ product_id: -5, variant_id: 1.5, results_count: 1e12 }))
    expect(eventsWritten()![0]).toMatchObject({ product_id: null, variant_id: null, results_count: null })
    sbAdmin.mockClear()
    await call(ev({ product_id: 42, variant_id: 7, results_count: 12 }))
    expect(eventsWritten()![0]).toMatchObject({ product_id: 42, variant_id: 7, results_count: 12 })
  })

  it('refuses a huge request body before parsing it', async () => {
    const res = await call(ev(), { 'content-length': '500000' })
    expect(res.status).toBe(413)
    expect(sbAdmin).not.toHaveBeenCalled()
  })

  it('silently ignores bots', async () => {
    const res = await call(ev(), { 'user-agent': 'Googlebot/2.1' })
    expect(res.status).toBe(200)
    expect(sbAdmin).not.toHaveBeenCalled()
  })

  it('still de-duplicates purchase events by order id even when metadata is later capped', async () => {
    await call(ev({ event_type: 'purchase', metadata: { order_id: 'HV-1', value: 100 } }))
    expect(eventsWritten()![0]).toMatchObject({ dedupe_key: 'purchase:HV-1' })
  })
})
