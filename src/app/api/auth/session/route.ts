import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_TOKEN, COOKIE_REFRESH } from '@/lib/auth/cookies'

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
  return NextResponse.json({ loggedIn: !!token, hasRefresh: !!refresh })
}

export async function POST(req: NextRequest) {
  let body: { action?: string; access_token?: string; refresh_token?: string } = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.action === 'set') {
    if (!body.access_token) return NextResponse.json({ error: 'access_token required' }, { status: 400 })
    const res = NextResponse.json({ ok: true })
    res.cookies.set(COOKIE_TOKEN,   body.access_token,  { ...cookieBase(), maxAge: 60 * 60 })
    if (body.refresh_token) {
      res.cookies.set(COOKIE_REFRESH, body.refresh_token, { ...cookieBase(), maxAge: 60 * 60 * 24 * 30 })
    }
    return res
  }

  if (body.action === 'clear') {
    const res = NextResponse.json({ ok: true })
    res.cookies.set(COOKIE_TOKEN,   '', { ...cookieBase(), maxAge: 0 })
    res.cookies.set(COOKIE_REFRESH, '', { ...cookieBase(), maxAge: 0 })
    return res
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
