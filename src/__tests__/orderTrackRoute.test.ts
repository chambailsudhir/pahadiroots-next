/**
 * orderTrackRoute.test.ts
 *
 * GET /api/v1/orders/track — replaces track/page.tsx's old direct
 * client-side Supabase query with a proper server-side, rate-limited,
 * service-role-only lookup (see route.ts header for the full incident
 * writeup: the old approach either always returned nothing, because RLS
 * has no anon SELECT policy on `orders`, or was a PII leak, because making
 * it work would require a policy that also lets anyone query the full
 * table directly with the public anon key).
 *
 * This is a PUBLIC, unauthenticated endpoint gated only by order_number +
 * phone matching a real row — every test here is about proving that gate
 * actually holds (rate limits, exact-match requirement, uniform 404s,
 * minimal response shape), not just that happy-path data comes back.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  sbAdmin:          vi.fn(),
  checkRateLimitKv: vi.fn(),
}))

vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok:   (data: unknown) => NextResponse.json(data),
    fail: (status: number, msg: string) => NextResponse.json({ error: msg }, { status }),
    sbAdmin: mocks.sbAdmin,
  }
})

vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: mocks.checkRateLimitKv }))

function makeRequest(query: string) {
  return new NextRequest(`https://pahadiroots.com/api/v1/orders/track${query}`, {
    headers: { 'x-forwarded-for': '1.2.3.4' },
  })
}

const SAMPLE_ROW = {
  order_number: 'PR1A2B3C4D', order_status: 'shipped', payment_method: 'cod',
  created_at: '2026-08-01T10:00:00Z', total_amount: 500,
  customer_phone: '9876543210',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkRateLimitKv.mockResolvedValue(true)
})

describe('GET /api/v1/orders/track — input validation', () => {
  it('400s when order_number is missing', async () => {
    const { GET } = await import('@/app/api/v1/orders/track/route')
    const res = await GET(makeRequest('?phone=9876543210'))
    expect(res.status).toBe(400)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })

  it('400s when phone is missing', async () => {
    const { GET } = await import('@/app/api/v1/orders/track/route')
    const res = await GET(makeRequest('?order_number=PR1A2B3C4D'))
    expect(res.status).toBe(400)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })

  it('400s for a phone number that is not 10 digits, without ever querying the DB', async () => {
    const { GET } = await import('@/app/api/v1/orders/track/route')
    const res = await GET(makeRequest('?order_number=PR1A2B3C4D&phone=12345'))
    expect(res.status).toBe(400)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })

  it('404s (not 500) for an order_number containing SQL-injection-style characters, without ever querying the DB', async () => {
    const { GET } = await import('@/app/api/v1/orders/track/route')
    const res = await GET(makeRequest("?order_number=1' OR '1'='1&phone=9876543210"))
    expect(res.status).toBe(404)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })

  it('normalizes a phone number with spaces/dashes/+91 prefix to the last 10 digits', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([SAMPLE_ROW])
    const { GET } = await import('@/app/api/v1/orders/track/route')
    await GET(makeRequest('?order_number=PR1A2B3C4D&phone=' + encodeURIComponent('+91 98765-43210')))

    const [, path] = mocks.sbAdmin.mock.calls[0]
    expect(path).toContain('customer_phone=eq.9876543210')
  })
})

describe('GET /api/v1/orders/track — rate limiting', () => {
  it('429s when the per-IP rate limit is exceeded, before touching the DB', async () => {
    mocks.checkRateLimitKv.mockResolvedValueOnce(false) // IP limit fails first
    const { GET } = await import('@/app/api/v1/orders/track/route')
    const res = await GET(makeRequest('?order_number=PR1A2B3C4D&phone=9876543210'))
    expect(res.status).toBe(429)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })

  it('429s when the per-order_number rate limit is exceeded (brute-force guard, tighter than the IP limit)', async () => {
    mocks.checkRateLimitKv
      .mockResolvedValueOnce(true)   // IP limit passes
      .mockResolvedValueOnce(false)  // order_number limit fails
    const { GET } = await import('@/app/api/v1/orders/track/route')
    const res = await GET(makeRequest('?order_number=PR1A2B3C4D&phone=9876543210'))
    expect(res.status).toBe(429)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })

  it('rate-limits per order_number, not globally — the limiter key includes the order number', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([SAMPLE_ROW])
    const { GET } = await import('@/app/api/v1/orders/track/route')
    await GET(makeRequest('?order_number=PR1A2B3C4D&phone=9876543210'))

    const orderLimitCall = mocks.checkRateLimitKv.mock.calls.find(c => String(c[0]).includes('order_track_num'))
    expect(orderLimitCall?.[0]).toContain('PR1A2B3C4D')
  })
})

describe('GET /api/v1/orders/track — lookup behaviour', () => {
  it('returns the order when order_number AND phone both match the same row', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([SAMPLE_ROW])
    const { GET } = await import('@/app/api/v1/orders/track/route')
    const res  = await GET(makeRequest('?order_number=PR1A2B3C4D&phone=9876543210'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.order).toMatchObject({
      order_number: 'PR1A2B3C4D', order_status: 'shipped', payment_method: 'cod', total_amount: 500,
    })
  })

  it('the DB query filters by BOTH order_number and customer_phone together (can never match on phone alone)', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([SAMPLE_ROW])
    const { GET } = await import('@/app/api/v1/orders/track/route')
    await GET(makeRequest('?order_number=PR1A2B3C4D&phone=9876543210'))

    const [, path] = mocks.sbAdmin.mock.calls[0]
    expect(path).toContain('order_number=eq.PR1A2B3C4D')
    expect(path).toContain('customer_phone=eq.9876543210')
  })

  it('404s uniformly when the phone does not match — does not distinguish "wrong phone" from "order does not exist"', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([]) // no matching row
    const { GET } = await import('@/app/api/v1/orders/track/route')
    const res = await GET(makeRequest('?order_number=PR1A2B3C4D&phone=0000000000'))
    expect(res.status).toBe(404)
  })

  it('404s (not 500) when the DB call itself fails', async () => {
    mocks.sbAdmin.mockRejectedValueOnce(new Error('network error'))
    const { GET } = await import('@/app/api/v1/orders/track/route')
    const res = await GET(makeRequest('?order_number=PR1A2B3C4D&phone=9876543210'))
    expect(res.status).toBe(404)
  })

  // Guards the response shape itself — this is a PUBLIC endpoint, it must
  // never leak more than the status stepper needs (no address, no items, no
  // customer name/phone/email, no internal ids).
  it('never returns fields beyond the minimal public tracking shape', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([SAMPLE_ROW])
    const { GET } = await import('@/app/api/v1/orders/track/route')
    const res  = await GET(makeRequest('?order_number=PR1A2B3C4D&phone=9876543210'))
    const body = await res.json()

    expect(Object.keys(body.order).sort()).toEqual(
      ['created_at', 'order_number', 'order_status', 'payment_method', 'total_amount'].sort(),
    )
  })
})
