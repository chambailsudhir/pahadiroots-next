import { createHash } from 'crypto'

/**
 * Bot challenge for /api/chat (audit C-10).
 *
 * Two modes, chosen by configuration:
 *  1. Cloudflare Turnstile — a real CAPTCHA. Enabled when TURNSTILE_SECRET_KEY (server) and NEXT_PUBLIC_TURNSTILE_SITE_KEY
 *     (browser) are set. The widget solves an invisible challenge and sends the result as `x-turnstile-token`; we verify it
 *     with Cloudflare's siteverify endpoint. Needs a free Cloudflare account to get the two keys.
 *  2. Proof of work (default, no third party). The browser must find a nonce such that SHA-256("<session token>:<nonce>")
 *     starts with CHAT_POW_BITS zero bits (default 18 ≈ 260k hashes ≈ under a second in a browser, solved once per 30-minute
 *     session token while the visitor types their first message). A script hammering the endpoint has to pay that cost for
 *     every session it opens, on top of the per-IP and global rate limits. The nonce is bound to the signed token, so nothing
 *     is stored server-side and a nonce cannot be reused with another token.
 */
const DEFAULT_BITS = 18
export const CHAT_POW_BITS: number = (() => {
  const n = Number(process.env.CHAT_POW_BITS)
  return Number.isFinite(n) && n >= 8 && n <= 26 ? Math.floor(n) : DEFAULT_BITS
})()

export function leadingZeroBits(buf: Uint8Array): number {
  let bits = 0
  for (const byte of buf) {
    if (byte === 0) { bits += 8; continue }
    bits += Math.clz32(byte) - 24
    break
  }
  return bits
}

/** True when `nonce` is a valid proof of work for `token` at the given difficulty. */
export function verifyChatPow(token: string | null | undefined, nonce: string | null | undefined, bits: number = CHAT_POW_BITS): boolean {
  if (!token || !nonce || !/^[A-Za-z0-9_-]{1,64}$/.test(nonce)) return false
  const digest = createHash('sha256').update(`${token}:${nonce}`).digest()
  return leadingZeroBits(digest) >= bits
}

/** Test/dev helper: find a nonce for a token (same algorithm the widget runs). */
export function solveChatPow(token: string, bits: number = CHAT_POW_BITS, maxIterations = 50_000_000): string {
  for (let i = 0; i < maxIterations; i++) {
    const nonce = i.toString(36)
    if (verifyChatPow(token, nonce, bits)) return nonce
  }
  throw new Error('no proof found')
}

export function turnstileEnabled(): boolean { return !!process.env.TURNSTILE_SECRET_KEY }
export function turnstileSiteKey(): string | null { return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null }

/** Verify a Turnstile response token with Cloudflare. Fails closed on any error (the chat is a convenience, not a necessity). */
export async function verifyTurnstile(token: string | null | undefined, ip: string | null, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret || !token || token.length > 2048) return false
  try {
    const body = new URLSearchParams({ secret, response: token })
    if (ip) body.set('remoteip', ip)
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body, signal: AbortSignal.timeout(4_000),
    })
    if (!res.ok) return false
    const data = await res.json() as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}
