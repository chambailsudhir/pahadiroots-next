/**
 * accountDeleteRoute.reauthAndErasure.test.ts
 *
 * AUDIT ACC-033 (live evidence: DELETE /api/account/delete → 500 for every account;
 *   Supabase auth log: `DELETE … violates foreign key constraint "customers_auth_user_id_fkey" (23503)`)
 *   Root cause: the anonymising PATCH wrote a column that does not exist (`postal_code`; real column is
 *   `pincode`), PostgREST rejected it, `.catch(() => null)` swallowed the error, `customers.auth_user_id`
 *   stayed set and the auth-user delete hit the FK.
 *   → the anonymisation steps are now FATAL and verified, and run BEFORE the irreversible auth delete.
 * AUDIT ACC-023: deletion re-authenticates (password for email accounts, recent sign-in for Google-only).
 */
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
    fail: (status: number, msg: string, headers?: Record<string, string>) => NextResponse.json({ error: msg }, { status, headers }),
    sbAuth: mocks.sbAuth, sbAdmin: mocks.sbAdmin, getToken: mocks.getToken, tryRefresh: mocks.tryRefresh,
    checkRateLimit: mocks.checkRateLimit, checkRateLimitShared: mocks.checkRateLimitShared,
    checkCsrf: mocks.checkCsrf, applyNewCookies: (res: NextResponse) => res,
  }
})

const fetchMock = vi.fn()
beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'service')
  vi.stubEnv('RESEND_API_KEY', '')
  vi.stubGlobal('fetch', fetchMock)
})

const req = (body: Record<string, unknown> = { confirm: 'DELETE', password: 'Correct-Horse-9!' }) =>
  new NextRequest('https://pahadiroots.com/api/account/delete', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4', origin: 'https://pahadiroots.com' },
    body: JSON.stringify(body),
  })

const PASSWORD_USER = { id: 'auth-uuid', email: 'asha@example.com', app_metadata: { provider: 'email', providers: ['email'] } }
let userForTest: Record<string, unknown> = PASSWORD_USER
let passwordOk = true

const adminCalls = () => mocks.sbAdmin.mock.calls as Array<[string, string, unknown?]>
const authAdminDeleteCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/auth/v1/admin/users/'))

beforeEach(() => {
  vi.clearAllMocks()
  userForTest = PASSWORD_USER; passwordOk = true
  mocks.checkCsrf.mockReturnValue(null)
  mocks.checkRateLimit.mockReturnValue(true)
  mocks.checkRateLimitShared.mockResolvedValue(true)
  mocks.getToken.mockReturnValue('jwt')
  mocks.tryRefresh.mockResolvedValue(null)
  mocks.sbAuth.mockImplementation(async (path: string) => {
    if (path.startsWith('/token')) { if (!passwordOk) throw { status: 400, message: 'Invalid login credentials' }; return { access_token: 'x' } }
    return userForTest
  })
  mocks.sbAdmin.mockImplementation(async (m: string, path: string) => {
    if (path.startsWith('/rest/v1/customers?auth_user_id=')) return [{ id: 42 }]
    if (m === 'PATCH' && path.startsWith('/rest/v1/customers?id=')) return [{ id: 42, auth_user_id: null }]
    return []
  })
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' })
})

describe('DELETE /api/account/delete — erasure (ACC-033)', () => {
  it('anonymises with the REAL column name `pincode` (never `postal_code`) and unlinks auth_user_id', async () => {
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req())

    expect(res.status).toBe(200)
    const patch = adminCalls().find(([m, p]) => m === 'PATCH' && p.startsWith('/rest/v1/customers?id='))
    expect(patch).toBeTruthy()
    const body = patch![2] as Record<string, unknown>
    expect(body).toHaveProperty('pincode', null)
    expect(body).not.toHaveProperty('postal_code')
    expect(body).toHaveProperty('auth_user_id', null)
    expect(body).toMatchObject({ first_name: 'Deleted', phone: null, email: null, is_deleted: true })
    // the order snapshot (name, address, delivery phone) is nulled too
    expect(adminCalls().some(([m, p, b]) => m === 'PATCH' && p.startsWith('/rest/v1/orders?customer_id=eq.42') && (b as { shipping_address: null }).shipping_address === null)).toBe(true)
  })

  it('does NOT delete the login when the anonymising update fails (previously swallowed → FK 23503 → 500)', async () => {
    mocks.sbAdmin.mockImplementation(async (m: string, path: string) => {
      if (path.startsWith('/rest/v1/customers?auth_user_id=')) return [{ id: 42 }]
      if (m === 'PATCH' && path.startsWith('/rest/v1/customers?id=')) throw { status: 400, message: '{"code":"PGRST204","message":"column not found"}' }
      return []
    })
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req())

    expect(res.status).toBe(500)
    expect(authAdminDeleteCalls()).toHaveLength(0)           // irreversible step never reached
    expect(res.headers.get('Clear-Site-Data')).toBeNull()
  })

  it('does NOT delete the login when the customer row is still linked after the update', async () => {
    mocks.sbAdmin.mockImplementation(async (m: string, path: string) => {
      if (path.startsWith('/rest/v1/customers?auth_user_id=')) return [{ id: 42 }]
      if (m === 'PATCH' && path.startsWith('/rest/v1/customers?id=')) return [{ id: 42, auth_user_id: 'auth-uuid' }]
      return []
    })
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req())

    expect(res.status).toBe(500)
    expect(authAdminDeleteCalls()).toHaveLength(0)
  })

  it('aborts when the customer lookup itself fails (no silent skip of anonymisation)', async () => {
    mocks.sbAdmin.mockRejectedValue({ status: 500, message: 'db down' })
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req())

    expect(res.status).toBe(500)
    expect(authAdminDeleteCalls()).toHaveLength(0)
  })

  it('also clears wishlist, saved addresses and abandoned carts for the customer', async () => {
    const { DELETE } = await import('@/app/api/account/delete/route')
    await DELETE(req())
    for (const t of ['saved_addresses', 'wishlist', 'abandoned_carts']) {
      expect(adminCalls().some(([m, p]) => m === 'DELETE' && p === `/rest/v1/${t}?customer_id=eq.42`)).toBe(true)
    }
  })
})

describe('DELETE /api/account/delete — re-authentication (ACC-023)', () => {
  it('403 `password_required` when an email account sends no password — nothing is touched', async () => {
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req({ confirm: 'DELETE' }))

    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('password_required')
    expect(adminCalls().filter(([m]) => m !== 'GET')).toHaveLength(0)
    expect(authAdminDeleteCalls()).toHaveLength(0)
  })

  it('403 `reauth_failed` (never 401 — that would sign the user out) for a wrong password', async () => {
    passwordOk = false
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req())

    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('reauth_failed')
    expect(adminCalls().filter(([m]) => m !== 'GET')).toHaveLength(0)
  })

  it('throttles password guesses made through this endpoint (429)', async () => {
    mocks.checkRateLimitShared.mockResolvedValue(false)
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req())

    expect(res.status).toBe(429)
    expect(mocks.sbAuth).not.toHaveBeenCalledWith(expect.stringContaining('/token'), expect.anything())
  })

  it('Google-only account: 403 `reauth_required` when the last sign-in is older than 15 minutes', async () => {
    userForTest = { id: 'auth-uuid', email: 'g@example.com', app_metadata: { provider: 'google', providers: ['google'] }, last_sign_in_at: new Date(Date.now() - 60 * 60_000).toISOString() }
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req({ confirm: 'DELETE' }))

    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('reauth_required')
    expect(authAdminDeleteCalls()).toHaveLength(0)
  })

  it('Google-only account with a fresh sign-in may delete (no password involved)', async () => {
    userForTest = { id: 'auth-uuid', email: 'g@example.com', app_metadata: { provider: 'google', providers: ['google'] }, last_sign_in_at: new Date().toISOString() }
    const { DELETE } = await import('@/app/api/account/delete/route')
    const res = await DELETE(req({ confirm: 'DELETE' }))

    expect(res.status).toBe(200)
    expect(authAdminDeleteCalls()).toHaveLength(1)
  })
})
