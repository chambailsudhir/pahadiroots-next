import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Short-lived "this browser loaded our site" token for the chat API.
 *
 * Why: /api/chat spends money (Gemini / Claude). Same-origin checks only stop other websites; a script that calls the
 * endpoint directly could burn the daily allowance. Requiring a token that is only handed out by GET /api/chat/token (itself
 * same-origin + rate-limited) means a bot has to behave like a browser session first, and every token expires, so it cannot be
 * stockpiled. It is bound to the User-Agent but NOT to the IP (mobile visitors change IP mid-session).
 *
 * It is a speed bump, not a CAPTCHA: a determined attacker with a real browser is still stopped by the per-IP and global caps.
 */
const TTL_MS = 30 * 60 * 1000

function secret(): string | null {
  const s = process.env.CHAT_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  return s ? createHmac('sha256', s).update('pahadi-chat-token-v1').digest('hex') : null
}

function sign(key: string, exp: number, ua: string): string {
  return createHmac('sha256', key).update(`${exp}.${ua}`).digest('hex').slice(0, 32)
}

/** False when no secret is configured (local dev) — callers then skip enforcement rather than lock everyone out. */
export function chatTokenEnabled(): boolean { return secret() !== null }

export function issueChatToken(ua: string, now = Date.now()): { token: string; expiresInSec: number } | null {
  const key = secret()
  if (!key) return null
  const exp = now + TTL_MS
  return { token: `${exp}.${sign(key, exp, ua)}`, expiresInSec: Math.floor(TTL_MS / 1000) }
}

export function verifyChatToken(token: string | null | undefined, ua: string, now = Date.now()): boolean {
  const key = secret()
  if (!key) return true
  const m = /^(\d{10,16})\.([0-9a-f]{32})$/.exec(token ?? '')
  if (!m) return false
  const exp = Number(m[1])
  if (!Number.isFinite(exp) || exp < now || exp > now + TTL_MS + 60_000) return false
  const want = Buffer.from(sign(key, exp, ua)); const got = Buffer.from(m[2])
  return want.length === got.length && timingSafeEqual(want, got)
}
