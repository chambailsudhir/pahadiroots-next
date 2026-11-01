import { NextRequest, NextResponse } from 'next/server'
import { isSameOrigin, getClientIp } from '@/lib/api/aiGuard'
import { checkRateLimitKv } from '@/lib/api/rateLimitKv'
import { issueChatToken } from '@/lib/api/chatToken'

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
  return NextResponse.json({ token: t?.token ?? '', expires_in: t?.expiresInSec ?? 0 }, { headers: { 'Cache-Control': 'no-store' } })
}
