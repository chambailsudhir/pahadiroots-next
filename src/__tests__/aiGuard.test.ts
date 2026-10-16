import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const limiter = vi.fn(async (..._a: any[]) => true)
vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: (...a: any[]) => limiter(...a) }))

import {
  guardAiRequest, isSameOrigin, sanitizeChatContents, sanitizeSystemText, isAllowedAudioMime, readCappedJson,
} from '@/lib/api/aiGuard'

const OPTS = { name: 't', maxBodyBytes: 1000, perMinute: 2, perHour: 5, perDayGlobal: 9 }
function req(headers: Record<string, string>, body = '{}') {
  return new NextRequest('https://www.pahadiroots.com/api/chat', { method: 'POST', headers: { host: 'www.pahadiroots.com', ...headers }, body })
}

beforeEach(() => { limiter.mockReset(); limiter.mockResolvedValue(true) })

describe('same-origin check', () => {
  it('accepts own Origin and own Referer', () => {
    expect(isSameOrigin(req({ origin: 'https://www.pahadiroots.com' }))).toBe(true)
    expect(isSameOrigin(req({ referer: 'https://www.pahadiroots.com/products' }))).toBe(true)
  })
  it('rejects other sites, missing headers and garbage', () => {
    expect(isSameOrigin(req({ origin: 'https://evil.example' }))).toBe(false)
    expect(isSameOrigin(req({}))).toBe(false)
    expect(isSameOrigin(req({ origin: 'not a url' }))).toBe(false)
  })
})

describe('guardAiRequest', () => {
  it('403 for a foreign origin and never touches the limiter', async () => {
    const r = await guardAiRequest(req({ origin: 'https://evil.example' }), OPTS)
    expect(r?.status).toBe(403); expect(limiter).not.toHaveBeenCalled()
  })
  it('413 when content-length exceeds the cap', async () => {
    const r = await guardAiRequest(req({ origin: 'https://www.pahadiroots.com', 'content-length': '5000' }), OPTS)
    expect(r?.status).toBe(413)
  })
  it('429 on burst, 429 on hourly, 503 on the global daily ceiling', async () => {
    const h = { origin: 'https://www.pahadiroots.com', 'x-forwarded-for': '1.2.3.4' }
    limiter.mockResolvedValueOnce(false)
    expect((await guardAiRequest(req(h), OPTS))?.status).toBe(429)
    limiter.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect((await guardAiRequest(req(h), OPTS))?.status).toBe(429)
    limiter.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect((await guardAiRequest(req(h), OPTS))?.status).toBe(503)
  })
  it('passes (null) when everything is within limits, keyed per IP', async () => {
    const r = await guardAiRequest(req({ origin: 'https://www.pahadiroots.com', 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }), OPTS)
    expect(r).toBeNull()
    expect(limiter.mock.calls[0][0]).toBe('mw:rl:ai_t_min:9.9.9.9')
    expect(limiter.mock.calls[2][0]).toBe('mw:rl:ai_t_day:global')
  })
})

describe('readCappedJson', () => {
  it('rejects oversize and malformed bodies', async () => {
    const big = await readCappedJson(req({}, JSON.stringify({ a: 'x'.repeat(2000) })), 1000)
    expect(big.ok).toBe(false)
    const bad = await readCappedJson(req({}, '{nope'), 1000)
    expect(bad.ok).toBe(false)
    const ok = await readCappedJson(req({}, '{"a":1}'), 1000)
    expect(ok).toEqual({ ok: true, body: { a: 1 } })
  })
})

describe('chat input shaping', () => {
  const turn = (role: string, text: string) => ({ role, parts: [{ text }], extra: 'dropped' })
  it('keeps only role+text and requires the last turn to be the user', () => {
    const out = sanitizeChatContents([turn('model', 'hi'), turn('user', 'hello')])
    expect(out).toEqual([{ role: 'model', parts: [{ text: 'hi' }] }, { role: 'user', parts: [{ text: 'hello' }] }])
    expect(sanitizeChatContents([turn('user', 'a'), turn('model', 'b')])).toBeNull()
  })
  it('rejects bad roles, empty/oversized text, too many turns, non-arrays', () => {
    expect(sanitizeChatContents([turn('system', 'x')])).toBeNull()
    expect(sanitizeChatContents([turn('user', '')])).toBeNull()
    expect(sanitizeChatContents([turn('user', 'x'.repeat(9000))])).toBeNull()
    expect(sanitizeChatContents(Array.from({ length: 13 }, () => turn('user', 'x')))).toBeNull()
    expect(sanitizeChatContents('nope')).toBeNull()
    expect(sanitizeChatContents([])).toBeNull()
  })
  it('system prompt: string ok, absent ok, oversized rejected', () => {
    expect(sanitizeSystemText({ parts: [{ text: 'be kind' }] })).toBe('be kind')
    expect(sanitizeSystemText(undefined)).toBe('')
    expect(sanitizeSystemText({ parts: [{ text: 'x'.repeat(250_001) }] })).toBeNull()
  })
})

describe('transcribe input shaping', () => {
  it('allows common recorder mime types only', () => {
    for (const m of ['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/mp4', 'audio/wav']) expect(isAllowedAudioMime(m)).toBe(true)
    for (const m of ['text/html', 'application/pdf', 'video/mp4', '', 5, undefined]) expect(isAllowedAudioMime(m as any)).toBe(false)
  })
})
