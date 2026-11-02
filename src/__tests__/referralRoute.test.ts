/** POST /api/v1/referral — a signed-in customer applies a friend's code; the DATABASE decides (attach_referral). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({ sbAuth: vi.fn(), sbAdmin: vi.fn(), syncCustomerProfile: vi.fn(), getToken: vi.fn(), tryRefresh: vi.fn(), checkRateLimit: vi.fn(), checkCsrf: vi.fn() }))
vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok: (d: unknown) => NextResponse.json(d), fail: (s: number, m: string) => NextResponse.json({ error: m }, { status: s }),
    ...mocks, applyNewCookies: (r: NextResponse) => r,
  }
})
const post = (body: unknown) => import('@/app/api/v1/referral/route').then(m => m.POST(new NextRequest('https://pahadiroots.com/api/v1/referral', {
  method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://pahadiroots.com' }, body: typeof body === 'string' ? body : JSON.stringify(body),
})))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkCsrf.mockReturnValue(null); mocks.checkRateLimit.mockReturnValue(true); mocks.getToken.mockReturnValue('jwt'); mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'u1' }); mocks.syncCustomerProfile.mockResolvedValue({ id: 58 })
  mocks.sbAdmin.mockResolvedValue({ ok: true })
})

describe('POST /api/v1/referral', () => {
  it('passes the signed-in customer\'s id and the normalised code to the database function', async () => {
    const res = await post({ code: ' ab12cd34 ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, applied: true })
    expect(mocks.sbAdmin).toHaveBeenCalledWith('POST', '/rest/v1/rpc/attach_referral', { p_referee_id: 58, p_code: 'AB12CD34' })
  })
  it('a code the database refuses is a 200 with a reason and customer wording (so the browser can drop it)', async () => {
    mocks.sbAdmin.mockResolvedValue({ ok: false, reason: 'not_new_customer' })
    const body = await (await post({ code: 'AB12CD34' })).json()
    expect(body).toMatchObject({ success: true, applied: false, reason: 'not_new_customer' })
    expect(body.message).toMatch(/before your first order/)
  })
  it('the customer id comes from the session, never from the request body', async () => {
    await post({ code: 'AB12CD34', p_referee_id: 1, customer_id: 1 })
    expect(mocks.sbAdmin.mock.calls[0][2].p_referee_id).toBe(58)
  })
  it('401 when logged out; 400 for junk code / bad JSON; 429 when rate limited', async () => {
    mocks.getToken.mockReturnValue(null); expect((await post({ code: 'AB12CD34' })).status).toBe(401)
    mocks.getToken.mockReturnValue('jwt')
    expect((await post({ code: '<script>' })).status).toBe(400)
    expect((await post('{nope')).status).toBe(400)
    mocks.checkRateLimit.mockReturnValue(false); expect((await post({ code: 'AB12CD34' })).status).toBe(429)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })
  it('a database fault is a 500 without leaking details', async () => {
    mocks.sbAdmin.mockRejectedValue(new Error('connection to server at 10.0.0.5 failed'))
    const res = await post({ code: 'AB12CD34' })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('10.0.0.5')
  })
})
