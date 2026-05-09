// ─────────────────────────────────────────────────────────────
// useAuth — auth init, session state, logout
//
// Token storage: httpOnly cookies (set by /api/auth/* routes)
// The client never sees or stores tokens.
// storage.getToken() / storage.saveToken() calls REMOVED.
//
// Flow:
//   1. On mount → GET /api/auth/session to check if cookie exists
//   2. If logged in → GET /api/profile to fetch profile data
//   3. On logout → POST /api/auth/session { action:'clear' } + POST /api/auth { action:'logout' }
// ─────────────────────────────────────────────────────────────
'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useUserStore } from '@/store/userStore'

export interface Profile {
  id?:             string | number
  first_name?:     string
  last_name?:      string
  phone?:          string
  email?:          string
  address_line1?:  string
  city?:           string
  state?:          string
  postal_code?:    string
  saved_addresses?: string
  [key: string]: unknown
}

export interface AuthUser {
  id?:    string | number
  email?: string
  phone?: string
  [key: string]: unknown
}

export function useAuth() {
  const router       = useRouter()
  const storeLogout  = useUserStore(s => s.logout)
  const storeSetUser = useUserStore(s => s.setUser)

  const initDone = useRef(false)

  const [profile,  setProfile]  = useState<Profile | null>(null)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [loaded,   setLoaded]   = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)

  function syncStore(prof: Profile | null, user: AuthUser | null) {
    storeSetUser({
      id:    String(prof?.id    || user?.id    || ''),
      phone: (prof?.phone || user?.phone || '').replace(/^\+91/, ''),
      email: String(user?.email || prof?.email || ''),
      name:  prof?.first_name || '',
    })
  }

  function mergeProfile(current: Profile | null, updates: Partial<Profile>): Profile {
    const base = current ? structuredClone(current) : {}
    return { ...base, ...updates }
  }

  const init = useCallback(async () => {
    if (initDone.current) return
    initDone.current = true

    try {
      // Step 1: check if httpOnly cookie session exists
      const sessionRes = await fetch('/api/auth/session')
      const session    = await sessionRes.json() as { loggedIn: boolean }
      if (!session.loggedIn) { setLoaded(true); return }

      // Step 2: fetch profile via dedicated route (reads cookie server-side)
      const profileRes  = await fetch('/api/profile')
      if (!profileRes.ok) { setLoaded(true); return }
      const profileData = await profileRes.json() as { profile?: Profile; user?: AuthUser }

      if (!profileData.profile) { setLoaded(true); return }
      setProfile(profileData.profile)
      setAuthUser((profileData.user ?? null) as AuthUser | null)
      setLoggedIn(true)
      setLoaded(true)
      syncStore(profileData.profile, (profileData.user ?? null) as AuthUser | null)
    } catch (err: unknown) {
      console.error('[useAuth] init failed:', err)
      setLoaded(true)
    }
  }, [])

  async function logout() {
    try {
      // Clear httpOnly cookies server-side
      await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear' }),
      })
      // Also call Supabase logout to invalidate the token
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      })
    } catch (err: unknown) {
      console.error('[useAuth] logout failed:', err)
    }
    setProfile(null)
    setAuthUser(null)
    setLoggedIn(false)
    storeLogout()
    router.push('/')
  }

  async function updateLocalProfile(updates: Partial<Profile>) {
    const np = mergeProfile(profile, updates)
    setProfile(np)
    // Also persist to server
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
    } catch (err: unknown) {
      console.warn('[useAuth] background profile sync failed:', err)
    }
  }

  // token prop kept for backward compat with useOrders/useProfile
  // but it's now a sentinel — actual auth is cookie-based
  const token = loggedIn ? '__cookie__' : null
  function setToken(_t: string) { /* no-op: tokens managed server-side */ }

  return { token, profile, authUser, loaded, loggedIn, init, logout, updateLocalProfile, setToken }
}
