import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { issueChatToken, verifyChatToken, chatTokenEnabled } from '@/lib/api/chatToken'

const OLD = { ...process.env }
beforeEach(() => { process.env.CHAT_TOKEN_SECRET = 'test-secret-1' })
afterEach(() => { process.env = { ...OLD } })

describe('chat session token', () => {
  it('accepts a fresh token for the same browser', () => {
    const t = issueChatToken('UA/1', 1_000_000_000_000)!
    expect(verifyChatToken(t.token, 'UA/1', 1_000_000_000_000 + 60_000)).toBe(true)
  })
  it('rejects a different User-Agent, an expired token, tampering and garbage', () => {
    const now = 1_000_000_000_000
    const t = issueChatToken('UA/1', now)!
    expect(verifyChatToken(t.token, 'UA/2', now)).toBe(false)
    expect(verifyChatToken(t.token, 'UA/1', now + 31 * 60 * 1000)).toBe(false)
    const [exp, sig] = t.token.split('.')
    expect(verifyChatToken(`${exp}.${sig.replace(/.$/, c => (c === '0' ? '1' : '0'))}`, 'UA/1', now)).toBe(false)
    expect(verifyChatToken(`${Number(exp) + 1000}.${sig}`, 'UA/1', now)).toBe(false)
    for (const bad of [undefined, null, '', 'abc', '1.2']) expect(verifyChatToken(bad as any, 'UA/1', now)).toBe(false)
  })
  it('a token cannot be minted with a far-future expiry', () => {
    const now = 1_000_000_000_000
    expect(verifyChatToken(`${now + 24 * 3600_000}.${'a'.repeat(32)}`, 'UA/1', now)).toBe(false)
  })
  it('is switched off (never locks anyone out) when no secret exists', () => {
    delete process.env.CHAT_TOKEN_SECRET; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SERVICE_KEY
    expect(chatTokenEnabled()).toBe(false)
    expect(verifyChatToken(undefined, 'x')).toBe(true)
    expect(issueChatToken('x')).toBeNull()
  })
})
