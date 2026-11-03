'use client'
// ─────────────────────────────────────────────────────────────
// useAuth — auth state machine + session management
//
// States:
//  idle      → init not called yet
//  loading   → checking session / fetching profile
//  guest     → session checked, not logged in  ← FIXED (was 'idle' causing infinite spinner)
//  authenticated → logged in, profile loaded
//  expired   → session expired mid-session
//  failed    → API error during init
// ─────────────────────────────────────────────────────────────

import { clearClientPII } from '@/lib/clientLogout'
import { useState, useCallback, useRef } from 'react'
import { useUserStore } from '@/store/userStore'
import { fetchProfile, ServiceError, type Profile } from '@/lib/services/profileService'

export type AuthState = 'idle' | 'loading' | 'guest' | 'authenticated' | 'expired' | 'failed'

export interface AuthUser {
  id?:             string | number
  email?:          string
  phone?:          string
  // Supabase stores provider-specific profile data (e.g. Google avatar_url, full_name)
  // under user_metadata.  Typed as a record with unknown values since the keys vary
  // by auth provider.  Callers must narrow each field before use (see Sidebar.tsx).
  user_metadata?:  Record<string, unknown>
}

export type { Profile }

export function useAuth() {
  const storeLogout     = useUserStore(s => s.logout)
  const storeSetUser    = useUserStore(s => s.setUser)
  const storeSetWishlist = useUserStore(s => s.setWishlist)
  const initDone        = useRef(false)
  const loggingOut      = useRef(false)
  const [isLoggingOut, setLoggingOut] = useState(false)

  const [authState, setAuthState] = useState<AuthState>('idle')
  const [profile,   setProfile]   = useState<Profile | null>(null)
  const [authUser,  setAuthUser]  = useState<AuthUser | null>(null)

  // loaded = init has completed (any terminal state)
  const loaded   = authState === 'guest' || authState === 'authenticated' || authState === 'expired' || authState === 'failed'
  const loggedIn = authState === 'authenticated'
  const expired  = authState === 'expired'

  function mergeProfile(current: Profile | null, updates: Partial<Profile>): Profile {
    return { ...(current ?? {}), ...updates }
  }

  const syncStore = useCallback((prof: Profile | null, user: AuthUser | null) => {
    storeSetUser({
      // ONE canonical id for the store user: the AUTH uuid (what login / Google sign-in set). It used to be replaced here by the
      // numeric customers.id the first time /account loaded, so `wishlistOwner` no longer matched and every re-login dropped the
      // local wishlist (and a guest's hearts could be lost to the flip). The store id is only an opaque owner key.
      id:    String(user?.id || prof?.id || ''),
      phone: (prof?.phone || user?.phone || '').replace(/^\+91/, ''),
      email: String(user?.email || prof?.email || ''),
      name:  prof?.first_name || '',
    })
  }, [storeSetUser])

  const init = useCallback(async () => {
    if (initDone.current) return
    initDone.current = true
    // No persisted user means nobody has logged in from this browser: a guest. Skip the profile call (it would 401,
    // log a console error and bill a serverless invocation). Login always sets the store user, so a real customer passes.
    if (!useUserStore.getState().user) { setAuthState('guest'); return }
    setAuthState('loading')
    try {
      const data = await fetchProfile()
      if (!data.profile) {
        setAuthState('guest')
        return
      }
      setProfile(data.profile)
      setAuthUser((data.user ?? null) as AuthUser | null)
      setAuthState('authenticated')
      syncStore(data.profile, (data.user ?? null) as AuthUser | null)

      fetch('/api/wishlist')
        .then(r => r.ok ? r.json() : null)
        .then(json => {
          if (Array.isArray(json?.wishlist)) {
            storeSetWishlist(json.wishlist)
          }
        })
        .catch((err: unknown) => {
          // BUG FIX [ERROR HANDLING]: previously completely silent. If the
          // wishlist fetch fails on login (expired token race, /api/wishlist 500),
          // there was zero trace — ops couldn't distinguish "wishlist API broken"
          // from "users just have empty wishlists". Non-fatal is still correct
          // (local wishlist still works), but it must be visible in logs.
          console.warn('[useAuth] wishlist fetch failed:', err)
        })
    } catch (err: unknown) {
      if (err instanceof ServiceError && err.status === 401) {
        // The persisted user is stale: the server no longer accepts the session. Clear it everywhere (AUDIT E1-9).
        clearClientPII()
        storeLogout()
        setAuthState('expired')
      } else {
        setAuthState('failed')
      }
    }
  }, [syncStore, storeSetWishlist, storeLogout])

  // Soft retry: resets the init gate so init() can re-run without a full
  // page reload. Used by the "Try Again" button in the failed state.
  const retry = useCallback(() => {
    initDone.current = false
    init()
  }, [init])

  /** POST a JSON action; true only for a 2xx answer. */
  async function postOk(url: string, action: string): Promise<boolean> {
    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
        signal:  AbortSignal.timeout(5000),
      })
      return !!res && res.ok
    } catch {
      return false
    }
  }

  async function clearServerSessionOnce(): Promise<boolean> {
    const results = await Promise.all([
      postOk('/api/auth/session', 'clear'),
      postOk('/api/auth', 'logout'),
    ])
    return results.every(Boolean)
  }

  /**
   * Resolves true when the server session was really cleared (and the page is navigating home), false when it could
   * not be — in that case the signed-in UI is left as it is so the user can retry (AUDIT E1-4).
   */
  async function logout(): Promise<boolean> {
    if (loggingOut.current) return true   // already in progress — not a failure
    loggingOut.current = true
    setLoggingOut(true)
    try {
      // AUDIT ACC-040: wipe checkout PII first so it goes even if the network calls hang.
      clearClientPII()
      // Persisted `pr-user` goes synchronously too (shared device / tab closed mid-request).
      storeLogout()
      let ok = await clearServerSessionOnce()
      if (!ok) ok = await clearServerSessionOnce()   // one retry
      if (!ok) {
        console.error('[useAuth] logout: server session was not cleared')
        return false
      }
      clearClientPII()   // a profile prefetch racing the request may have re-written the cache
      setProfile(null)
      setAuthUser(null)
      setAuthState('guest')
      // full reload (like performHeaderLogout) so every store/SWR cache starts clean
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/')
      return true
    } finally {
      loggingOut.current = false
      setLoggingOut(false)
    }
  }

  // AUDIT E1-9: an expired/revoked session used to leave `pr-user` + the checkout cache behind, so the rest of the
  // app (MobileBottomNav, header) still believed the visitor was signed in while /account showed the login wall.
  function markExpired() {
    clearClientPII()
    storeLogout()
    setAuthState('expired')
  }

  function updateLocalProfile(updates: Partial<Profile>) {
    setProfile(prev => mergeProfile(prev, updates))
  }

  return {
    authState, loaded, loggedIn, expired,
    profile, authUser,
    init, retry, logout, markExpired, loggingOut: isLoggingOut,
    updateLocalProfile,
  }
}

