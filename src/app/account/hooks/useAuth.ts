// ─────────────────────────────────────────────────────────────
// useAuth — handles init, login state, logout
// ─────────────────────────────────────────────────────────────
'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useUserStore } from '@/store/userStore'
import { accountApi, storage } from '@/lib/account/api'

export function useAuth() {
  const router       = useRouter()
  const storeLogout  = useUserStore(s => s.logout)
  const storeSetUser = useUserStore(s => s.setUser)

  const initDone  = useRef(false)
  const [token,    setToken]    = useState<string | null>(null)
  const [profile,  setProfile]  = useState<any>(null)
  const [authUser, setAuthUser] = useState<any>(null)
  const [loaded,   setLoaded]   = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)

  function syncStore(prof: any, user: any) {
    storeSetUser({
      id:    prof?.id    || user?.id    || '',
      phone: (prof?.phone || user?.phone || '').replace(/^\+91/,''),
      email: user?.email || prof?.email || '',
      name:  prof?.first_name || '',
    })
  }

  const init = useCallback(async () => {
    if (initDone.current) return
    initDone.current = true

    const tk     = storage.getToken()
    const cached = storage.getProfile()

    if (!tk) { setLoaded(true); return }

    // Fast path: use cached profile, refresh in background
    if (cached) {
      setProfile(cached)
      setToken(tk)
      setLoggedIn(true)
      setLoaded(true)
      syncStore(cached, null)
      // Background refresh
      accountApi.getProfile(tk)
        .then(d => { if (d.profile) { setProfile(d.profile); storage.saveProfile(d.profile); syncStore(d.profile, d.user) } if (d.user) setAuthUser(d.user) })
        .catch(() => {}) // silent — cached data already shown
      return
    }

    // No cache — fetch fresh
    try {
      const d = await accountApi.getProfile(tk)
      if (!d.profile) { setLoaded(true); return }
      setProfile(d.profile)
      setAuthUser(d.user)
      setToken(tk)
      setLoggedIn(true)
      setLoaded(true)
      storage.saveProfile(d.profile)
      syncStore(d.profile, d.user)
    } catch {
      // Token may be expired — try refresh
      const rt = storage.getRefreshToken()
      if (!rt) { setLoaded(true); return }
      try {
        const r = await accountApi.refreshToken(rt)
        if (!r.access_token) { setLoaded(true); return }
        storage.saveToken(r.access_token)
        if (r.refresh_token) storage.saveRefreshToken(r.refresh_token)
        const d = await accountApi.getProfile(r.access_token)
        setProfile(d.profile)
        setAuthUser(d.user)
        setToken(r.access_token)
        setLoggedIn(true)
        setLoaded(true)
        storage.saveProfile(d.profile)
        syncStore(d.profile, d.user)
      } catch {
        setLoaded(true)
      }
    }
  }, []) // eslint-disable-line

  async function logout() {
    try { await accountApi.logout(token) } catch {}
    storage.clearAll()
    storeLogout()
    router.push('/')
  }

  function updateLocalProfile(updates: any) {
    const np = { ...profile, ...updates }
    setProfile(np)
    storage.saveProfile(np)
  }

  return { token, profile, authUser, loaded, loggedIn, init, logout, updateLocalProfile, setToken }
}
