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
 *   - Only runs if pr_auth_token is present (user is logged in)
 *   - Only fetches if cache is missing or older than 30 min
 *   - Fire-and-forget: doesn't block rendering at all
 *
 * RESULT: By the time a logged-in user navigates cart → checkout,
 * the profile cache is already warm → form fills in useState initializer
 * → zero visible delay, not even a flicker.
 */

import { useEffect } from 'react'
import { isProfileCacheStale, prefetchProfileToCache } from '@/lib/profileCache'

export default function ProfilePrefetcher() {
  useEffect(() => {
    // Only run for logged-in users
    const token = typeof window !== 'undefined'
      ? localStorage.getItem('pr_auth_token')
      : null
    if (!token) return

    // Only fetch if cache is missing or stale — not on every page visit
    if (isProfileCacheStale()) {
      prefetchProfileToCache() // fire-and-forget
    }
  }, []) // run once on mount

  return null // renders nothing
}
