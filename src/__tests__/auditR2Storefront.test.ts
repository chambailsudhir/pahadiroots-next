/**
 * Audit Round 2 — storefront regression tests (SF-1 … SF-4).
 * Each asserts the SECURE behaviour; they failed on the 2026-10-23 snapshot.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { COOKIE_TOKEN } from '@/lib/auth/cookies'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
process.env.SUPABASE_SERVICE_KEY = 'service'
process.env.SUPABASE_URL = 'https://proj.supabase.co'
process.env.SUPABASE_ANON_KEY = 'anon'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
process.env.RESEND_API_KEY = 're_x'
delete process.env.UPSTASH_REDIS_REST_URL
delete process.env.UPSTASH_REDIS_REST_TOKEN

const mocks = vi.hoisted(() => ({
  sbAdmin: vi.fn(), sbAuth: vi.fn(), getToken: vi.fn(), tryRefresh: vi.fn(),
  syncCustomerProfile: vi.fn(), applyNewCookies: vi.fn(), checkCsrf: vi.fn(),
}))
vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok: (d: unknown) => NextResponse.json(d),
    fail: (s: number, m: string) => NextResponse.json({ error: m }, { status: s }),
    toPublicProfile: (p: unknown) => p,
    sbAdmin: mocks.sbAdmin, sbAuth: mocks.sbAuth, getToken: mocks.getToken, tryRefresh: mocks.tryRefresh,
    syncCustomerProfile: mocks.syncCustomerProfile, applyNewCookies: mocks.applyNewCookies, checkCsrf: mocks.checkCsrf,
  }
})
vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: vi.fn(async () => true) }))

const PROFILE = { id: 'cust-1', first_name: 'A', last_name: 'B' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkCsrf.mockReturnValue(null); mocks.getToken.mockReturnValue('tok'); mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'u1' }); mocks.syncCustomerProfile.mockResolvedValue(PROFILE)
})

const authReq = (body: object, ip = '10.0.0.1') => new NextRequest('https://pahadiroots.com/api/auth', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://pahadiroots.com', 'x-forwarded-for': ip }, body: JSON.stringify(body),
})

describe('SF-1 forgot_password is throttled', () => {
  it('stops e-mailing the same address after 3 requests an hour, with an unchanged generic answer', async () => {
    const fetchMock = vi.fn(async (..._a: unknown[]) => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }))
    vi.stubGlobal('fetch', fetchMock)
    const { POST } = await import('@/app/api/auth/route')
    let last: Response | undefined
    for (let i = 0; i < 6; i++) last = await POST(authReq({ action: 'forgot_password', email: 'victim@example.com' }, `20.0.0.${i}`)) // 6 different IPs
    const sent = fetchMock.mock.calls.filter(([u]) => String(u).includes('generate_link')).length
    expect(sent).toBeLessThanOrEqual(3)
    expect(last!.status).toBe(200)
    vi.unstubAllGlobals()
  })
  it('limits per IP too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })))
    const { POST } = await import('@/app/api/auth/route')
    const codes: number[] = []
    for (let i = 0; i < 8; i++) codes.push((await POST(authReq({ action: 'forgot_password', email: `x${i}@example.com` }, '30.0.0.1'))).status)
    expect(codes).toContain(429)
    vi.unstubAllGlobals()
  })
})

describe('SF-2 legacy create_return ignores a customer-chosen refund', () => {
  it('stores refund_amount null and refuses a non-plain order_id', async () => {
    let inserted: any = null
    const json = (d: unknown) => ({ ok: true, status: 200, json: async () => d, text: async () => JSON.stringify(d) })
    vi.stubGlobal('fetch', vi.fn(async (u: string, o: any = {}) => {
      const url = String(u), m = (o.method || 'GET').toUpperCase()
      if (url.includes('/auth/v1/user')) return json({ id: 'u1' })
      if (m === 'GET' && url.includes('/rest/v1/orders?')) return json([{ id: 7, order_status: 'delivered', order_number: 'PR-7', total_amount: 100, delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() }])
      if (m === 'GET') return json([])
      if (m === 'POST' && url.includes('/rest/v1/returns')) { inserted = JSON.parse(o.body); return json([{ id: 'r1' }]) }
      return json([])
    }))
    const { POST } = await import('@/app/api/auth/route')
    const withCookie = (body: object, ip: string) => new NextRequest('https://pahadiroots.com/api/auth', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://pahadiroots.com', 'x-forwarded-for': ip, cookie: `${COOKIE_TOKEN}=tok` }, body: JSON.stringify(body),
    })
    expect((await POST(withCookie({ action: 'create_return', order_id: '7&customer_id=neq.0', reason: 'damaged' }, '40.0.0.1'))).status).toBe(400)
    const good = await POST(withCookie({ action: 'create_return', order_id: 7, reason: 'damaged', refund_amount: '99999' }, '40.0.0.2'))
    expect(good.status).toBeLessThan(300)
    expect(inserted).not.toBeNull()
    expect(inserted.refund_amount).toBeNull()
    vi.unstubAllGlobals()
  })
})

describe('SF-3 return photo URLs must be this project\'s own storage URLs', () => {
  it('drops look-alike, javascript: and foreign-host URLs', async () => {
    let inserted: any = null
    mocks.sbAdmin.mockImplementation(async (m: string, p: string, b?: any) => {
      if (m === 'GET' && p.includes('/rest/v1/orders?')) return [{ id: 501, order_status: 'delivered', delivered_at: new Date().toISOString(), updated_at: new Date().toISOString(), order_number: 'PR-501' }]
      if (m === 'GET') return []
      if (m === 'POST' && p.includes('/rest/v1/returns')) { inserted = b; return null }
      throw new Error(`Unexpected ${m} ${p}`)
    })
    const good = 'https://proj.supabase.co/storage/v1/object/public/pahadi-images/returns/501/1-a.jpg'
    const { POST } = await import('@/app/api/orders/[id]/return/route')
    const req = new NextRequest('https://pahadiroots.com/api/orders/501/return', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://pahadiroots.com' },
      body: JSON.stringify({ reason: 'damaged', photo_urls: [
        good,
        'javascript:alert(1)//storage/v1/object/public/pahadi-images/returns/501/',
        'https://evil.example/storage/v1/object/public/pahadi-images/returns/501/x.jpg',
        'https://proj.supabase.co/storage/v1/object/public/pahadi-images/returns/999/other.jpg',
        good + '"onerror="x',
      ] }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: '501' }) })
    expect(res.status).toBe(200)
    expect(inserted.photo_urls).toEqual([good])
  })
})

describe('SF-4 return upload-url is rate limited and hides storage errors', () => {
  it('429 when the per-customer cap is hit', async () => {
    const kv = await import('@/lib/api/rateLimitKv')
    ;(kv.checkRateLimitKv as any).mockResolvedValueOnce(false)
    const { POST } = await import('@/app/api/orders/[id]/return/upload-url/route')
    const req = new NextRequest('https://pahadiroots.com/api/orders/5/return/upload-url', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://pahadiroots.com' }, body: JSON.stringify({ fileName: 'a.jpg', fileType: 'image/jpeg' }),
    })
    expect((await POST(req, { params: Promise.resolve({ id: '5' }) })).status).toBe(429)
  })
})
