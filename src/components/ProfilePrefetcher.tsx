'use client'

/**
 * src/components/ProfilePrefetcher.tsx
 *
 * Invisible component — place once inside <Providers> in root layout.tsx.
 *
 * WHY THIS EXISTS:
 *   AuthModal pre-caches profile at login time (new logins ✅).
 *   But users who are *already* logged in (cookie still valid, cache stale/expired)
 *   would still hit a delay on checkout. This component covers them:
 *
 *   - Fires once per page load (useEffect, no re-fetches)
 *   - Only runs if the user has an active session (cookie-based check)
 *   - Only fetches if cache is missing or older than 30 min
 *   - Fire-and-forget: doesn't block rendering at all
 *
 * RESULT: By the time a logged-in user navigates cart → checkout,
 * the profile cache is already warm → form fills in useState initializer
 * → zero visible delay, not even a flicker.
 *
 * SEC-FIX: the previous implementation gated on
 *   localStorage.getItem('pr_auth_token')
 * The auth system was migrated to httpOnly cookies — pr_auth_token is never
 * written to localStorage by the current auth flow. This meant the prefetcher
 * was ALWAYS a no-op for every user, defeating its purpose entirely.
 *
 * Fix: call GET /api/auth/session — a cheap endpoint that returns
 * { loggedIn: boolean } by inspecting the httpOnly cookie server-side.
 * This is the correct way to check session state from a client component
 * when tokens are in httpOnly cookies (not readable by JS).
 */

import { useEffect } from 'react'
import { isProfileCacheStale, prefetchProfileToCache } from '@/lib/profileCache'

export default function ProfilePrefetcher() {
  useEffect(() => {
    // SEC-FIX: use the session API to check auth state instead of reading
    // localStorage. Tokens live in httpOnly cookies — not accessible to JS.
    // The session endpoint is a cheap HEAD-equivalent GET that reads the cookie
    // server-side and returns { loggedIn: boolean } without touching the DB.
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { loggedIn?: boolean } | null) => {
        if (!data?.loggedIn) return
        // Only fetch if cache is missing or stale — not on every page visit
        if (isProfileCacheStale()) {
          prefetchProfileToCache() // fire-and-forget
        }
      })
      .catch(() => { /* non-fatal — prefetch is best-effort */ })
  }, []) // run once on mount

  return null // renders nothing
}
