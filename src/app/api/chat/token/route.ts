import { NextRequest, NextResponse } from 'next/server'
import { isSameOrigin, getClientIp } from '@/lib/api/aiGuard'
import { checkRateLimitKv } from '@/lib/api/rateLimitKv'
import { issueChatToken } from '@/lib/api/chatToken'
import { CHAT_POW_BITS, turnstileEnabled, turnstileSiteKey } from '@/lib/api/chatChallenge'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Hands the chat widget a short-lived token (see lib/api/chatToken.ts). Same-origin only; 30 per IP per hour. */
export async function GET(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!await checkRateLimitKv(`mw:rl:ai_chat_token:${getClientIp(req)}`, 30, 3600)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '3600' } })
  }
  const t = issueChatToken(req.headers.get('user-agent') ?? '')
  // No secret configured (local dev): the chat route skips the check too, so an empty token is fine.
  // The challenge the widget must solve before /api/chat accepts a message (see lib/api/chatChallenge.ts): Turnstile when a
  // site key is configured, otherwise proof of work bound to this token. No token (local dev) → no challenge either.
  const challenge = !t ? null : turnstileEnabled() && turnstileSiteKey()
    ? { type: 'turnstile' as const, site_key: turnstileSiteKey() }
    : { type: 'pow' as const, bits: CHAT_POW_BITS }
  return NextResponse.json({ token: t?.token ?? '', expires_in: t?.expiresInSec ?? 0, challenge }, { headers: { 'Cache-Control': 'no-store' } })
}
