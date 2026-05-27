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

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
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
  const router       = useRouter()
  const storeLogout  = useUserStore(s => s.logout)
  const storeSetUser = useUserStore(s => s.setUser)
  const initDone     = useRef(false)

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

  function syncStore(prof: Profile | null, user: AuthUser | null) {
    storeSetUser({
      id:    String(prof?.id    || user?.id    || ''),
      phone: (prof?.phone || user?.phone || '').replace(/^\+91/, ''),
      email: String(user?.email || prof?.email || ''),
      name:  prof?.first_name || '',
    })
  }

  const init = useCallback(async () => {
    if (initDone.current) return
    initDone.current = true
    setAuthState('loading')
    try {
      // Single call — profile route handles token refresh internally.
      // 401 = not logged in (guest), anything else = error.
      const data = await fetchProfile()
      if (!data.profile) {
        // Logged in but no customer record yet — treat as guest
        setAuthState('guest')
        return
      }
      setProfile(data.profile)
      setAuthUser((data.user ?? null) as AuthUser | null)
      setAuthState('authenticated')
      syncStore(data.profile, (data.user ?? null) as AuthUser | null)
    } catch (err: unknown) {
      // 401 = no session / expired → guest (not an error)
      if (err instanceof ServiceError && err.status === 401) {
        setAuthState('guest')
      } else {
        setAuthState('failed')
      }
    }
  }, [])

  // Soft retry: resets the init gate so init() can re-run without a full
  // page reload. Used by the "Try Again" button in the failed state.
  const retry = useCallback(() => {
    initDone.current = false
    init()
  }, [init])

  async function logout() {
    try {
      await Promise.allSettled([
        fetch('/api/auth/session', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ action: 'clear' }),
          signal:  AbortSignal.timeout(5000),
        }),
        fetch('/api/auth', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ action: 'logout' }),
          signal:  AbortSignal.timeout(5000),
        }),
      ])
    } catch (err) {
      console.error('[useAuth] logout error:', err)
    }
    setProfile(null)
    setAuthUser(null)
    setAuthState('guest')
    storeLogout()
    router.push('/')
  }

  function markExpired() { setAuthState('expired') }

  function updateLocalProfile(updates: Partial<Profile>) {
    setProfile(prev => mergeProfile(prev, updates))
  }

  return {
    authState, loaded, loggedIn, expired,
    profile, authUser,
    init, retry, logout, markExpired,
    updateLocalProfile,
  }
}

