import { describe, it, expect, vi, afterEach } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ getServiceClient: vi.fn() }))
vi.mock('@/lib/getSiteSettings', () => ({ getSiteSettings: vi.fn(async () => ({})) }))
import { Resend } from 'resend'
import { emailIdempotencyKey, sendWithIdempotency } from '@/lib/server/email'

// Nov 2026 verification: a timed-out send that Resend had accepted was retried inline and again by the dead-letter sweep, so the
// same mail could arrive two or three times. Every send now carries one Idempotency-Key per mail content.
afterEach(() => { vi.unstubAllGlobals() })

describe('Resend idempotency key', () => {
  it('is stable for the same mail and different for a different mail', () => {
    const a = emailIdempotencyKey('order_confirmation', 'a@b.com', 'Order ORD-1', '<p>x</p>')
    expect(a).toBe(emailIdempotencyKey('order_confirmation', 'a@b.com', 'Order ORD-1', '<p>x</p>'))
    expect(a).not.toBe(emailIdempotencyKey('order_confirmation', 'a@b.com', 'Order ORD-2', '<p>x</p>'))
    expect(a.startsWith('order_confirmation:')).toBe(true)
    expect(a.length).toBeLessThanOrEqual(256)
  })

  it('the real SDK client sends the key as a request header, together with its own Authorization', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'em_1' }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const resend = new Resend('re_test_key')
    const res = await sendWithIdempotency(resend, { from: 'x@pahadiroots.com', to: ['a@b.com'], subject: 's', html: '<p>x</p>' }, 'order_confirmation:abc')
    expect(res.error).toBeNull()
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    const h = new Headers(init.headers)
    expect(h.get('idempotency-key')).toBe('order_confirmation:abc')
    expect(h.get('authorization')).toBe('Bearer re_test_key')
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ['a@b.com'], subject: 's' })
  })
})
