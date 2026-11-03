/**
 * authRoute.passwordPolicyAndLogin.test.ts
 *
 * AUDIT ACC-029 / ACC-034 / ACC-036 (account audit, Nov 2026)
 *  • ACC-029: ONE password policy (8+ chars, upper-case, number, special) enforced SERVER-side for
 *    sign-up and change-password (the server used to check length >= 6 only).
 *  • ACC-036: a wrong CURRENT password must not be a 401 — every client treats 401 as "session
 *    expired" and signs the customer out. It is a 400 with code `wrong_current_password`.
 *  • ACC-034: besides the per-IP limiter, login is throttled per ACCOUNT (a botnet could otherwise
 *    hammer one e-mail from many addresses).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api/rateLimitKv', async () => (await import('./helpers/inMemoryRateLimit')).rateLimitKvMock)
vi.mock('@/lib/api/serverUtils', () => ({
  checkCsrf:           vi.fn(() => null),
  syncCustomerProfile: vi.fn(async () => null),
  toPublicProfile:     vi.fn((p: unknown) => p),
}))

const fetchMock = vi.fn()

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'test-service-key')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
  vi.stubGlobal('fetch', fetchMock)
})

let ipCounter = 100
function makeRequest(body: unknown, opts: { cookie?: string } = {}) {
  const headers: Record<string, string> = {
    'Content-Type':    'application/json',
    origin:            'https://pahadiroots.com',
    'x-forwarded-for': `172.16.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`,   // fresh IP each time
  }
  if (opts.cookie) headers.cookie = `pr_token=${opts.cookie}`
  return new NextRequest('https://pahadiroots.com/api/auth', { method: 'POST', headers, body: JSON.stringify(body) })
}
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })

beforeEach(() => { fetchMock.mockReset() })

const STRONG = 'Correct-Horse-9!'

describe('change_password (ACC-036, ACC-029)', () => {
  it('answers 400 `wrong_current_password` — NOT 401 — when the current password is wrong', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/v1/user')) return json(200, { id: 'u1', email: 'a@b.com' })
      if (url.includes('/token?grant_type=password')) return json(400, { msg: 'Invalid login credentials' })
      return json(500, {})
    })
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest({ action: 'change_password', current_password: 'Old-Pass-1!', new_password: STRONG }, { cookie: 'jwt' }))

    expect(res.status).toBe(400)
    expect(res.status).not.toBe(401)
    expect((await res.json()).code).toBe('wrong_current_password')
  })

  it.each(['abc', 'abcdefgh', 'Abcdefgh', 'Abcdefg1', 'abcdefg1!'])('rejects the weak new password %j without calling Supabase', async (pw) => {
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest({ action: 'change_password', current_password: 'Old-Pass-1!', new_password: pw }, { cookie: 'jwt' }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/uppercase letter, a number and a special character/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a policy-compliant new password', async () => {
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url.endsWith('/auth/v1/user')) return json(200, { id: 'u1', email: 'a@b.com' })
      if (url.includes('/token?grant_type=password')) return json(200, { access_token: 't' })
      if (url.includes('/auth/v1/admin/users/u1') && init?.method === 'PUT') return json(200, { id: 'u1' })
      return json(500, {})
    })
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest({ action: 'change_password', current_password: 'Old-Pass-1!', new_password: STRONG }, { cookie: 'jwt' }))

    expect(res.status).toBe(200)
  })
})

describe('email_signup (ACC-029)', () => {
  it.each(['123456', 'password1', 'Password1', 'password!1'])('400s for the weak password %j without creating a user', async (pw) => {
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest({ action: 'email_signup', email: 'new@user.com', password: pw, full_name: 'New User' }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/at least 8 characters/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates the user when the password meets the shared policy', async () => {
    fetchMock.mockResolvedValue(json(200, { user: { id: 'u9', email: 'new@user.com' } }))
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest({ action: 'email_signup', email: 'new@user.com', password: STRONG, full_name: 'New User' }))

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('email_login failed-attempt throttle (ACC-034, reworked in the round-2 audit)', () => {
  const sameIp = (body: unknown, ip: string) => new NextRequest('https://pahadiroots.com/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: 'https://pahadiroots.com', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })

  it('a stranger cannot lock the victim out: 10 failures from other networks do not block a login from a fresh one', async () => {
    fetchMock.mockResolvedValue(json(400, { msg: 'Invalid login credentials' }))
    const { POST } = await import('@/app/api/auth/route')
    const email = `victim-${Date.now()}@example.com`
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) {
      statuses.push((await POST(makeRequest({ action: 'email_login', email, password: 'Wrong-Pass-1!' }))).status)   // fresh IP each time
    }
    expect(statuses.every(s => s === 400)).toBe(true)                  // none was throttled
    expect(fetchMock).toHaveBeenCalledTimes(12)
  })

  it('blocks the 11th failed attempt from ONE network (the attacker only locks themselves out)', async () => {
    fetchMock.mockResolvedValue(json(400, { msg: 'Invalid login credentials' }))
    const { POST } = await import('@/app/api/auth/route')
    const email = `victim2-${Date.now()}@example.com`
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) {
      // the per-IP limiter (5/min) is a different counter; use a distinct IPv6 address inside ONE /64 for each try is not needed here:
      // keep the same address and let the account counter decide once the per-IP limiter has been passed
      statuses.push((await POST(sameIp({ action: 'email_login', email, password: 'Wrong-Pass-1!' }, `2401:4900:aaaa:bbbb:${i}::1`))).status)
    }
    expect(statuses.slice(0, 5).every(s => s === 400)).toBe(true)
    expect(statuses).toContain(429)
  })
})
