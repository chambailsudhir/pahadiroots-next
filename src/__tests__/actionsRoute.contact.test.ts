/**
 * Nov 2026 verification — POST /api/v1/actions { action: 'contact' }
 *
 * The contact form relayed anything to the admin inbox with only the shared 10/min per-IP limit: no honeypot, no daily
 * per-IP or global cap, and empty names / one-character messages were accepted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (cb: () => void | Promise<void>) => { void cb() } }
})
vi.mock('@/lib/supabase', () => ({ getServiceClient: vi.fn(() => ({ from: vi.fn() })) }))
const mockSend = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: (...a: unknown[]) => mockSend(...a) }))
const mockRateLimit = vi.fn()
const mockCapture = vi.fn()
vi.mock('@/lib/logger', async (orig) => ({ ...(await orig<typeof import('@/lib/logger')>()), captureError: (...a: unknown[]) => mockCapture(...a) }))
vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: (...a: unknown[]) => mockRateLimit(...a) }))

import { POST } from '@/app/api/v1/actions/route'

function req(body: Record<string, unknown>, ip = '203.0.113.7') {
  return new NextRequest('http://localhost/api/v1/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ action: 'contact', ...body }),
  })
}
const GOOD = { name: 'Ravi', email: 'ravi@example.com', message: 'Do you ship to Pune?' }
const keys = () => mockRateLimit.mock.calls.map(c => c[0] as string)

beforeEach(() => {
  mockSend.mockClear()
  mockRateLimit.mockReset()
  mockRateLimit.mockResolvedValue(true)
})

describe('contact action — anti-spam', () => {
  it('a valid message is sent and counted against the per-IP daily cap (5) and the global daily cap (200)', async () => {
    const res = await POST(req(GOOD))
    expect(res.status).toBe(200)
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockRateLimit).toHaveBeenCalledWith('mw:rl:contact:ip:203.0.113.7', 5, 86400)
    expect(mockRateLimit).toHaveBeenCalledWith('mw:rl:contact:global', 200, 86400)
  })

  it('a filled honeypot (`website`) answers success but sends nothing', async () => {
    const res = await POST(req({ ...GOOD, website: 'http://spam.example' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(mockSend).not.toHaveBeenCalled()
    expect(keys().some(k => k.startsWith('mw:rl:contact:'))).toBe(false)
  })

  it('rejects an empty name and a message shorter than 10 characters', async () => {
    expect((await POST(req({ ...GOOD, name: '   ' }))).status).toBe(400)
    expect((await POST(req({ ...GOOD, message: 'hi there' }))).status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('over the per-IP daily cap → 429, nothing sent', async () => {
    mockRateLimit.mockImplementation(async (key: string) => key !== 'mw:rl:contact:ip:203.0.113.7')
    const res = await POST(req(GOOD))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('over the global daily cap → 429, nothing sent', async () => {
    mockRateLimit.mockImplementation(async (key: string) => key !== 'mw:rl:contact:global')
    const res = await POST(req(GOOD))
    expect(res.status).toBe(429)
    expect(mockSend).not.toHaveBeenCalled()
    // R3-3: tripping the shared cap closes the form for everyone, so ops is alerted
    expect(mockCapture).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ action: 'contact.global_cap_tripped', alert: true }))
  })

  it('keys IPv6 callers by their /64 (clientIpKey), so rotating addresses inside one /64 shares the cap', async () => {
    await POST(req(GOOD, '2001:db8:1:2::aaaa'))
    await POST(req(GOOD, '2001:db8:1:2::bbbb'))
    const ipKeys = keys().filter(k => k.startsWith('mw:rl:contact:ip:'))
    expect(new Set(ipKeys).size).toBe(1)
  })
})
