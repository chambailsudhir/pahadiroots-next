// ─────────────────────────────────────────────────────────────
// Account API client — single fetch wrapper with retry logic
// ─────────────────────────────────────────────────────────────

import { AUTH_ACTIONS } from './constants'

const TIMEOUT_MS = 10_000

async function callAuth(action: string, body: Record<string,unknown> = {}, token?: string | null) {
  const headers: Record<string,string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = 'Bearer ' + token

  const ctrl = new AbortController()
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  try {
    const res  = await fetch('/api/auth', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, ...body }),
      signal: ctrl.signal,
    })
    clearTimeout(tid)
    const data = await res.json()
    if (!res.ok) {
      const err = new Error(data.error || `API error ${res.status}`) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    return data
  } catch (e) {
    clearTimeout(tid)
    throw e
  }
}

async function withTokenRefresh<T>(
  fn: (token: string) => Promise<T>,
  token: string,
  onNewToken: (t: string) => void
): Promise<T> {
  try {
    return await fn(token)
  } catch {
    const refresh = storage.getRefreshToken()
    if (!refresh) throw new Error('Session expired. Please login again.')
    const r = await callAuth(AUTH_ACTIONS.REFRESH_TOKEN, { refresh_token: refresh })
    if (!r.access_token) throw new Error('Session expired. Please login again.')
    storage.saveToken(r.access_token)
    if (r.refresh_token) storage.saveRefreshToken(r.refresh_token)
    onNewToken(r.access_token)
    return await fn(r.access_token)
  }
}

// ── Public API methods ────────────────────────────────────────

export const accountApi = {
  getProfile: (token: string) =>
    callAuth(AUTH_ACTIONS.GET_PROFILE, {}, token),

  getOrders: (token: string, onNewToken: (t: string) => void) =>
    withTokenRefresh(
      (tk) => callAuth(AUTH_ACTIONS.GET_ORDERS, {}, tk),
      token,
      onNewToken
    ),

  updateProfile: (token: string, data: Record<string,unknown>) =>
    callAuth(AUTH_ACTIONS.UPDATE_PROFILE, data, token),

  changePassword: (token: string, newPassword: string) =>
    callAuth(AUTH_ACTIONS.CHANGE_PASSWORD, { new_password: newPassword }, token),

  refreshToken: (refreshToken: string) =>
    callAuth(AUTH_ACTIONS.REFRESH_TOKEN, { refresh_token: refreshToken }),

  logout: (token: string | null) =>
    callAuth(AUTH_ACTIONS.LOGOUT, {}, token),
}

// ── Storage helpers ───────────────────────────────────────────
// Isolated in one place — easy to swap to cookies later

export const storage = {
  getToken:        () => { try { return localStorage.getItem('pr_auth_token') }   catch { return null } },
  getRefreshToken: () => { try { return localStorage.getItem('pr_auth_refresh') } catch { return null } },
  saveToken:       (t: string) => { try { localStorage.setItem('pr_auth_token', t) }   catch {} },
  saveRefreshToken:(t: string) => { try { localStorage.setItem('pr_auth_refresh', t) } catch {} },
  getProfile:      () => { try { return JSON.parse(localStorage.getItem('pr_auth_profile') || 'null') } catch { return null } },
  saveProfile:     (p: unknown) => { try { localStorage.setItem('pr_auth_profile', JSON.stringify(p)) } catch {} },
  clearAll:        () => { try { ['pr_auth_token','pr_auth_user','pr_auth_profile','pr_auth_refresh'].forEach(k => localStorage.removeItem(k)) } catch {} },
}
