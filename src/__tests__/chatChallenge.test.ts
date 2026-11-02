import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { verifyChatPow, solveChatPow, leadingZeroBits, verifyTurnstile, CHAT_POW_BITS } from '@/lib/api/chatChallenge'

describe('chat proof of work (audit C-10)', () => {
  const token = '1793558504173.cd6bc0f26d045b4a17098a412c8165ec'

  it('default difficulty is 18 bits', () => { expect(CHAT_POW_BITS).toBe(18) })

  it('counts leading zero bits', () => {
    expect(leadingZeroBits(new Uint8Array([0, 0, 0x0f]))).toBe(20)
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0)
    expect(leadingZeroBits(new Uint8Array([0x01]))).toBe(7)
  })

  it('accepts a nonce whose hash has enough leading zero bits and rejects everything else', () => {
    const nonce = solveChatPow(token, 12)
    expect(verifyChatPow(token, nonce, 12)).toBe(true)
    expect(leadingZeroBits(createHash('sha256').update(`${token}:${nonce}`).digest())).toBeGreaterThanOrEqual(12)
    expect(verifyChatPow(token, nonce + 'x', 12)).toBe(false)
    expect(verifyChatPow(token + '0', nonce, 12)).toBe(false)   // bound to the exact token
    expect(verifyChatPow(token, nonce, 26)).toBe(false)         // harder target
    expect(verifyChatPow(token, '', 12)).toBe(false)
    expect(verifyChatPow(token, null, 12)).toBe(false)
    expect(verifyChatPow(token, 'not valid chars!', 12)).toBe(false)
    expect(verifyChatPow(null, nonce, 12)).toBe(false)
  })

  it('uses the same construction as the widget: sha256("<token>:<nonce>")', () => {
    const digest = createHash('sha256').update(`${token}:abc`).digest()
    expect(verifyChatPow(token, 'abc', leadingZeroBits(digest))).toBe(true)
    expect(verifyChatPow(token, 'abc', leadingZeroBits(digest) + 1)).toBe(false)
  })
})

describe('turnstile verification', () => {
  afterEach(() => { delete process.env.TURNSTILE_SECRET_KEY })

  it('fails closed without a secret, a token, or a successful siteverify answer', async () => {
    expect(await verifyTurnstile('tok', '1.2.3.4')).toBe(false)
    process.env.TURNSTILE_SECRET_KEY = 's3cret'
    expect(await verifyTurnstile(null, '1.2.3.4')).toBe(false)
    const bad = vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }))
    expect(await verifyTurnstile('tok', '1.2.3.4', bad as unknown as typeof fetch)).toBe(false)
    const down = vi.fn(async () => { throw new Error('network') })
    expect(await verifyTurnstile('tok', '1.2.3.4', down as unknown as typeof fetch)).toBe(false)
  })

  it('accepts a successful answer and posts secret, response and remoteip', async () => {
    process.env.TURNSTILE_SECRET_KEY = 's3cret'
    const ok = vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as URLSearchParams
      expect(body.get('secret')).toBe('s3cret'); expect(body.get('response')).toBe('tok'); expect(body.get('remoteip')).toBe('1.2.3.4')
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    })
    expect(await verifyTurnstile('tok', '1.2.3.4', ok as unknown as typeof fetch)).toBe(true)
    expect(ok.mock.calls[0][0]).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
  })
})
