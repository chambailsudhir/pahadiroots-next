import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_TOKEN, COOKIE_REFRESH } from '@/lib/auth/cookies'
import { checkCsrf } from '@/lib/api/serverUtils'

const IS_PROD = process.env.NODE_ENV === 'production'

function cookieBase() {
  // SEC-3 FIX: 'strict' was preventing auth cookies from being sent on
  // cross-site top-level navigations (e.g. a user clicking a WhatsApp link
  // to pahadiroots.com while already logged in — their session cookies would
  // not be sent, making them appear logged out).
  //
  // 'lax' is the correct value for auth cookies on e-commerce sites:
  //   ✓ Cookies ARE sent on top-level GET navigations (links, redirects)
  //   ✗ Cookies are NOT sent on embedded cross-site sub-requests (iframes, images)
  //
  // This matches the same SameSite=Lax setting already used in
  // google-callback/route.ts (PKCE flow). The two flows must agree so the
  // user's session behaves consistently regardless of which OAuth path ran.
  return { httpOnly: true, secure: IS_PROD, sameSite: 'lax' as const, path: '/' }
}

export async function GET(req: NextRequest) {
  const token   = req.cookies.get(COOKIE_TOKEN)?.value
  const refresh = req.cookies.get(COOKIE_REFRESH)?.value
  return NextResponse.json({ loggedIn: !!token, hasRefresh: !!refresh }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  // SEC-FIX: the previous implementation had no CSRF protection. The action=set
  // path writes arbitrary tokens into httpOnly cookies — an attacker who can
  // issue a cross-origin POST (e.g. via a malicious web page) could plant a
  // controlled access_token into the victim's browser. This is a session
  // fixation vector: the victim's subsequent requests carry the attacker's token,
  // potentially letting the attacker observe session activity or force the victim
  // into a known account.
  // Fix: validate Origin/Referer before touching cookies on any POST.
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  let body: { action?: string } = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // AUDIT (auth-B #1): `action: 'set'` (store caller-supplied tokens as the session) is REMOVED. It
  // accepted arbitrary tokens with no validation and no binding to the browser that started a login, so a
  // crafted /auth/google-callback#access_token=… link signed the victim into the attacker's account.
  // Sessions are now only created server-side by /api/auth (email_login, email_signup, google_callback —
  // the latter redeems a PKCE code with an HttpOnly verifier cookie), which set the cookies themselves.
  if (body.action === 'set') {
    return NextResponse.json({ error: 'This action is no longer available' }, { status: 410 })
  }

  if (body.action === 'clear') {
    const res = NextResponse.json({ ok: true })
    res.cookies.set(COOKIE_TOKEN,   '', { ...cookieBase(), maxAge: 0 })
    res.cookies.set(COOKIE_REFRESH, '', { ...cookieBase(), maxAge: 0 })
    return res
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
