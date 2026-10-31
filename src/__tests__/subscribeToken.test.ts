/**
 * Newsletter double opt-in tokens (audit C-11): signed, expiring, tamper-proof.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createSubscribeToken, verifySubscribeToken, SUBSCRIBE_TOKEN_TTL_MS } from '@/lib/server/subscribeToken'

const P = { email: 'jane@example.com', name: 'Jane', source: 'footer' }
let saved: string | undefined
beforeEach(() => { saved = process.env.SUPABASE_SERVICE_KEY; process.env.SUPABASE_SERVICE_KEY = 'test-service-key-aaaaaaaaaaaaaaaa' })
afterEach(() => { if (saved === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = saved })

describe('subscribe tokens', () => {
  it('round-trips the payload', () => {
    const r = verifySubscribeToken(createSubscribeToken(P))
    expect(r).toEqual({ ok: true, payload: P })
  })

  it('keeps null name/source', () => {
    const r = verifySubscribeToken(createSubscribeToken({ email: 'a@b.co', name: null, source: null }))
    expect(r.ok && r.payload).toEqual({ email: 'a@b.co', name: null, source: null })
  })

  it('rejects a token whose body was edited (e.g. swapping in a different email)', () => {
    const [body, sig] = createSubscribeToken(P).split('.')
    const forged = Buffer.from(JSON.stringify({ e: 'victim@example.com', n: null, s: null, x: Date.now() + 1e9 })).toString('base64url')
    expect(verifySubscribeToken(`${forged}.${sig}`)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifySubscribeToken(`${body}.${sig}x`).ok).toBe(false)
  })

  it('rejects a token signed with a different key', () => {
    const t = createSubscribeToken(P)
    process.env.SUPABASE_SERVICE_KEY = 'a-completely-different-key-bbbbbbbb'
    expect(verifySubscribeToken(t)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('expires after 48 hours', () => {
    const now = 1_800_000_000_000
    const t = createSubscribeToken(P, now)
    expect(verifySubscribeToken(t, now + SUBSCRIBE_TOKEN_TTL_MS - 1000).ok).toBe(true)
    expect(verifySubscribeToken(t, now + SUBSCRIBE_TOKEN_TTL_MS + 1000)).toEqual({ ok: false, reason: 'expired' })
  })

  it.each(['', 'abc', 'a.b.c', '.', 'x'.repeat(5000), '%%%.%%%', '{"e":"a@b.co"}'])('treats garbage %# as invalid, never throws', t => {
    expect(verifySubscribeToken(t).ok).toBe(false)
  })

  it('cannot sign when the service key is not configured (fails loudly, never signs with an empty key)', () => {
    delete process.env.SUPABASE_SERVICE_KEY
    expect(() => createSubscribeToken(P)).toThrow(/SUPABASE_SERVICE_KEY/)
  })

  it('verifying with no key configured throws (a server fault) instead of calling a good link "invalid"', () => {
    const t = createSubscribeToken(P)
    delete process.env.SUPABASE_SERVICE_KEY
    expect(() => verifySubscribeToken(t)).toThrow(/SUPABASE_SERVICE_KEY/)
  })
})
