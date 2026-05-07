'use client'

// ═══════════════════════════════════════════════════════════════
// GoogleAuthHandler — runs on every page, invisible component.
// Catches ?code= from Supabase PKCE redirect and exchanges it
// for tokens, then saves session exactly like the old site did.
// Must be rendered inside layout.tsx (already done via Providers).
// ═══════════════════════════════════════════════════════════════

import { useEffect } from 'react'
import { useUserStore } from '@/store/userStore'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export default function GoogleAuthHandler() {
  const setUser = useUserStore(s => s.setUser)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code   = params.get('code')
    if (!code) return

    // Only handle if this looks like an OAuth code (not some other ?code= usage)
    const verifier = localStorage.getItem('pr_pkce_verifier') || ''

    // Clean URL immediately so no re-run on refresh
    const cleanUrl = window.location.pathname
    window.history.replaceState({}, '', cleanUrl)
    localStorage.removeItem('pr_pkce_verifier')

    ;(async () => {
      try {
        // Exchange code + verifier for tokens via Supabase PKCE
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

        // Sync profile via our /api/auth endpoint
        const profileRes = await fetch('/api/auth', {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + tokenData.access_token,
          },
          body: JSON.stringify({ action: 'get_profile' }),
        })
        const profileData = await profileRes.json()

        // Save session to localStorage (same keys as old site)
        try { localStorage.setItem('pr_auth_token',   tokenData.access_token) } catch {}
        try { localStorage.setItem('pr_auth_refresh', tokenData.refresh_token || '') } catch {}
        if (profileData.profile) {
          try { localStorage.setItem('pr_auth_profile', JSON.stringify(profileData.profile)) } catch {}
        }

        // Update Zustand store
        setUser({
          id:    profileData.user?.id    || tokenData.user?.id    || '',
          email: profileData.user?.email || tokenData.user?.email || '',
          name:  profileData.profile?.first_name || '',
          phone: profileData.profile?.phone      || '',
        })

        // Show welcome toast if available
        const firstName = profileData.profile?.first_name || 'there'
        console.log(`✅ Google login success — Welcome ${firstName}!`)

        // Reload to refresh server components (header avatar etc.)
        window.location.reload()
      } catch (e) {
        console.error('[GoogleAuth] Error:', e)
      }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
