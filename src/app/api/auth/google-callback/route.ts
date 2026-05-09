// ═══════════════════════════════════════════════════════════════
// Google OAuth callback handler
// Supabase redirects here after Google login with ?code=...
// We exchange the code for tokens, write httpOnly cookies,
// then redirect user directly to /account.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_TOKEN, COOKIE_REFRESH } from '@/lib/auth/cookies'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SITE_URL      = process.env.NEXT_PUBLIC_SITE_URL || 'https://pahadiroots.com'
const IS_PROD       = process.env.NODE_ENV === 'production'

function cookieBase() {
  return { httpOnly: true, secure: IS_PROD, sameSite: 'lax' as const, path: '/' }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(`${SITE_URL}/account?auth_error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return NextResponse.redirect(`${SITE_URL}/account`)
  }

  try {
    // Exchange auth code for tokens using Supabase PKCE flow
    const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON,
      },
      body: JSON.stringify({ auth_code: code }),
    })

    const tokenData = await tokenRes.json()

    if (!tokenData.access_token) {
      console.error('Google PKCE exchange failed:', tokenData)
      return NextResponse.redirect(`${SITE_URL}/account?auth_error=google_failed`)
    }

    // ✅ Write httpOnly cookies server-side so /api/auth/session sees them immediately
    const res = NextResponse.redirect(`${SITE_URL}/account`)
    res.cookies.set(COOKIE_TOKEN,   tokenData.access_token,          { ...cookieBase(), maxAge: 60 * 60 })
    if (tokenData.refresh_token) {
      res.cookies.set(COOKIE_REFRESH, tokenData.refresh_token,       { ...cookieBase(), maxAge: 60 * 60 * 24 * 30 })
    }
    return res

  } catch (e) {
    console.error('Google callback error:', e)
    return NextResponse.redirect(`${SITE_URL}/account?auth_error=google_failed`)
  }
}
