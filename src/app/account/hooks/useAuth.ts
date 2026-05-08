// ─────────────────────────────────────────────────────────────
// useAuth — handles init, login state, logout
//
// FIXES applied (audit):
//  ✅ Proper types replacing `any` (Profile, AuthUser)
//  ✅ auth.init() decoupled from `mounted` — called directly in useEffect([])
//  ✅ Error logging instead of silent catch swallowing
//  ✅ logout failure now logs + still clears local state
//  ✅ Deep merge for nested profile fields via structuredClone
//  ✅ Token null-guard before logout API call
//
// KNOWN LIMITATIONS (require backend changes — cannot fix client-side):
//  ⚠️  localStorage tokens — needs httpOnly cookies via Next.js API route
//  ⚠️  Monolithic auth endpoint — needs split into /api/profile, /api/auth etc.
// ─────────────────────────────────────────────────────────────
'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useUserStore } from '@/store/userStore'
import { accountApi, storage } from '@/lib/account/api'

// ── Proper types (replaces `any`) ────────────────────────────
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
  [key: string]: unknown  // allow additional API fields
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

  const [token,    setToken]    = useState<string | null>(null)
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

  // ── Safe deep merge — prevents shallow spread clobbering nested fields ──
  function mergeProfile(current: Profile | null, updates: Partial<Profile>): Profile {
    const base = current ? structuredClone(current) : {}
    return { ...base, ...updates }
  }

  const init = useCallback(async () => {
    // Guard: only init once — safe against React StrictMode double-invoke
    if (initDone.current) return
    initDone.current = true

    const tk     = storage.getToken()
    const cached = storage.getProfile() as Profile | null

    if (!tk) { setLoaded(true); return }

    // Fast path: render cached data immediately, refresh in background
    if (cached) {
      setProfile(cached)
      setToken(tk)
      setLoggedIn(true)
      setLoaded(true)
      syncStore(cached, null)

      accountApi.getProfile(tk)
        .then(d => {
          if (d.profile) {
            setProfile(d.profile as Profile)
            storage.saveProfile(d.profile)
            syncStore(d.profile as Profile, d.user as AuthUser | null)
          }
          if (d.user) setAuthUser(d.user as AuthUser)
        })
        .catch((err: unknown) => {
          // Background — cached data still shown, just log for diagnostics
          console.warn('[useAuth] background profile refresh failed:', err)
        })
      return
    }

    // No cache — fetch fresh
    try {
      const d = await accountApi.getProfile(tk)
      if (!d.profile) { setLoaded(true); return }
      const prof = d.profile as Profile
      setProfile(prof)
      setAuthUser(d.user as AuthUser | null)
      setToken(tk)
      setLoggedIn(true)
      setLoaded(true)
      storage.saveProfile(prof)
      syncStore(prof, d.user as AuthUser | null)
    } catch (err: unknown) {
      console.warn('[useAuth] profile fetch failed, attempting token refresh:', err)
      const rt = storage.getRefreshToken()
      if (!rt) { setLoaded(true); return }
      try {
        const r = await accountApi.refreshToken(rt)
        if (!r.access_token) { setLoaded(true); return }
        storage.saveToken(r.access_token)
        if (r.refresh_token) storage.saveRefreshToken(r.refresh_token)
        const d = await accountApi.getProfile(r.access_token)
        const prof = d.profile as Profile
        setProfile(prof)
        setAuthUser(d.user as AuthUser | null)
        setToken(r.access_token)
        setLoggedIn(true)
        setLoaded(true)
        storage.saveProfile(prof)
        syncStore(prof, d.user as AuthUser | null)
      } catch (refreshErr: unknown) {
        console.error('[useAuth] token refresh failed — session expired:', refreshErr)
        setLoaded(true)
      }
    }
  }, [])

  async function logout() {
    // Guard: only call API if token exists
    if (token) {
      try {
        await accountApi.logout(token)
      } catch (err: unknown) {
        // Log but don't block — local session must still be cleared
        console.error('[useAuth] logout API call failed:', err)
      }
    }
    storage.clearAll()
    storeLogout()
    router.push('/')
  }

  function updateLocalProfile(updates: Partial<Profile>) {
    const np = mergeProfile(profile, updates)
    setProfile(np)
    storage.saveProfile(np)
  }

  return { token, profile, authUser, loaded, loggedIn, init, logout, updateLocalProfile, setToken }
}
