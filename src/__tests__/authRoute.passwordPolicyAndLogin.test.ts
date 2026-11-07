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

  // VERIFY ROUND (F-9): the 100 / 15 min per-ACCOUNT backstop was a read-only Upstash "peek" — with the KV env unset
  // (the live state) it always said "not blocked", so one guess per /64 was unbounded and GoTrue checked every password.
  // It is now an atomic increment BEFORE the password check on the same backend as every other limiter (KV, else Postgres).
  it('botnet backstop: 150 failed attempts for ONE e-mail from 150 distinct IPv6 /64s (no KV env) → 429 from the 101st on, GoTrue never sees them', async () => {
    fetchMock.mockResolvedValue(json(400, { msg: 'Invalid login credentials' }))
    const { POST } = await import('@/app/api/auth/route')
    const email = `victim3-${Date.now()}@example.com`
    const statuses: number[] = []
    for (let i = 0; i < 150; i++) {
      const net = `2401:4900:${(0x1000 + i).toString(16)}:${(i * 7 % 0xffff).toString(16)}`   // a different /64 every time
      statuses.push((await POST(sameIp({ action: 'email_login', email, password: 'Wrong-Pass-1!' }, `${net}::1`))).status)
    }
    expect(statuses.slice(0, 100).every(s => s === 400)).toBe(true)        // first 100: the password was checked
    expect(statuses.slice(100).every(s => s === 429)).toBe(true)           // 101st…150th: refused
    // Nov 2026 audit: the account counter now counts FAILED passwords, so the 101st failure is the one that crosses the cap
    // (answered 429); from the 102nd on the account is refused up front (peek) and GoTrue is not asked.
    expect(fetchMock).toHaveBeenCalledTimes(101)
    const last = await POST(sameIp({ action: 'email_login', email, password: 'Wrong-Pass-1!' }, '2401:4900:ffff:ffff::1'))
    expect(last.headers.get('retry-after')).toBe('900')
    expect(last.headers.get('cache-control')).toBe('private, no-store')
  })

  // Nov 2026 audit: a site's /48 is one bucket too — rotating through its 65 536 /64s buys at most 20 tries per account.
  it('per-/48 bucket: 30 attempts from 30 different /64s of ONE /48 → GoTrue sees 20, the rest are 429; another /48 is unaffected', async () => {
    fetchMock.mockResolvedValue(json(400, { msg: 'Invalid login credentials' }))
    const { POST } = await import('@/app/api/auth/route')
    const email = `victim48-${Date.now()}@example.com`
    const statuses: number[] = []
    for (let i = 0; i < 30; i++) {
      statuses.push((await POST(sameIp({ action: 'email_login', email, password: 'Wrong-Pass-1!' }, `2401:4900:abcd:${(0x100 + i).toString(16)}::1`))).status)
    }
    expect(statuses.slice(0, 20).every(s => s === 400)).toBe(true)
    expect(statuses.slice(20).every(s => s === 429)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(20)
    expect((await POST(sameIp({ action: 'email_login', email, password: 'Wrong-Pass-1!' }, '2401:4900:abce:1::1'))).status).toBe(400)
  })

  it('the account-wide cap counts only FAILED passwords: the owner logging in successfully many times is never locked out', async () => {
    const { POST } = await import('@/app/api/auth/route')
    const email = `busy-${Date.now()}@example.com`
    // With Upstash (read-only peek available) a correct password never touches the counter. (Without KV the over-cap check on
    // a correct password has to increment — only the owner can cause that; see peekOverCapByIncrement.)
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://kv.example')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 't')
    try {
      fetchMock.mockResolvedValue(json(400, { msg: 'Invalid login credentials' }))
      for (let i = 0; i < 99; i++) {   // strangers: 99 failures from 99 different sites — one short of the cap
        await POST(sameIp({ action: 'email_login', email, password: 'Wrong-Pass-1!' }, `2405:${(0x2000 + i).toString(16)}:1:1::1`))
      }
      fetchMock.mockResolvedValue(json(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u1', email } }))
      for (let i = 0; i < 5; i++) {    // the owner's own successful logins do not count (they used to: every ATTEMPT was counted)
        const res = await POST(sameIp({ action: 'email_login', email, password: 'Right-Pass-1!' }, `2406:${(0x10 + i).toString(16)}:1:1::1`))
        expect(res.status).toBe(200)
      }
    } finally {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    }
  })

  it('past the cap a CORRECT password is refused with the same 429 and its session is revoked (no oracle for guessing)', async () => {
    const { POST } = await import('@/app/api/auth/route')
    const email = `cap-${Date.now()}@example.com`
    const { rateLimitKvMock } = await import('./helpers/inMemoryRateLimit')
    rateLimitKvMock.peekRateLimitKv.mockResolvedValue(false)   // the live state: no Upstash, no read-only form
    try {
      fetchMock.mockResolvedValue(json(400, { msg: 'Invalid login credentials' }))
      for (let i = 0; i < 101; i++) {
        await POST(sameIp({ action: 'email_login', email, password: 'Wrong-Pass-1!' }, `2402:${(0x3000 + i).toString(16)}:1:1::1`))
      }
      fetchMock.mockReset()
      fetchMock.mockImplementation(async (url: string) => url.includes('/logout')
        ? json(204, {})
        : json(200, { access_token: 'stolen', refresh_token: 'r', expires_in: 3600, user: { id: 'u1', email } }))
      const res = await POST(sameIp({ action: 'email_login', email, password: 'Right-Pass-1!' }, '2402:ffff:1:1::1'))
      expect(res.status).toBe(429)
      expect(res.headers.get('set-cookie') ?? '').not.toContain('stolen')
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/logout?scope=local'))).toBe(true)
    } finally {
      rateLimitKvMock.peekRateLimitKv.mockImplementation(async () => false)
    }
  })

  // Nov 2026 verification: a network that was already blocked kept feeding the account-wide counter, so a couple of /64s
  // could lock any customer out. Now a blocked network adds nothing more to it.
  it('requests from an already-blocked network do not count toward the account-wide lockout', async () => {
    fetchMock.mockResolvedValue(json(400, { msg: 'Invalid login credentials' }))
    const { POST } = await import('@/app/api/auth/route')
    const email = `victim4-${Date.now()}@example.com`
    // Two attacker /64s each send 60 attempts paced under the per-IP 5/min route limit (spread over 15 minutes). The in-memory
    // limiter has no clock, so the per-IP route counter is treated as "window reset" — the login counters are real.
    const { rateLimitKvMock } = await import('./helpers/inMemoryRateLimit')
    const real = rateLimitKvMock.checkRateLimitKv.getMockImplementation()!
    rateLimitKvMock.checkRateLimitKv.mockImplementation(async (key: string, limit: number) =>
      key.startsWith('mw:rl:auth_email_login:') ? true : real(key, limit))
    try {
      for (const net of ['2401:4900:1:1', '2401:4900:2:2']) {
        for (let i = 0; i < 60; i++) await POST(sameIp({ action: 'email_login', email, password: 'Wrong-Pass-1!' }, `${net}::1`))
      }
    } finally {
      rateLimitKvMock.checkRateLimitKv.mockImplementation(real)
    }
    fetchMock.mockResolvedValue(json(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u1', email } }))
    const owner = await POST(sameIp({ action: 'email_login', email, password: 'Right-Pass-1!' }, '2405:201:aaaa:bbbb::1'))
    expect(owner.status).not.toBe(429)
  })
})
