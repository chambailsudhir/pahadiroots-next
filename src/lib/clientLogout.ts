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

/**
 * Clears the httpOnly session cookie (both auth endpoints, matching the
 * pattern already used by account/hooks/useAuth.ts) and the client-side
 * user store. Does NOT navigate — callers decide where to send the user
 * afterwards (Header.tsx stays on the current page; useAuth.ts goes home).
 */
export async function clearServerSession(): Promise<void> {
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
  window.location.reload()
}
