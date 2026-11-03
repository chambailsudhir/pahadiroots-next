/** /api/v1/phone-verify/{start,status,enabled}: feature flag, CSRF, auth, rate limit, validation, code storage. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  sbAuth: vi.fn(), sbAdmin: vi.fn(), syncCustomerProfile: vi.fn(), getToken: vi.fn(), tryRefresh: vi.fn(),
  checkRateLimitShared: vi.fn(), checkCsrf: vi.fn(),
}))
vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok: (d: unknown) => NextResponse.json(d),
    fail: (status: number, msg: string) => NextResponse.json({ error: msg }, { status }),
    sbAuth: mocks.sbAuth, sbAdmin: mocks.sbAdmin, syncCustomerProfile: mocks.syncCustomerProfile, getToken: mocks.getToken,
    tryRefresh: mocks.tryRefresh, applyNewCookies: (r: NextResponse) => r, checkRateLimitShared: mocks.checkRateLimitShared, checkCsrf: mocks.checkCsrf,
  }
})

let lib: typeof import('@/lib/server/phoneVerification')
const req = (path: string, method: 'GET' | 'POST', body?: unknown) =>
  new NextRequest('https://pahadiroots.com' + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', origin: 'https://pahadiroots.com' } })
const start = (body: unknown) => import('@/app/api/v1/phone-verify/start/route').then(m => m.POST(req('/api/v1/phone-verify/start', 'POST', body)))
const status = () => import('@/app/api/v1/phone-verify/status/route').then(m => m.GET(req('/api/v1/phone-verify/status', 'GET')))
const enabled = () => import('@/app/api/v1/phone-verify/enabled/route').then(m => m.GET())

beforeEach(async () => {
  vi.clearAllMocks(); vi.resetModules()
  process.env.WHATSAPP_VERIFY_NUMBER = '+91 98000 00000'
  process.env.WHATSAPP_APP_SECRET = 's'; process.env.WHATSAPP_VERIFY_TOKEN = 't'
  lib = await import('@/lib/server/phoneVerification'); lib._resetPhoneVerificationFlagCache()
  mocks.checkCsrf.mockReturnValue(null); mocks.checkRateLimitShared.mockResolvedValue(true)
  mocks.getToken.mockReturnValue('jwt'); mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'u1' })
  mocks.syncCustomerProfile.mockResolvedValue({ id: 7, phone: '9876543210', phone_verified_at: null })
  mocks.sbAdmin.mockImplementation(async () => [])
})

describe('feature flag', () => {
  it('404 on start and status, enabled:false, when env vars are missing (and no DB is touched)', async () => {
    delete process.env.WHATSAPP_VERIFY_TOKEN
    expect((await start({ phone: '9876543210' })).status).toBe(404)
    expect((await status()).status).toBe(404)
    expect(await (await enabled()).json()).toEqual({ enabled: false })
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })
  it('404 when site_settings.phone_verification_enabled is "false"', async () => {
    mocks.sbAdmin.mockImplementation(async (_m: string, p: string) => (p.includes('site_settings') ? [{ value: 'false' }] : []))
    expect((await start({ phone: '9876543210' })).status).toBe(404)
    expect(await (await enabled()).json()).toEqual({ enabled: false })
  })
  it('on when env is complete and the setting is absent', async () => {
    expect(await (await enabled()).json()).toEqual({ enabled: true })
    expect(await lib.isPhoneVerificationEnabled()).toBe(true)
  })
})

describe('POST start', () => {
  it('stores only a hash, burns older codes, returns the wa.me link', async () => {
    const res = await start({ phone: '+91 98765 43210' })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.code).toMatch(/^\d{6}$/)
    expect(j.expiresInSeconds).toBe(600)
    expect(j.whatsappUrl).toBe(`https://wa.me/919800000000?text=${encodeURIComponent('VERIFY ' + j.code)}`)
    const calls = mocks.sbAdmin.mock.calls.filter(c => String(c[1]).includes('phone_verifications'))
    expect(calls[0][0]).toBe('PATCH')
    expect(String(calls[0][1])).toContain('customer_id=eq.7&consumed_at=is.null')
    expect(calls[1][0]).toBe('POST')
    const ins = calls[1][2]
    expect(ins).toMatchObject({ customer_id: 7, phone10: '9876543210', code_hash: lib.hashCode(j.code, '9876543210') })
    expect(JSON.stringify(ins)).not.toContain(j.code)
    const ttl = new Date(ins.expires_at).getTime() - Date.now()
    expect(ttl).toBeGreaterThan(590_000)
    expect(ttl).toBeLessThanOrEqual(600_000)
  })
  it.each(['12345', '5876543210', 'abcdefghij', ''])('rejects %j as a mobile number', async (phone) => {
    expect((await start({ phone })).status).toBe(400)
    expect(mocks.sbAdmin.mock.calls.some(c => c[0] === 'POST')).toBe(false)
  })
  it('400 for a non-string phone and invalid JSON', async () => {
    expect((await start({ phone: 9876543210 })).status).toBe(400)
    const { POST } = await import('@/app/api/v1/phone-verify/start/route')
    expect((await POST(new NextRequest('https://pahadiroots.com/api/v1/phone-verify/start', { method: 'POST', body: '{', headers: { origin: 'https://pahadiroots.com' } }))).status).toBe(400)
  })
  it('429 when the shared limiter says no (5 per hour per customer)', async () => {
    mocks.checkRateLimitShared.mockResolvedValue(false)
    const res = await start({ phone: '9876543210' })
    expect(res.status).toBe(429)
    expect(mocks.checkRateLimitShared).toHaveBeenCalledWith('phone_verify_start:7', 5, 3_600_000)
  })
  it('403 on CSRF failure, 401 when logged out', async () => {
    mocks.checkCsrf.mockReturnValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await start({ phone: '9876543210' })).status).toBe(403)
    mocks.checkCsrf.mockReturnValue(null); mocks.getToken.mockReturnValue(null)
    expect((await start({ phone: '9876543210' })).status).toBe(401)
  })
})

describe('GET status', () => {
  it('verified + phone', async () => {
    mocks.syncCustomerProfile.mockResolvedValue({ id: 7, phone: '9876543210', phone_verified_at: '2026-11-01T00:00:00Z' })
    expect(await (await status()).json()).toEqual({ verified: true, phone: '9876543210', pending: false })
  })
  it('pending when an open code exists', async () => {
    mocks.sbAdmin.mockImplementation(async (_m: string, p: string) => (p.includes('phone_verifications') ? [{ id: 1 }] : []))
    expect(await (await status()).json()).toEqual({ verified: false, phone: '9876543210', pending: true })
  })
  it('not verified when the phone was cleared', async () => {
    mocks.syncCustomerProfile.mockResolvedValue({ id: 7, phone: null, phone_verified_at: '2026-11-01T00:00:00Z' })
    expect((await (await status()).json()).verified).toBe(false)
  })
  it('401 when logged out', async () => {
    mocks.getToken.mockReturnValue(null)
    expect((await status()).status).toBe(401)
  })
})
