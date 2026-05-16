'use client'

// ═══════════════════════════════════════════════════════════════
// GoogleAuthHandler — runs on every page, invisible component.
//
// Handles two fallback cases for Google OAuth tokens that arrive
// client-side (e.g. old links, Supabase implicit flow):
//   1. ?code= in query string  → PKCE exchange + set cookie
//   2. #access_token= in hash  → call google_callback + set cookie
//
// The primary path (server-side callback) now writes cookies
// directly in /api/auth/google-callback and redirects to /account,
// so this handler is only a safety net.
// ═══════════════════════════════════════════════════════════════

import { useEffect } from 'react'
import { useUserStore } from '@/store/userStore'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function writeSessionCookie(accessToken: string, refreshToken?: string) {
  try {
    await fetch('/api/auth/session', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'set', access_token: accessToken, refresh_token: refreshToken }),
    })
  } catch (e) {
    console.warn('[GoogleAuth] Could not write session cookie:', e)
  }
}

export default function GoogleAuthHandler() {
  const setUser = useUserStore(s => s.setUser)

  useEffect(() => {
    // ── Case 1: ?code= PKCE flow ─────────────────────────────
    const params   = new URLSearchParams(window.location.search)
    const code     = params.get('code')
    const verifier = localStorage.getItem('pr_pkce_verifier') || ''

    // ── Case 2: #access_token= implicit / hash flow ──────────
    const hash        = window.location.hash
    const hashParams  = new URLSearchParams(hash.replace(/^#/, ''))
    const hashToken   = hashParams.get('access_token')
    const hashRefresh = hashParams.get('refresh_token') || ''

    if (!code && !hashToken) return

    // Clean URL immediately to prevent re-runs on refresh
    window.history.replaceState({}, '', window.location.pathname)
    localStorage.removeItem('pr_pkce_verifier')

    ;(async () => {
      try {
        let accessToken  = ''
        let refreshToken = ''

        if (hashToken) {
          // ── Hash token path: call google_callback to sync profile + set cookie ──
          accessToken  = hashToken
          refreshToken = hashRefresh

          const cbRes  = await fetch('/api/auth', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'google_callback', access_token: accessToken, refresh_token: refreshToken }),
          })
          const cbData = await cbRes.json()

          if (cbData.success) {
            // Cookie is set by google_callback via withAuthCookies
            setUser({
              id:    cbData.user?.id    || '',
              email: cbData.user?.email || '',
              name:  cbData.profile?.first_name || '',
              phone: cbData.profile?.phone      || '',
            })
            window.location.href = '/account'
            return
          }
          console.error('[GoogleAuth] google_callback failed:', cbData)
          return
        }

        if (code) {
          // ── Code path: PKCE exchange ──────────────────────────
          const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
            body:    JSON.stringify({ auth_code: code, code_verifier: verifier }),
          })
          const tokenData = await tokenRes.json()
          if (!tokenData.access_token) {
            console.error('[GoogleAuth] PKCE exchange failed:', tokenData)
            return
          }
          accessToken  = tokenData.access_token
          refreshToken = tokenData.refresh_token || ''

          // Write httpOnly cookie
          await writeSessionCookie(accessToken, refreshToken)

          // Sync profile
          const profileRes  = await fetch('/api/profile')
          const profileData = await profileRes.json()

          setUser({
            id:    profileData.user?.id    || '',
            email: profileData.user?.email || '',
            name:  profileData.profile?.first_name || '',
            phone: profileData.profile?.phone      || '',
          })

          window.location.href = '/account'
        }
      } catch (e) {
        console.error('[GoogleAuth] Error:', e)
      }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
