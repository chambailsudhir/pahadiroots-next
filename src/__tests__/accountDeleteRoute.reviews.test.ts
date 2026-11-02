/** Account erasure anonymises the customer's reviews (name -> Anonymous customer, unlinked; rating/text kept) and tolerates the v23 columns missing. */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  sbAuth: vi.fn(), sbAdmin: vi.fn(), getToken: vi.fn(), tryRefresh: vi.fn(),
  checkRateLimit: vi.fn(), checkRateLimitShared: vi.fn(), checkCsrf: vi.fn(),
}))
vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok:   (data: unknown) => NextResponse.json(data),
    fail: (status: number, msg: string) => NextResponse.json({ error: msg }, { status }),
    sbAuth: mocks.sbAuth, sbAdmin: mocks.sbAdmin, getToken: mocks.getToken, tryRefresh: mocks.tryRefresh,
    checkRateLimit: mocks.checkRateLimit, checkRateLimitShared: mocks.checkRateLimitShared,
    checkCsrf: mocks.checkCsrf, applyNewCookies: (res: NextResponse) => res,
  }
})

const fetchMock = vi.fn()
beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'service')
  vi.stubEnv('RESEND_API_KEY', 'resend')
  vi.stubGlobal('fetch', fetchMock)
})

const req = () => new NextRequest('https://pahadiroots.com/api/account/delete', {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7', origin: 'https://pahadiroots.com' },
  body: JSON.stringify({ confirm: 'DELETE', password: 'Correct-Horse-9!' }),
})
const USER = { id: 'auth-uuid', email: 'asha@example.com', app_metadata: { provider: 'email', providers: ['email'] } }
let reviewsPatch: () => unknown
const calls = () => mocks.sbAdmin.mock.calls as Array<[string, string, Record<string, unknown>?]>

beforeEach(() => {
  vi.clearAllMocks()
  reviewsPatch = () => null
  mocks.checkCsrf.mockReturnValue(null); mocks.checkRateLimit.mockReturnValue(true); mocks.checkRateLimitShared.mockResolvedValue(true)
  mocks.getToken.mockReturnValue('jwt'); mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockImplementation(async (p: string) => (p.startsWith('/token') ? { access_token: 'x' } : USER))
  mocks.sbAdmin.mockImplementation(async (m: string, path: string) => {
    if (path.startsWith('/rest/v1/customers?auth_user_id=')) return [{ id: 42, email: 'asha@example.com' }]
    if (path.includes('order_status=not.in.')) return []
    if (m === 'GET' && path.startsWith('/rest/v1/orders?customer_id=eq.42&select=id')) return []
    if (m === 'PATCH' && path.startsWith('/rest/v1/customers?id=')) return [{ id: 42, auth_user_id: null }]
    if (m === 'PATCH' && path.startsWith('/rest/v1/reviews?')) return reviewsPatch()
    return []
  })
  fetchMock.mockImplementation(async (u: string) => {
    const ok = !String(u).includes('/auth/v1/admin/users/') || true
    return { ok, status: 200, text: async () => '', json: async () => ({}) }
  })
})

describe('DELETE /api/account/delete — reviews', () => {
  it('anonymises and unlinks the customer’s reviews, keeping rating and text', async () => {
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req())
    expect(res.status).toBe(200)
    const patch = calls().find(([m, p]) => m === 'PATCH' && p === '/rest/v1/reviews?customer_id=eq.42')!
    expect(patch[2]).toEqual({ customer_name: 'Anonymous customer', customer_id: null, order_id: null })
    expect(patch[2]).not.toHaveProperty('rating')
    expect(patch[2]).not.toHaveProperty('review_text')
    // runs before the customer row is unlinked (the last DB write)
    const idx = (pred: (c: [string, string]) => boolean) => calls().findIndex(c => pred([c[0], c[1]]))
    expect(idx(([m, p]) => m === 'PATCH' && p.startsWith('/rest/v1/reviews?'))).toBeLessThan(idx(([m, p]) => m === 'PATCH' && p.startsWith('/rest/v1/customers?id=')))
  })

  it('does NOT fail the deletion when the v23 columns do not exist yet', async () => {
    reviewsPatch = () => { throw { status: 400, message: '{"code":"42703","message":"column reviews.customer_id does not exist"}' } }
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req())
    expect(res.status).toBe(200)
  })

  it('still fails (retryable, before the irreversible auth delete) on a real database error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    reviewsPatch = () => { throw { status: 500, message: 'boom' } }
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req())
    expect(res.status).toBe(500)
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/auth/v1/admin/users/'))).toBe(false)
  })
})
