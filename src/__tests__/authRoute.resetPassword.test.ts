/**
 * authRoute.resetPassword.test.ts
 *
 * AUDIT S2-001 / S2-009 — POST /api/auth
 *
 *  • reset_password must prefer the recovery bearer token (Authorization
 *    header) over the pr_token session cookie. Before the fix the cookie won,
 *    so a browser already signed in as user A that opened B's recovery link
 *    reset A's password.
 *  • reset_password enforces the 8-character policy (was 6).
 *  • The unused identity-mutating actions flagged in S2-009 (link_email,
 *    link_phone, update_profile, send_otp, verify_otp) answer 410 and never
 *    reach Supabase. create_return (kept — pinned by auditR2Storefront SF-2)
 *    no longer stores the client-chosen customer_name / order_number.
 *
 * Supabase is replaced by a global fetch mock; serverUtils is mocked so no
 * CSRF/origin plumbing is needed.
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


// A GoTrue-shaped access token (header.payload.sig) with the given `amr` methods. GoTrue verifies the
// signature on PUT /user; the route only needs to read the claim.
function jwt(methods: string[]) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', amr: methods.map(m => ({ method: m, timestamp: 1 })) })}.sig`
}
const RECOVERY = jwt(['recovery'])
const LOGIN    = jwt(['password'])

let ipCounter = 0
function makeRequest(body: unknown, opts: { bearer?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = {
    'Content-Type':    'application/json',
    'origin':          'https://pahadiroots.com',
    // Fresh IP per request so the in-process rate limiter never trips across tests.
    'x-forwarded-for': `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`,
  }
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`
  if (opts.cookie) headers['cookie'] = `pr_token=${opts.cookie}`
  return new NextRequest('https://pahadiroots.com/api/auth', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function supabaseOk(body: unknown = { id: 'u1' }) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('POST /api/auth reset_password — token precedence (AUDIT S2-001)', () => {
  it('uses the Authorization bearer even when a pr_token session cookie is present', async () => {
    fetchMock.mockResolvedValue(supabaseOk())
    const { POST } = await import('@/app/api/auth/route')

    const res = await POST(makeRequest(
      { action: 'reset_password', password: 'Correct-Horse-9!' },
      { bearer: RECOVERY, cookie: 'SESSION_TOKEN_OF_A' },
    ))

    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://example.supabase.co/auth/v1/user')
    expect(init.method).toBe('PUT')
    // This is the bug: before the fix this header carried SESSION_TOKEN_OF_A.
    expect(init.headers.Authorization).toBe(`Bearer ${RECOVERY}`)
    expect(JSON.parse(init.body)).toEqual({ password: 'Correct-Horse-9!' })
  })

  it('REFUSES a session cookie (no fallback any more) — a live login session cannot set a password (auth-B #2)', async () => {
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest(
      { action: 'reset_password', password: 'Correct-Horse-9!' },
      { cookie: LOGIN },
    ))
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('REFUSES a bearer that is an ordinary login session (amr=password / oauth), without calling Supabase', async () => {
    const { POST } = await import('@/app/api/auth/route')
    for (const t of [LOGIN, jwt(['oauth']), 'not-a-jwt', jwt([])]) {
      const res = await POST(makeRequest({ action: 'reset_password', password: 'Correct-Horse-9!' }, { bearer: t }))
      expect(res.status).toBe(401)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a recovery session and then revokes all sessions of the account', async () => {
    fetchMock.mockResolvedValue(supabaseOk())
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest({ action: 'reset_password', password: 'Correct-Horse-9!' }, { bearer: RECOVERY }))
    expect(res.status).toBe(200)
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls[0]).toBe('https://example.supabase.co/auth/v1/user')
    expect(urls[1]).toBe('https://example.supabase.co/auth/v1/logout?scope=global')
  })

  it('401s with no token at all, without calling Supabase', async () => {
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest({ action: 'reset_password', password: 'Correct-Horse-9!' }))
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a Supabase rejection (expired link) as a 4xx, not a success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 401,
      json: async () => ({ msg: 'Token has expired' }),
      text: async () => '{"msg":"Token has expired"}',
    })
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest(
      { action: 'reset_password', password: 'Correct-Horse-9!' }, { bearer: RECOVERY },
    ))
    expect(res.status).toBe(401)
    expect((await res.json()).success).toBeUndefined()
  })
})

describe('POST /api/auth reset_password — password policy (AUDIT S2-001)', () => {
  it.each(['', 'short', '1234567'])('400s for %j (fewer than 8 characters) without calling Supabase', async (pw) => {
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest({ action: 'reset_password', password: pw }, { bearer: RECOVERY }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/at least 8 characters/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts exactly 8 characters when they satisfy the shared policy', async () => {
    fetchMock.mockResolvedValue(supabaseOk())
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest({ action: 'reset_password', password: 'Abcdef1!' }, { bearer: RECOVERY }))
    expect(res.status).toBe(200)
  })

  // AUDIT ACC-029: the server now enforces the same policy as sign-up and Change Password.
  it.each(['12345678', 'abcdefgh', 'Abcdefgh1', 'abcdefg1!'])('400s for %j (meets the length floor but not the shared policy)', async (pw) => {
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest({ action: 'reset_password', password: pw }, { bearer: RECOVERY }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/uppercase letter, a number and a special character/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('400s for a non-string password (e.g. an array) without calling Supabase', async () => {
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest({ action: 'reset_password', password: ['a', 'b'] }, { bearer: RECOVERY }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('400s for an absurdly long password', async () => {
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest({ action: 'reset_password', password: 'x'.repeat(129) }, { bearer: RECOVERY }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth — unused identity-mutating actions are disabled (AUDIT S2-009)', () => {
  it.each([
    ['link_email',     { email: 'victim@example.com', password: 'attacker-pw-123' }],
    ['link_phone',     { phone: '9876543210' }],
    ['update_profile', { first_name: '<script>' }],
    ['send_otp',       { phone: '9876543210' }],
    ['verify_otp',     { phone: '9876543210', token: '123456' }],
  ])('%s answers 410 and never touches Supabase, even with a valid session', async (action, extra) => {
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest({ action, ...extra }, { cookie: 'SESSION', bearer: 'SESSION' }))
    expect(res.status).toBe(410)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the route source no longer contains the admin-API email/phone rewrite', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const src = readFileSync(path.resolve(__dirname, '../app/api/auth/route.ts'), 'utf8')
    // link_email used to PUT { email, password } to /auth/v1/admin/users/<id>
    expect(src).not.toMatch(/admin\/users\/\$\{user\.id\}`,\s*\{\s*email,\s*password\s*\}/)
    expect(src).not.toMatch(/admin\/users\/\$\{user\.id\}`,\s*\{\s*phone:/)
  })

  it('create_return stores the server-known order_number and profile name, not client-supplied display data', async () => {
    const { syncCustomerProfile } = await import('@/lib/api/serverUtils')
    ;(syncCustomerProfile as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 42, first_name: 'Asha', last_name: 'Negi' })
    let inserted: Record<string, unknown> | null = null
    const json = (d: unknown) => ({ ok: true, status: 200, json: async () => d, text: async () => JSON.stringify(d) })
    fetchMock.mockImplementation(async (u: string, o: { method?: string; body?: string } = {}) => {
      const url = String(u), m = (o.method || 'GET').toUpperCase()
      if (url.includes('/auth/v1/user')) return json({ id: 'u1' })
      if (m === 'GET' && url.includes('/rest/v1/orders?')) return json([{ id: 7, order_status: 'delivered', order_number: 'PR-REAL-7', total_amount: 100, delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() }])
      if (m === 'GET') return json([])
      if (m === 'POST' && url.includes('/rest/v1/returns')) { inserted = JSON.parse(o.body || '{}'); return json([{ id: 'r1' }]) }
      return json([])
    })
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(makeRequest(
      { action: 'create_return', order_id: 7, reason: 'damaged', order_number: 'PR-SPOOFED', customer_name: 'Admin <script>' },
      { cookie: 'tok' },
    ))
    expect(res.status).toBeLessThan(300)
    expect(inserted).not.toBeNull()
    // S2-009: spoofable display fields are ignored in favour of server-known values
    expect(inserted!.order_number).toBe('PR-REAL-7')
    expect(inserted!.customer_name).toBe('Asha Negi')
    expect(inserted!.refund_amount).toBeNull()
  })
})
