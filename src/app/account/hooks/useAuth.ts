'use client'
// ─────────────────────────────────────────────────────────────
// useAuth — auth state machine + session management
//
// States: idle → loading → authenticated | failed | expired
//  ✅ Proper state machine (not raw booleans)
//  ✅ Session expiry detection
//  ✅ Uses profileService (retry, timeout, zod)
//  ✅ Functional setProfile (no stale closure)
// ─────────────────────────────────────────────────────────────

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useUserStore } from '@/store/userStore'
import { fetchProfile, checkSession, type Profile } from '@/lib/services/profileService'

export type AuthState = 'idle' | 'loading' | 'authenticated' | 'expired' | 'failed'

export interface AuthUser {
  id?:    string | number
  email?: string
  phone?: string
  [key: string]: unknown
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

  const loaded   = authState !== 'idle' && authState !== 'loading'
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
      const session = await checkSession()
      if (!session.loggedIn) { setAuthState('idle'); return }
      const data = await fetchProfile()
      if (!data.profile) { setAuthState('failed'); return }
      setProfile(data.profile)
      setAuthUser((data.user ?? null) as AuthUser | null)
      setAuthState('authenticated')
      syncStore(data.profile, (data.user ?? null) as AuthUser | null)
    } catch {
      setAuthState('failed')
    }
  }, [])

  async function logout() {
    try {
      await Promise.allSettled([
        fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body:   JSON.stringify({ action: 'clear' }),
          signal: AbortSignal.timeout(5000),
        }),
        fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body:   JSON.stringify({ action: 'logout' }),
          signal: AbortSignal.timeout(5000),
        }),
      ])
    } catch (err) {
      console.error('[useAuth] logout error:', err)
    }
    // Always clear local state regardless of server response
    setProfile(null)
    setAuthUser(null)
    setAuthState('idle')
    storeLogout()
    router.push('/')
  }

  function markExpired() { setAuthState('expired') }

  function updateLocalProfile(updates: Partial<Profile>) {
    setProfile(prev => mergeProfile(prev, updates))
  }

  const token = loggedIn ? '__cookie__' : null
  function setToken(_t: string) { /* no-op */ }

  return { authState, loaded, loggedIn, expired, profile, authUser, init, logout, markExpired, updateLocalProfile, token, setToken }
}
