// ═══════════════════════════════════════════════════════════════
// Legacy Google OAuth callback URL — intentionally token-free.
//
// AUDIT (auth-B #1): this route used to (a) exchange a bare `?code=` for a session and set the session
// cookies straight from a plain link (no Origin check, no binding to the browser that started the flow —
// login CSRF) and (b) serve an HTML page that POSTed `#access_token` from the hash to /api/auth/session.
// Both are removed. The only OAuth landing is the page /auth/google-callback, which posts the code to
// `google_callback` in /api/auth, where it is redeemed with the PKCE verifier cookie of the initiating
// browser. Anything arriving here is forwarded to that page (query string only — never a fragment).
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'

export async function GET(req: NextRequest) {
  const { search } = new URL(req.url)
  return NextResponse.redirect(`${SITE_URL}/auth/google-callback${search}`)
}
