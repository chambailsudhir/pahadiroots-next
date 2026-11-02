'use client'

import { ga4Login } from '@/lib/analytics/ga4'
import { useUserStore } from '@/store/userStore'
import { buildCacheEntry, writeProfileCache, prefetchProfileToCache } from '@/lib/profileCache'

/**
 * The ONLY client-side consumer of a Google OAuth return (used by /auth/google-callback).
 *
 * The authorization `code` is posted to the server, which exchanges it using the PKCE verifier held in the
 * HttpOnly cookie that THIS browser received when it started the flow. A code minted for someone else's
 * browser (login CSRF / session fixation) therefore cannot be redeemed here. No access/refresh token is
 * ever accepted from the URL.
 */
export async function completeGoogleLogin(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/auth', {
      method:      'POST',
      credentials: 'same-origin',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ action: 'google_callback', code }),
    })
    const data = await res.json().catch(() => ({})) as {
      success?: boolean; error?: string
      user?: { id?: string; email?: string }
      profile?: ({ first_name?: string; phone?: string } & Record<string, unknown>) | null
    }
    if (!res.ok || !data.success) return { ok: false, error: data.error || 'Google login failed' }

    useUserStore.getState().setUser({
      id:    data.user?.id    || '',
      email: data.user?.email || '',
      name:  data.profile?.first_name || '',
      phone: data.profile?.phone      || '',
    })
    if (data.profile) writeProfileCache(buildCacheEntry(data.profile as unknown as Parameters<typeof buildCacheEntry>[0]))
    prefetchProfileToCache() // background: saved_addresses too
    ga4Login('google')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Google login failed' }
  }
}
