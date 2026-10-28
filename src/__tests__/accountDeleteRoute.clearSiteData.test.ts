/**
 * accountDeleteRoute.clearSiteData.test.ts
 *
 * AUDIT S2-006 — DELETE /api/account/delete erased the server-side PII but
 * the browser kept the deleted user's name/phone/email/address in
 * localStorage (pr_checkout_profile, pr-user). The success response now
 * carries `Clear-Site-Data: "storage"` so supporting browsers drop all DOM
 * storage for the origin as part of the erasure; the client additionally
 * clears the specific keys (lib/clientLogout.ts, covered in
 * clientLogout.test.ts).
 *
 * serverUtils is mocked (every DB step resolves) so this is purely about the
 * response the route hands back on the happy path, and that a FAILED deletion
 * does NOT tell the browser to clear anything.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  sbAuth:         vi.fn(),
  sbAdmin:        vi.fn(),
  getToken:       vi.fn(),
  tryRefresh:     vi.fn(),
  checkRateLimit: vi.fn(),
  checkCsrf:      vi.fn(),
}))

vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok:   (data: unknown) => NextResponse.json(data),
    fail: (status: number, msg: string, headers?: Record<string, string>) =>
      NextResponse.json({ error: msg }, { status, headers }),
    sbAuth:          mocks.sbAuth,
    sbAdmin:         mocks.sbAdmin,
    getToken:        mocks.getToken,
    tryRefresh:      mocks.tryRefresh,
    checkRateLimit:  mocks.checkRateLimit,
    checkCsrf:       mocks.checkCsrf,
    applyNewCookies: (res: NextResponse) => res,
  }
})

const fetchMock = vi.fn()

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'service')
  vi.stubEnv('RESEND_API_KEY', '')
  vi.stubGlobal('fetch', fetchMock)
})

function makeRequest() {
  return new NextRequest('https://pahadiroots.com/api/account/delete', {
    method:  'DELETE',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4', origin: 'https://pahadiroots.com' },
    body:    JSON.stringify({ confirm: 'DELETE' }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkCsrf.mockReturnValue(null)
  mocks.checkRateLimit.mockReturnValue(true)
  mocks.getToken.mockReturnValue('jwt')
  mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockResolvedValue({ id: 'auth-uuid', email: 'asha@example.com' })
  // customers lookup → one row; every other step → resolved
  mocks.sbAdmin.mockImplementation(async (_m: string, path: string) => {
    if (path.startsWith('/rest/v1/customers?auth_user_id=')) return [{ id: 42 }]
    return []
  })
  // deleteAuthUser (direct fetch to the admin API) succeeds
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' })
})

describe('DELETE /api/account/delete — browser-side PII erasure (AUDIT S2-006)', () => {
  it('tells the browser to clear DOM storage on a successful deletion', async () => {
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(makeRequest())

    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    // This is the fix: pr_checkout_profile / pr-user must not survive the account.
    expect(res.headers.get('Clear-Site-Data')).toBe('"storage"')
  })

  it('still expires both auth cookies on success', async () => {
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(makeRequest())
    const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']
    const joined = setCookies.join('\n')
    expect(joined).toMatch(/pr_token=;/)
    expect(joined).toMatch(/pr_refresh=;/)
  })

  it('does NOT send Clear-Site-Data when the deletion fails (account still exists)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' })
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(makeRequest())

    expect(res.status).toBe(500)
    expect(res.headers.get('Clear-Site-Data')).toBeNull()
  })

  it('does NOT send Clear-Site-Data to an unauthenticated caller', async () => {
    mocks.getToken.mockReturnValue(null)
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(makeRequest())

    expect(res.status).toBe(401)
    expect(res.headers.get('Clear-Site-Data')).toBeNull()
  })
})
