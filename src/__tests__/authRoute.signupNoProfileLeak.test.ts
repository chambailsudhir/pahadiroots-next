/**
 * Account audit, Nov 2026 — reproduced on production with a test account: POST /api/auth {action:'email_signup', email:<existing customer>}
 * returned that customer's name, phone, address, loyalty coins and wishlist to an ANONYMOUS caller. Sign-up must never return or touch a customer row unless Supabase gave a session.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ syncCustomerProfile: vi.fn() }))
vi.mock('@/lib/api/serverUtils', () => ({
  checkCsrf: vi.fn(() => null), syncCustomerProfile: mocks.syncCustomerProfile, toPublicProfile: vi.fn((p: unknown) => p),
}))
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: vi.fn() }))

const fetchMock = vi.fn()
beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_KEY', 'k'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'a')
  vi.stubEnv('UPSTASH_REDIS_REST_URL', ''); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', ''); vi.stubGlobal('fetch', fetchMock)
})
let ip = 100
const post = async (email = 'victim@example.com') => {
  const { POST } = await import('@/app/api/auth/route')
  return POST(new NextRequest('https://pahadiroots.com/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://pahadiroots.com', 'x-forwarded-for': `198.51.100.${ip++}` },
    body: JSON.stringify({ action: 'email_signup', email, password: 'Correct-Horse-9!', full_name: 'Probe' }),
  }))
}
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })

beforeEach(() => { fetchMock.mockReset(); vi.clearAllMocks(); mocks.syncCustomerProfile.mockResolvedValue({ id: 58, first_name: 'Victim', phone: '9111111111', address_line1: 'Secret Lane', loyalty_points: 500 }) })

describe('POST /api/auth email_signup', () => {
  it('an existing address (Supabase returns an obfuscated user, no session): no customer row is read or changed and nothing about the account is returned', async () => {
    fetchMock.mockResolvedValue(json(200, { user: { id: 'obfuscated-random-id', email: 'victim@example.com' } }))
    const res = await post()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, verification_sent: true })
    expect(JSON.stringify(body)).not.toMatch(/Victim|9111111111|Secret Lane|500/)
    expect(mocks.syncCustomerProfile).not.toHaveBeenCalled()
  })
  it('a brand-new address gets the identical answer (no way to tell existing from new)', async () => {
    fetchMock.mockResolvedValue(json(200, { user: { id: 'u-new', email: 'new@example.com' } }))
    expect(await (await post('new@example.com')).json()).toEqual({ success: true, verification_sent: true })
  })
  it('when Supabase DOES return a session (e-mail confirmation switched off) the caller really is signed in: profile + cookies, as before', async () => {
    fetchMock.mockResolvedValue(json(200, { access_token: 'at', refresh_token: 'rt', user: { id: 'u-new', email: 'new@example.com', email_confirmed_at: 'x' } }))
    const res = await post('new@example.com')
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.profile).toBeTruthy()
    expect(mocks.syncCustomerProfile).toHaveBeenCalled()
    expect(res.headers.get('set-cookie') ?? '').toMatch(/pr_token|pr_refresh|token/i)
  })
})
