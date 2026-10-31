/**
 * GET /api/v1/subscribe/confirm — step 2 of the newsletter double opt-in (audit C-11).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (cb: () => void | Promise<void>) => { void cb() } }
})

const mockUpsert = vi.fn()
const mockFrom = vi.fn(() => ({ upsert: mockUpsert }))
vi.mock('@/lib/supabase', () => ({ getServiceClient: vi.fn(() => ({ from: mockFrom })) }))
const mockEmail = vi.fn().mockResolvedValue({ sent: true })
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: (...a: unknown[]) => mockEmail(...a) }))
const mockRateLimit = vi.fn().mockResolvedValue(true)
vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: (...a: unknown[]) => mockRateLimit(...a) }))

import { GET } from '@/app/api/v1/subscribe/confirm/route'
import { createSubscribeToken } from '@/lib/server/subscribeToken'

const call = (t?: string) => GET(new NextRequest(`http://localhost/api/v1/subscribe/confirm${t === undefined ? '' : `?t=${encodeURIComponent(t)}`}`, { headers: { 'x-forwarded-for': '10.1.1.1' } }))

beforeEach(() => {
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key-aaaaaaaaaaaaaaaa'
  mockUpsert.mockReset().mockResolvedValue({ error: null })
  mockFrom.mockClear(); mockEmail.mockClear()
  mockRateLimit.mockReset().mockResolvedValue(true)
})

describe('subscribe confirm route', () => {
  it('a valid link subscribes the address with real columns only, then sends the welcome coupon email', async () => {
    const res = await call(createSubscribeToken({ email: 'jane@example.com', name: 'Jane', source: 'footer' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('You’re in!')
    expect(mockFrom).toHaveBeenCalledWith('subscribers')
    const [payload, opts] = mockUpsert.mock.calls[0]
    expect(payload).toEqual({ email: 'jane@example.com', name: 'Jane', is_active: true, source: 'footer' })
    expect(payload).not.toHaveProperty('subscribed_at')       // column does not exist on the real table
    expect(opts).toEqual({ onConflict: 'email' })
    await vi.waitFor(() => expect(mockEmail).toHaveBeenCalledTimes(1))
    expect(mockEmail.mock.calls[0][0]).toMatchObject({ type: 'newsletter_welcome', to: 'jane@example.com' })
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ code: expect.stringMatching(/^WELCOME5-[0-9A-F]{6}$/), type: 'percent', value: 5, max_uses: 1, first_order_only: true }), expect.anything())
  })

  it.each([undefined, '', 'garbage', 'a.b'])('rejects a missing/invalid token (%s) with 400 and writes nothing', async t => {
    const res = await call(t as string | undefined)
    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockEmail).not.toHaveBeenCalled()
  })

  it('rejects an expired link', async () => {
    const res = await call(createSubscribeToken({ email: 'a@b.co', name: null, source: null }, Date.now() - 3 * 24 * 3600 * 1000))
    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('shows an error (not a false success) and sends no coupon when the database write fails', async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: 'db down' } })
    const res = await call(createSubscribeToken({ email: 'a@b.co', name: null, source: null }))
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('You’re in!')
    expect(mockEmail).not.toHaveBeenCalled()
  })

  it('opening the link again does not mail the code a third time (2/day per address)', async () => {
    mockRateLimit.mockImplementation(async (key: string) => !String(key).startsWith('mw:rl:subscribe_welcome:'))
    const res = await call(createSubscribeToken({ email: 'a@b.co', name: null, source: null }))
    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 20))
    expect(mockEmail).not.toHaveBeenCalled()
  })

  it('answers 429 when the IP is hammering the endpoint', async () => {
    mockRateLimit.mockResolvedValue(false)
    expect((await call(createSubscribeToken({ email: 'a@b.co', name: null, source: null }))).status).toBe(429)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('answers 503 (not a crash) if the signing key is not configured', async () => {
    const t = createSubscribeToken({ email: 'a@b.co', name: null, source: null })
    delete process.env.SUPABASE_SERVICE_KEY
    expect((await call(t)).status).toBe(503)
  })

  it('never caches and is not indexable', async () => {
    const res = await call('garbage')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex')
  })
})
