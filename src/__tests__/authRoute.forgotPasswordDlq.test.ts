/**
 * authRoute.forgotPasswordDlq.test.ts
 *
 * Nov 2026 e-mail verification, finding G: the password-reset mail was POSTed to Resend directly from the route and a failure was
 * only logged — the customer waited for a mail that never came, with no retry and no record. It now goes through
 * sendTransactionalEmail (type `password_reset`): inline retry, then a failed_emails row the cron sweep re-sends. The response
 * stays the neutral generic answer either way (auth-B #5).
 *
 * Resend and Supabase are mocked at module level — the REAL sendTransactionalEmail runs.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { NextRequest } from 'next/server'

const mockSend = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function () { return { emails: { send: mockSend } } }),
}))
const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
vi.mock('@/lib/supabase', () => ({
  supabase: {},
  getServiceClient: () => ({
    from: (table: string) => ({ insert: (payload: Record<string, unknown>) => { inserts.push({ table, payload }); return Promise.resolve({ data: null, error: null }) } }),
  }),
}))
vi.mock('@/lib/getSiteSettings', () => ({ getSiteSettings: vi.fn(async () => ({})) }))
const mockCaptureError = vi.fn()
vi.mock('@/lib/logger', () => ({ captureError: (...a: unknown[]) => mockCaptureError(...a), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), metric: vi.fn() } }))
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
  vi.stubEnv('RESEND_API_KEY', 're_test')
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
  vi.stubGlobal('fetch', fetchMock)
})

let ip = 1
const req = (email: string) => new NextRequest('https://pahadiroots.com/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', origin: 'https://pahadiroots.com', 'x-forwarded-for': `203.0.113.${ip++}` },
  body: JSON.stringify({ action: 'forgot_password', email }),
})
const LINK = 'https://example.supabase.co/auth/v1/verify?token=rec-123&type=recovery&redirect_to=https://www.pahadiroots.com/reset-password'

beforeEach(() => {
  fetchMock.mockReset(); mockSend.mockReset(); mockCaptureError.mockReset(); inserts.length = 0
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes('/auth/v1/admin/generate_link')) return { ok: true, status: 200, text: async () => JSON.stringify({ action_link: LINK }) }
    throw new Error('unexpected fetch ' + url)
  })
})

describe('forgot_password — mail goes through the retry / dead-letter path (finding G)', () => {
  it('sends a password_reset mail via sendTransactionalEmail (Resend SDK), branded, with the recovery link as the button', async () => {
    mockSend.mockResolvedValue({ data: { id: 'e1' }, error: null })
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(req('known@example.com'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, message: 'If that email is registered, a reset link has been sent.' })

    expect(mockSend).toHaveBeenCalledTimes(1)
    const sent = mockSend.mock.calls[0][0]
    expect(sent.to).toEqual(['known@example.com'])
    expect(sent.subject).toMatch(/Reset Your Password/)
    expect(sent.html).toContain('>Reset password</a>')
    expect(sent.html).toContain('href="https://example.supabase.co/auth/v1/verify?token=rec-123&amp;type=recovery')
    expect(sent.html).toContain('email-logo.png')
    expect(sent.html).not.toMatch(/background:|gradient/)   // emailSafeHtml applied centrally
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('api.resend.com'))).toBe(false)   // no more direct POST to Resend
    expect(inserts).toHaveLength(0)
  })

  it('when Resend fails, a failed_emails row (type password_reset) is written for the retry sweep and the answer is still the neutral success', async () => {
    mockSend.mockResolvedValue({ data: null, error: { name: 'application_error', message: 'Resend is down' } })
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(req('known2@example.com'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, message: 'If that email is registered, a reset link has been sent.' })
    expect(mockSend).toHaveBeenCalledTimes(2)   // inline retry, then dead-letter
    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe('failed_emails')
    expect(inserts[0].payload).toMatchObject({ type: 'password_reset', to_email: 'known2@example.com', status: 'pending', attempts: 0, last_error: 'Resend is down' })
    expect(String(inserts[0].payload.html)).toContain('token=rec-123')          // the sweep re-sends the original html
    expect(JSON.stringify(inserts[0].payload.context)).not.toContain('rec-123')  // …but the ops-readable context never carries the link
    // queued for retry → logged, not paged
    const err = mockCaptureError.mock.calls.find(c => (c[1] as { action?: string })?.action === 'auth.forgot_password.resend_failed')!
    expect(err).toBeDefined()
    expect(err[1]).toMatchObject({ alert: false })
    expect(String((err[0] as Error).message)).toMatch(/queued for retry/)
  })

  it('an unknown address still answers identically and sends nothing', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ msg: 'User not found' }) }))
    const { POST } = await import('@/app/api/auth/route')
    const res = await POST(req('nobody@example.com'))
    expect(await res.json()).toEqual({ success: true, message: 'If that email is registered, a reset link has been sent.' })
    expect(mockSend).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })
})
