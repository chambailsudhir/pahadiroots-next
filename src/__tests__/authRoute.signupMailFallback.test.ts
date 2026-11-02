/**
 * authRoute.signupMailFallback.test.ts
 *
 * AUDIT ACC-025 — live evidence: every e-mail sign-up answered HTTP 500 "Error sending confirmation email"
 * (Supabase Auth log: SMTP `535 Authentication credentials invalid`) and the user was rolled back.
 * Password reset already bypasses Supabase's mailer (generate_link + our own Resend sender). Sign-up now does
 * the same, but ONLY when Supabase reports it could not send its own mail.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ sendTransactionalEmail: vi.fn(), syncCustomerProfile: vi.fn() }))
vi.mock('@/lib/api/serverUtils', () => ({
  checkCsrf:           vi.fn(() => null),
  syncCustomerProfile: mocks.syncCustomerProfile,
  toPublicProfile:     vi.fn((p: unknown) => p),
}))
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: mocks.sendTransactionalEmail }))

const fetchMock = vi.fn()
beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_KEY', 'test-service-key')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
  vi.stubGlobal('fetch', fetchMock)
})

let ip = 1
const req = (body: unknown) => new NextRequest('https://pahadiroots.com/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', origin: 'https://pahadiroots.com', 'x-forwarded-for': `192.0.2.${ip++}` },
  body: JSON.stringify(body),
})
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })
const SIGNUP = { action: 'email_signup', email: 'new@user.com', password: 'Correct-Horse-9!', full_name: 'Asha Rana' }

let smtpBroken = true
let generateLink: () => ReturnType<typeof json>
const urls = () => fetchMock.mock.calls.map(c => String(c[0]))

beforeEach(() => {
  fetchMock.mockReset(); vi.clearAllMocks()
  smtpBroken = true
  generateLink = () => json(200, { id: 'u-new', email: 'new@user.com', action_link: 'https://example.supabase.co/auth/v1/verify?token=abc&type=signup' })
  mocks.syncCustomerProfile.mockResolvedValue({ id: 70 })
  mocks.sendTransactionalEmail.mockResolvedValue({ sent: true })
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/auth/v1/signup')) return smtpBroken ? json(500, { msg: 'Error sending confirmation email' }) : json(200, { user: { id: 'u-ok', email: 'new@user.com' } })
    if (url.endsWith('/auth/v1/admin/generate_link')) return generateLink()
    return json(404, {})
  })
})

describe('email_signup — mail fallback (ACC-025)', () => {
  it('when Supabase cannot send its mail: creates the user via generate_link and sends the verification through our mailer', async () => {
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(req(SIGNUP))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, verification_sent: true })   // nothing about any account is returned

    const gen = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/admin/generate_link'))!
    expect(JSON.parse(gen[1].body)).toMatchObject({ type: 'signup', email: 'new@user.com', password: 'Correct-Horse-9!', data: { full_name: 'Asha Rana' } })
    expect(JSON.parse(gen[1].body).redirect_to).toMatch(/\/account\?verified=1$/)

    const mail = mocks.sendTransactionalEmail.mock.calls[0][0]
    expect(mail).toMatchObject({ type: 'signup_verification', to: 'new@user.com' })
    expect(mail.html).toContain('https://example.supabase.co/auth/v1/verify?token=abc&type=signup')
    expect(mocks.syncCustomerProfile).not.toHaveBeenCalled()      // the address is unproven: no customer row is touched at sign-up
  })

  it('a healthy Supabase mailer is used exactly as before — the fallback never fires', async () => {
    smtpBroken = false
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(req(SIGNUP))

    expect(res.status).toBe(200)
    expect(urls().some(u => u.endsWith('/admin/generate_link'))).toBe(false)
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled()
  })

  it('does NOT fall back for unrelated failures (e.g. weak-password rejection from Supabase)', async () => {
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/auth/v1/signup') ? json(422, { msg: 'Password is too weak' }) : json(404, {}))
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(req(SIGNUP))

    expect(res.status).toBe(422)
    expect(urls().some(u => u.endsWith('/admin/generate_link'))).toBe(false)
  })

  it('an already-registered address gets the normal "already exists" message, no mail', async () => {
    generateLink = () => json(422, { msg: 'A user with this email address has already been registered', error_code: 'email_exists' })
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(req(SIGNUP))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already exists/i)
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled()
  })

  it('503 with a friendly message when the verification mail can neither be sent nor queued', async () => {
    mocks.sendTransactionalEmail.mockResolvedValue({ sent: false, error: 'resend down' })
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(req(SIGNUP))

    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/could not send the verification e-mail/i)
  })

  it('succeeds when the mail was dead-lettered for retry (the retry sweep delivers it)', async () => {
    mocks.sendTransactionalEmail.mockResolvedValue({ sent: false, deadLettered: true })
    const { POST } = await import('@/app/api/auth/route')
    expect((await POST(req(SIGNUP))).status).toBe(200)
  })

  it('503 (not a raw 500) when generate_link itself fails', async () => {
    generateLink = () => json(500, { msg: 'boom' })
    const { POST } = await import('@/app/api/auth/route')
    expect((await POST(req(SIGNUP))).status).toBe(503)
  })

  it('escapes the name in the e-mail and the weak-password policy still applies before any of this', async () => {
    const { POST } = await import('@/app/api/auth/route')
    await POST(req({ ...SIGNUP, full_name: '<img src=x onerror=alert(1)> Asha' }))
    expect(mocks.sendTransactionalEmail.mock.calls[0][0].html).not.toContain('<img src=x')

    fetchMock.mockClear()
    const weak = await POST(req({ ...SIGNUP, password: 'password1' }))
    expect(weak.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
