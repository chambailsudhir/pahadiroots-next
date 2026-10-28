'use client'

// ─────────────────────────────────────────────────────────────────────────────
// lib/clientLogout.ts
//
// BUG FIX (homepage audit — P1): Header.tsx's account dropdown had a
// "Logout" button styled as a real sign-out control (red background, danger
// color) that was actually just `<Link href="/account">` — it never cleared
// the httpOnly session cookie or the client-side user store. Anyone who
// clicked it on a shared/public device stayed fully logged in.
//
// The ONLY correct logout existed inside account/hooks/useAuth.ts, tied to
// that hook's own profile/authUser state machine, so Header.tsx (which only
// has useUserStore, not useAuth) had no working equivalent to call.
//
// Fix: pull the real logout mechanics (clear session cookie via 2 API
// calls, clear the user store, redirect home) into one shared helper. Both
// Header.tsx and account/hooks/useAuth.ts can now call the same source of
// truth, so this class of bug — a second "logout" that quietly doesn't log
// out — can't reappear in a third place later.
//
// useAuth.ts is intentionally left as-is (it also resets its own local
// profile/authUser/authState, which this helper knows nothing about) to
// avoid touching a working, already-audited flow. This helper covers the
// cookie + store clearing subset that both call sites need in common.
// ─────────────────────────────────────────────────────────────────────────────

import { useUserStore } from '@/store/userStore'
import { clearProfileCache } from '@/lib/profileCache'

// AUDIT S2-006: localStorage keys that hold (or historically held) a signed-in
// customer's PII or credentials. `pr_checkout_profile` (name, email, phone,
// address, saved addresses — profileCache.ts) was NEVER cleared on logout, so
// the next shopper on a shared device got the previous user's details
// prefilled at checkout. The pr_auth_* keys are legacy (tokens moved to
// httpOnly cookies) but are still wiped in case an old build left them behind.
// The `pr-user` zustand blob is handled by useUserStore.logout() (user and
// savedAddresses are nulled and re-persisted; the wishlist — product ids only —
// is intentionally kept, see userStore.ts).
export const CLIENT_PII_STORAGE_KEYS = [
  'pr_pkce_verifier',
  'pr_auth_token',
  'pr_auth_refresh',
  'pr_auth_profile',
] as const

/**
 * Remove every client-side PII cache for the current user. Safe to call on
 * the server (no-op) and when storage is unavailable (private mode / quota).
 */
export function clearClientPII(): void {
  if (typeof window === 'undefined') return
  clearProfileCache()
  for (const key of CLIENT_PII_STORAGE_KEYS) {
    try { localStorage.removeItem(key) } catch {}
  }
}

/**
 * Clears the httpOnly session cookie (both auth endpoints, matching the
 * pattern already used by account/hooks/useAuth.ts) and the client-side
 * user store. Does NOT navigate — callers decide where to send the user
 * afterwards (Header.tsx stays on the current page; useAuth.ts goes home).
 */
export async function clearServerSession(): Promise<void> {
  // AUDIT S2-006: wipe local PII FIRST — it must go even if the network calls
  // below hang or fail (offline logout on a shared device).
  clearClientPII()
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
    console.error('[clientLogout] failed to clear server session:', err)
  }
}

/**
 * Full client-side logout for components that only have access to
 * useUserStore (e.g. the global Header) — clears the server session,
 * then clears the local user store. Reloads the current page afterward so
 * every piece of UI reading useUserStore (avatar, wishlist badge, account
 * dropdown) immediately reflects the logged-out state.
 */
export async function performHeaderLogout(): Promise<void> {
  await clearServerSession()
  useUserStore.getState().logout()
  // AUDIT S2-006: a profile prefetch racing the logout could have re-written
  // the checkout cache while the network calls were in flight — clear again.
  clearClientPII()
  window.location.reload()
}
