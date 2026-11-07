import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ sbAdmin: vi.fn(), rate: vi.fn(), send: vi.fn() }))
vi.mock('@/lib/api/serverUtils', () => ({ sbAdmin: h.sbAdmin, checkCsrf: () => null }))
vi.mock('@/lib/api/rateLimitKv', () => ({
  checkRateLimitKv: h.rate,
  checkRateLimitKvStrict: async (...a: unknown[]) => ((await h.rate(...a)) ? 'allowed' : 'blocked'),
  RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SEC: 10,
}))
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: h.send }))
vi.mock('@/lib/logger', () => ({ captureError: vi.fn(), logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { hashCodCode } from '@/lib/server/codVerification'

const req = (path: string, body: unknown) => new NextRequest(`https://www.pahadiroots.com${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://www.pahadiroots.com', 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify(body),
})
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('SUPABASE_SERVICE_KEY', 'svc-test')
  h.rate.mockResolvedValue(true); h.send.mockResolvedValue({ sent: true }); h.sbAdmin.mockResolvedValue(null)
})

describe('POST /api/v1/cod-verify/start', () => {
  const start = async (body: unknown) => (await import('@/app/api/v1/cod-verify/start/route')).POST(req('/api/v1/cod-verify/start', body))
  it('stores only a hash of the code and e-mails the code; answers a masked address, private no-store', async () => {
    const res = await start({ phone: '+91 98765 43210', email: 'Asha@Example.com' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const body = await res.json()
    expect(body).toMatchObject({ sent: true, channel: 'email', to: 'as**@example.com' })
    const [, path, row] = h.sbAdmin.mock.calls[0] as [string, string, Record<string, string>]
    expect(path).toBe('/rest/v1/cod_verifications')
    expect(row).toMatchObject({ phone10: '9876543210', email: 'asha@example.com', channel: 'email' })
    const mail = h.send.mock.calls[0][0] as { type: string; to: string; subject: string; html: string }
    const code = /(\d{6})/.exec(mail.subject)![1]
    expect(mail).toMatchObject({ type: 'cod_verification', to: 'asha@example.com' })
    expect(mail.html).toContain(code)
    expect(row.code_hash).toBe(hashCodCode(code, '9876543210', 'asha@example.com'))
    expect(JSON.stringify(row)).not.toContain(code)
  })
  it('refuses a bad phone / e-mail, and answers 429 when rate-limited (nothing stored or sent)', async () => {
    expect((await start({ phone: '12345', email: 'a@b.com' })).status).toBe(400)
    expect((await start({ phone: '9876543210', email: 'nope' })).status).toBe(400)
    h.rate.mockResolvedValue(false)
    expect((await start({ phone: '9876543210', email: 'a@b.com' })).status).toBe(429)
    expect(h.sbAdmin).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled()
  })
  it('503 when the mail could not be sent or queued', async () => {
    h.send.mockResolvedValue({ sent: false, deadLettered: false })
    expect((await start({ phone: '9876543210', email: 'a@b.com' })).status).toBe(503)
  })
})

describe('POST /api/v1/cod-verify/confirm', () => {
  const confirm = async (body: unknown) => (await import('@/app/api/v1/cod-verify/confirm/route')).POST(req('/api/v1/cod-verify/confirm', body))
  const row = (over: Record<string, unknown> = {}) => ({ id: 7, code_hash: hashCodCode('123456', '9876543210', 'a@b.com'), attempts: 0, expires_at: '2099-01-01T00:00:00Z', verified_at: null, ...over })
  it('the right code → token; the row is marked verified with only the token HASH', async () => {
    h.sbAdmin.mockImplementation(async (m: string) => (m === 'GET' ? [row()] : [{ id: 7 }]))
    const res = await confirm({ phone: '9876543210', email: 'A@b.com', code: '123456' })
    expect(res.status).toBe(200)
    const { token } = await res.json()
    expect(token).toMatch(/^[\w-]{40,}$/)
    const patch = h.sbAdmin.mock.calls.find(c => c[0] === 'PATCH')!
    expect(String(patch[1])).toContain('verified_at=is.null')
    expect(JSON.stringify(patch[2])).not.toContain(token)
  })
  it('a wrong code counts an attempt (conditional on the read value) and says how many are left', async () => {
    h.sbAdmin.mockImplementation(async (m: string) => (m === 'GET' ? [row({ attempts: 3 })] : [{ id: 7 }]))
    const res = await confirm({ phone: '9876543210', email: 'a@b.com', code: '000000' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'CODE_WRONG', attempts_left: 1 })
    const patch = h.sbAdmin.mock.calls.find(c => c[0] === 'PATCH')!
    expect(String(patch[1])).toContain('attempts=eq.3')
  })
  it('after 5 wrong codes the code is locked; an expired / unknown code asks for a new one', async () => {
    h.sbAdmin.mockImplementation(async (m: string) => (m === 'GET' ? [row({ attempts: 5 })] : null))
    expect((await confirm({ phone: '9876543210', email: 'a@b.com', code: '123456' })).status).toBe(429)
    h.sbAdmin.mockImplementation(async () => [])
    const res = await confirm({ phone: '9876543210', email: 'a@b.com', code: '123456' })
    expect(await res.json()).toMatchObject({ code: 'CODE_EXPIRED' })
  })

  // R4A-4: a guess that loses the attempt-counter race is refused WITHOUT being compared (so parallel guesses cannot
  // exceed the 5-attempt limit) — even when it happens to be the right code.
  it('a guess that loses the counter race is refused uncompared and mints no token', async () => {
    h.sbAdmin.mockImplementation(async (m: string) => (m === 'GET' ? [row({ attempts: 2 })] : []))
    const res = await confirm({ phone: '9876543210', email: 'a@b.com', code: '123456' })
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ code: 'CODE_BUSY' })
    expect(h.sbAdmin.mock.calls.some(c => c[0] === 'PATCH' && JSON.stringify(c[2] ?? {}).includes('token_hash'))).toBe(false)
  })
})

describe('R4A-5: /cod-verify/start limits per recipient and fails closed', () => {
  const start = async (body: unknown) => (await import('@/app/api/v1/cod-verify/start/route')).POST(req('/api/v1/cod-verify/start', body))
  it('the per-e-mail limit applies even when the phone changes', async () => {
    h.rate.mockImplementation(async (k: string) => !String(k).startsWith('mw:rl:codverify:email:'))
    expect((await start({ phone: '9876543210', email: 'victim@example.com' })).status).toBe(429)
    expect(h.send).not.toHaveBeenCalled()
  })
})
