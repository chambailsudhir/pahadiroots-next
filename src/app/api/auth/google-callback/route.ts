// ═══════════════════════════════════════════════════════════════
// Google OAuth callback handler
//
// Supabase can return tokens in TWO ways:
//   A) ?code=...        → PKCE flow  (server can read, exchange for tokens)
//   B) #access_token=...→ Implicit flow (hash is client-only, server never sees it)
//
// Since the Supabase dashboard is set to implicit flow, we get case B.
// The browser lands here with tokens in the hash — the server sees NO query params.
// Solution: return a tiny HTML page that reads window.location.hash client-side,
// POSTs tokens to /api/auth/session to write httpOnly cookies, then goes to /account.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_TOKEN, COOKIE_REFRESH } from '@/lib/auth/cookies'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SITE_URL      = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'
const IS_PROD       = process.env.NODE_ENV === 'production'

function cookieBase() {
  return { httpOnly: true, secure: IS_PROD, sameSite: 'lax' as const, path: '/' }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const error = searchParams.get('error')

  // ── Error from Supabase ──────────────────────────────────
  if (error) {
    return NextResponse.redirect(`${SITE_URL}/account?auth_error=${encodeURIComponent(error)}`)
  }

  // ── Case A: PKCE flow — ?code= in query string ───────────
  if (code) {
    try {
      const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
        body: JSON.stringify({ auth_code: code }),
        // PERF FIX: no timeout was set — a slow Supabase response hangs the serverless
        // function until Vercel's 15-second limit. 8 s matches all other auth fetches.
        signal: AbortSignal.timeout(8_000),
      })
      const tokenData = await tokenRes.json()

      if (tokenData.access_token) {
        const res = NextResponse.redirect(`${SITE_URL}/account`)
        res.cookies.set(COOKIE_TOKEN, tokenData.access_token, { ...cookieBase(), maxAge: 60 * 60 })
        if (tokenData.refresh_token) {
          res.cookies.set(COOKIE_REFRESH, tokenData.refresh_token, { ...cookieBase(), maxAge: 60 * 60 * 24 * 30 })
        }
        return res
      }
    } catch (e) {
      console.error('[google-callback] PKCE exchange error:', e)
    }
    return NextResponse.redirect(`${SITE_URL}/account?auth_error=google_failed`)
  }

  // ── Case B: Implicit flow — #access_token= in hash ───────
  // Hash is never sent to the server. Return an HTML page that:
  // 1. Reads the hash client-side
  // 2. POSTs to /api/auth/session to set httpOnly cookies
  // 3. Redirects to /account
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Signing you in…</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
           font-family: Arial, sans-serif; background: #f4f0eb; }
    .box { text-align: center; }
    .spinner { width: 36px; height: 36px; border: 3px solid #e8e3db; border-top-color: #1a3a1e;
               border-radius: 50%; animation: spin 0.9s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    p { color: #888; font-size: 14px; margin: 0; }
  </style>
</head>
<body>
  <div class="box">
    <div class="spinner"></div>
    <p>Signing you in…</p>
  </div>
  <script>
    (async function () {
      try {
        var hash = window.location.hash.replace(/^#/, '')
        var params = new URLSearchParams(hash)
        var accessToken  = params.get('access_token')
        var refreshToken = params.get('refresh_token') || ''

        if (!accessToken) {
          // No token in hash — just go to account, it will show login wall
          window.location.href = '/account'
          return
        }

        // Write httpOnly cookie via session API
        await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set', access_token: accessToken, refresh_token: refreshToken }),
        })

        // Go to account — useAuth.init() will now find the cookie
        window.location.href = '/account'
      } catch (e) {
        console.error('[google-callback] hash handler error:', e)
        window.location.href = '/account'
      }
    })()
  </script>
</body>
</html>`

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
