/**
 * authRoute.authB.test.ts — audit "auth-B" fixes in POST /api/auth
 *
 *  #1 Google sign-in is PKCE and bound to the initiating browser (HttpOnly verifier cookie); tokens from the
 *     client are never accepted; the verifier is single-use.
 *  #3 per-account login counter counts FAILED logins only; reset quota is per e-mail+IP.
 *  #4 sign-up / change-password input type + length checks.
 *  #5 forgot_password answers identically for known / unknown / failing sends.
 *  #6 logout revokes the server session even when the access token has expired (refresh cookie).
 *  #2 change_password revokes the other sessions.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { resetInMemoryRateLimit } from './helpers/inMemoryRateLimit'

vi.mock('@/lib/api/rateLimitKv', async () => (await import('./helpers/inMemoryRateLimit')).rateLimitKvMock)
vi.mock('@/lib/api/serverUtils', () => ({
  checkCsrf:           vi.fn(() => null),
  syncCustomerProfile: vi.fn(async (u: { id: string }) => ({ id: 'cust-1', first_name: 'Asha', auth_user_id: u.id })),
  toPublicProfile:     vi.fn((p: unknown) => p),
}))
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: vi.fn(async () => ({ sent: true })) }))

const fetchMock = vi.fn()

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'test-service-key')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.pahadiroots.com')
  vi.stubEnv('RESEND_API_KEY', 're_test')
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
  vi.stubGlobal('fetch', fetchMock)
})

let ipCounter = 1
function makeRequest(body: unknown, opts: { cookies?: Record<string, string>; ip?: string } = {}) {
  const headers: Record<string, string> = {
    'Content-Type':    'application/json',
    origin:            'https://pahadiroots.com',
    'x-forwarded-for': opts.ip ?? `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`,
  }
  if (opts.cookies) headers.cookie = Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  return new NextRequest('https://pahadiroots.com/api/auth', { method: 'POST', headers, body: JSON.stringify(body) })
}
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })

beforeEach(() => { fetchMock.mockReset(); resetInMemoryRateLimit() })

async function post(req: NextRequest) {
  const { POST } = await import('@/app/api/auth/route')
  return POST(req)
}
const setCookie = (res: Response) => res.headers.getSetCookie()

// ─────────────────────────────────────────────────────────────────────────────
describe('google_oauth (#1) — PKCE bound to this browser', () => {
  it('returns an authorize URL with an S256 challenge and stores the matching verifier in an HttpOnly cookie', async () => {
    const res = await post(makeRequest({ action: 'google_oauth' }))
    expect(res.status).toBe(200)
    const { url } = await res.json() as { url: string }
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://example.supabase.co/auth/v1/authorize')
    expect(u.searchParams.get('provider')).toBe('google')
    expect(u.searchParams.get('redirect_to')).toBe('https://www.pahadiroots.com/auth/google-callback')
    expect(u.searchParams.get('code_challenge_method')).toBe('s256')

    const cookie = setCookie(res).find(c => c.startsWith('pr_oauth_pkce='))!
    expect(cookie).toBeTruthy()
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(cookie).toMatch(/Max-Age=600/i)
    const verifier = cookie.split(';')[0].split('=')[1]
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(u.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })

  it('uses a fresh verifier each time', async () => {
    const a = setCookie(await post(makeRequest({ action: 'google_oauth' })))[0]
    const b = setCookie(await post(makeRequest({ action: 'google_oauth' })))[0]
    expect(a).not.toBe(b)
  })
})

describe('google_callback (#1) — code is redeemed only with this browser\'s verifier', () => {
  const VERIFIER = 'v'.repeat(43)

  it('exchanges code + verifier, sets the session cookies and clears the verifier cookie', async () => {
    fetchMock.mockResolvedValue(json(200, { access_token: 'AT', refresh_token: 'RT', user: { id: 'u1', email: 'a@b.com' } }))
    const res = await post(makeRequest({ action: 'google_callback', code: 'AUTHCODE' }, { cookies: { pr_oauth_pkce: VERIFIER } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.user.id).toBe('u1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://example.supabase.co/auth/v1/token?grant_type=pkce')
    expect(JSON.parse(init.body)).toEqual({ auth_code: 'AUTHCODE', code_verifier: VERIFIER })

    const cookies = setCookie(res)
    expect(cookies.find(c => c.startsWith('pr_token=AT'))).toBeTruthy()
    expect(cookies.find(c => c.startsWith('pr_refresh=RT'))).toBeTruthy()
    expect(cookies.find(c => c.startsWith('pr_oauth_pkce=;') || /^pr_oauth_pkce=(;|$)/.test(c))).toMatch(/Max-Age=0/i)
  })

  it('REFUSES a code when this browser never started the flow (no verifier cookie) — login CSRF', async () => {
    const res = await post(makeRequest({ action: 'google_callback', code: 'ATTACKERS_CODE' }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(setCookie(res).find(c => c.startsWith('pr_token='))).toBeUndefined()
  })

  it('REFUSES client-supplied tokens (the old hash flow) — never sets a session from them', async () => {
    const res = await post(makeRequest({ action: 'google_callback', access_token: 'ATTACKER_AT', refresh_token: 'ATTACKER_RT' }, { cookies: { pr_oauth_pkce: VERIFIER } }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(setCookie(res).find(c => c.startsWith('pr_token=') && !/Max-Age=0/.test(c))).toBeUndefined()
  })

  it('ignores a junk verifier cookie and a wrong-type code', async () => {
    expect((await post(makeRequest({ action: 'google_callback', code: 'C' }, { cookies: { pr_oauth_pkce: 'x' } }))).status).toBe(400)
    expect((await post(makeRequest({ action: 'google_callback', code: { a: 1 } }, { cookies: { pr_oauth_pkce: VERIFIER } }))).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a code GoTrue rejects (wrong verifier / replay) yields 401, no session cookie, verifier cleared', async () => {
    fetchMock.mockResolvedValue(json(400, { msg: 'invalid flow state' }))
    const res = await post(makeRequest({ action: 'google_callback', code: 'C' }, { cookies: { pr_oauth_pkce: VERIFIER } }))
    expect(res.status).toBe(401)
    const cookies = setCookie(res)
    expect(cookies.find(c => c.startsWith('pr_token=') && !/Max-Age=0/.test(c))).toBeUndefined()
    expect(cookies.find(c => c.startsWith('pr_oauth_pkce='))).toMatch(/Max-Age=0/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('email_login per-account counter (#3) counts FAILED logins only', () => {
  it('successful logins never consume the account budget', async () => {
    fetchMock.mockResolvedValue(json(200, { access_token: 'AT', refresh_token: 'RT', user: { id: 'u1', email: 'a@b.com' } }))
    for (let i = 0; i < 15; i++) {
      const res = await post(makeRequest({ action: 'email_login', email: 'ok@example.com', password: 'Correct-Horse-9!' }))
      expect(res.status).toBe(200)
    }
  })

  it('upstream 5xx errors are not counted as failed logins', async () => {
    fetchMock.mockResolvedValue(json(500, { msg: 'upstream' }))
    for (let i = 0; i < 12; i++) await post(makeRequest({ action: 'email_login', email: 'five@example.com', password: 'x' }))
    fetchMock.mockResolvedValue(json(200, { access_token: 'AT', user: { id: 'u1' } }))
    expect((await post(makeRequest({ action: 'email_login', email: 'five@example.com', password: 'x' }))).status).toBe(200)
  })

  it('rejects non-string / oversized credentials with 400 before any Supabase call', async () => {
    for (const b of [
      { email: ['a@b.com'], password: 'x' },
      { email: 'a@b.com', password: { $ne: 1 } },
      { email: 'a'.repeat(250) + '@b.com', password: 'x' },
      { email: 'a@b.com', password: 'p'.repeat(1025) },
    ]) {
      expect((await post(makeRequest({ action: 'email_login', ...b }))).status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('email_signup input validation (#4)', () => {
  const STRONG = 'Correct-Horse-9!'
  it.each([
    ['non-string full_name', { full_name: { x: 1 } }],
    ['array full_name', { full_name: ['a'] }],
    ['name over 100 chars', { full_name: 'n'.repeat(101) }],
    ['non-string email', { email: 42 }],
    ['email over 254 chars', { email: 'a'.repeat(250) + '@b.com' }],
    ['malformed email', { email: 'not-an-email' }],
    ['password over 128 chars', { password: 'Aa1!' + 'x'.repeat(125) }],
    ['non-string password', { password: 12345678 }],
  ])('400s on %s without calling Supabase', async (_label, patch) => {
    const res = await post(makeRequest({ action: 'email_signup', email: 'new@example.com', password: STRONG, full_name: 'Asha', ...patch }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('trims the name/e-mail it forwards', async () => {
    fetchMock.mockResolvedValue(json(200, { user: { id: 'u9', email: 'new@example.com' } }))
    const res = await post(makeRequest({ action: 'email_signup', email: '  new@example.com ', password: STRONG, full_name: '  Asha Negi ' }))
    expect(res.status).toBe(200)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'new@example.com', password: STRONG, data: { full_name: 'Asha Negi' } })
  })
})

describe('change_password (#4, #2)', () => {
  const STRONG = 'Correct-Horse-9!'
  it('rejects non-string / oversized passwords before Supabase', async () => {
    for (const b of [
      { current_password: { a: 1 }, new_password: STRONG },
      { current_password: 'Old-Pass-1!', new_password: ['x'] },
      { current_password: 'Old-Pass-1!', new_password: 'Aa1!' + 'x'.repeat(125) },
    ]) {
      expect((await post(makeRequest({ action: 'change_password', ...b }, { cookies: { pr_token: 'jwt' } }))).status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('revokes the OTHER sessions after a successful change', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/v1/user')) return json(200, { id: 'u1', email: 'a@b.com' })
      return json(200, {})
    })
    const res = await post(makeRequest({ action: 'change_password', current_password: 'Old-Pass-1!', new_password: STRONG }, { cookies: { pr_token: 'jwt' } }))
    expect(res.status).toBe(200)
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls.some(u => u.endsWith('/auth/v1/logout?scope=others'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('forgot_password (#5, #3)', () => {
  it('answers the same for a registered address, an unknown address and a Resend failure', async () => {
    const answers: Array<{ status: number; body: unknown }> = []
    const run = async (email: string) => {
      const res = await post(makeRequest({ action: 'forgot_password', email }))
      answers.push({ status: res.status, body: await res.json() })
    }
    // registered + sent
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('generate_link')) return json(200, { action_link: 'https://x/verify?token=t' })
      return json(200, {})
    })
    await run('known@example.com')
    // unknown address
    fetchMock.mockImplementation(async () => json(404, { msg: 'User not found' }))
    await run('nobody@example.com')
    // registered but Resend fails
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('generate_link')) return json(200, { action_link: 'https://x/verify?token=t' })
      return json(500, {})
    })
    await run('resendfail@example.com')

    expect(answers[0].status).toBe(200)
    expect(new Set(answers.map(a => JSON.stringify(a))).size).toBe(1)
  })

  it('rejects a non-string / malformed e-mail with 400', async () => {
    for (const email of [undefined, ['a@b.com'], 'nope', 'a'.repeat(260) + '@b.com']) {
      expect((await post(makeRequest({ action: 'forgot_password', email }))).status).toBe(400)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('logout (#6) revokes the server session even after the access token expired', () => {
  it('with only the refresh cookie: refreshes, then logs out with the fresh token', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('grant_type=refresh_token')) return json(200, { access_token: 'FRESH', refresh_token: 'RT2' })
      return json(204, {})
    })
    const res = await post(makeRequest({ action: 'logout' }, { cookies: { pr_refresh: 'RT' } }))
    expect(res.status).toBe(200)
    const calls = fetchMock.mock.calls.map(c => ({ url: String(c[0]), auth: c[1].headers.Authorization }))
    expect(calls[0].url).toContain('grant_type=refresh_token')
    expect(calls[1].url).toBe('https://example.supabase.co/auth/v1/logout?scope=local')
    expect(calls[1].auth).toBe('Bearer FRESH')
    expect(setCookie(res).filter(c => /Max-Age=0/i.test(c)).length).toBeGreaterThanOrEqual(2)
  })

  it('when the access token is rejected (401) it falls back to the refresh token', async () => {
    fetchMock.mockImplementation(async (url: string, init: { headers: Record<string, string> }) => {
      if (url.includes('grant_type=refresh_token')) return json(200, { access_token: 'FRESH' })
      if (url.endsWith('/logout?scope=local') && init.headers.Authorization === 'Bearer STALE') return json(401, { msg: 'expired' })
      return json(204, {})
    })
    const res = await post(makeRequest({ action: 'logout' }, { cookies: { pr_token: 'STALE', pr_refresh: 'RT' } }))
    expect(res.status).toBe(200)
    const last = fetchMock.mock.calls.at(-1)!
    expect(String(last[0])).toBe('https://example.supabase.co/auth/v1/logout?scope=local')
    expect(last[1].headers.Authorization).toBe('Bearer FRESH')
  })

  it('a valid access token logs out directly (no refresh round trip)', async () => {
    fetchMock.mockResolvedValue(json(204, {}))
    await post(makeRequest({ action: 'logout' }, { cookies: { pr_token: 'GOOD', pr_refresh: 'RT' } }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still clears the cookies when nothing can be revoked', async () => {
    fetchMock.mockRejectedValue(new Error('network'))
    const res = await post(makeRequest({ action: 'logout' }, { cookies: { pr_refresh: 'RT' } }))
    expect(res.status).toBe(200)
    expect(setCookie(res).filter(c => /Max-Age=0/i.test(c)).length).toBeGreaterThanOrEqual(2)
  })
})
