// ═══════════════════════════════════════════════════════════════
// Google OAuth PKCE callback handler
// Supabase redirects here after Google login with ?code=...
// We exchange the code for tokens, then redirect user to homepage.
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SITE_URL      = process.env.NEXT_PUBLIC_SITE_URL || 'https://pahadiroots.com'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(`${SITE_URL}/?auth_error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return NextResponse.redirect(`${SITE_URL}/`)
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
      return NextResponse.redirect(`${SITE_URL}/?auth_error=google_failed`)
    }

    // Redirect to homepage with tokens in hash (client picks them up)
    // Using fragment so tokens never hit server logs
    const redirectUrl = `${SITE_URL}/?google_auth=1#access_token=${tokenData.access_token}&refresh_token=${tokenData.refresh_token || ''}&token_type=bearer`
    return NextResponse.redirect(redirectUrl)
  } catch (e) {
    console.error('Google callback error:', e)
    return NextResponse.redirect(`${SITE_URL}/?auth_error=google_failed`)
  }
}
