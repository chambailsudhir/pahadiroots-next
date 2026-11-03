/** Changing (or clearing) the phone drops phone_verified_at; re-saving the same number keeps it; pre-migration rows are untouched. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  sbAuth: vi.fn(), sbAdmin: vi.fn(), syncCustomerProfile: vi.fn(),
  getToken: vi.fn(), tryRefresh: vi.fn(), checkRateLimit: vi.fn(), checkRateLimitShared: vi.fn(), checkCsrf: vi.fn(),
}))
vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok: (d: unknown) => NextResponse.json(d),
    fail: (status: number, msg: string) => NextResponse.json({ error: msg }, { status }),
    sbAuth: mocks.sbAuth, sbAdmin: mocks.sbAdmin, syncCustomerProfile: mocks.syncCustomerProfile,
    getToken: mocks.getToken, tryRefresh: mocks.tryRefresh, checkRateLimit: mocks.checkRateLimit, checkRateLimitShared: mocks.checkRateLimitShared, checkCsrf: mocks.checkCsrf,
    applyNewCookies: (r: NextResponse) => r, toPublicProfile: (p: unknown) => p,
  }
})

const post = (body: unknown) => import('@/app/api/profile/route').then(({ POST }) =>
  POST(new NextRequest('https://pahadiroots.com/api/profile', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '9.9.9.9', origin: 'https://pahadiroots.com' },
    body: JSON.stringify(body),
  })))
const patchBody = () => (mocks.sbAdmin.mock.calls.find(([m, p]) => m === 'PATCH' && String(p).startsWith('/rest/v1/customers?id=')) as [string, string, Record<string, unknown>] | undefined)?.[2]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkCsrf.mockReturnValue(null); mocks.checkRateLimit.mockReturnValue(true); mocks.checkRateLimitShared.mockResolvedValue(true)
  mocks.getToken.mockReturnValue('jwt'); mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'u1' }); mocks.sbAdmin.mockResolvedValue([])
})

describe('POST /api/profile — phone_verified_at', () => {
  it('clears the proof when the number changes', async () => {
    mocks.syncCustomerProfile.mockResolvedValue({ id: 5, phone: '9876543210', phone_verified_at: '2026-11-01T00:00:00Z' })
    expect((await post({ phone: '9876543211' })).status).toBe(200)
    expect(patchBody()).toMatchObject({ phone: '9876543211', phone_verified_at: null })
  })
  it('clears the proof when the number is removed', async () => {
    mocks.syncCustomerProfile.mockResolvedValue({ id: 5, phone: '9876543210', phone_verified_at: '2026-11-01T00:00:00Z' })
    await post({ phone: '' })
    expect(patchBody()).toMatchObject({ phone: null, phone_verified_at: null })
  })
  it('keeps the proof when the same number is saved again (any formatting)', async () => {
    mocks.syncCustomerProfile.mockResolvedValue({ id: 5, phone: '+919876543210', phone_verified_at: '2026-11-01T00:00:00Z' })
    await post({ phone: '98765 43210' })
    expect(patchBody()).not.toHaveProperty('phone_verified_at')
  })
  it('does not write the column at all when no proof is held / column absent (pre-migration safe)', async () => {
    mocks.syncCustomerProfile.mockResolvedValue({ id: 5, phone: '9876543210' })
    await post({ phone: '9876543211' })
    expect(patchBody()).not.toHaveProperty('phone_verified_at')
  })
})
