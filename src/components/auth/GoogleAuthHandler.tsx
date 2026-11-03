'use client'

// ═══════════════════════════════════════════════════════════════
// GoogleAuthHandler — runs on every page, invisible component.
//
// AUDIT (auth-B #1 / #7): this component used to ALSO consume `#access_token=…` / `?code=` on
// /auth/google-callback, racing the page of the same route (both read the hash, both posted a session;
// whichever finished last won, and if the page's redirect to /account won, `pr-user` was never set), and
// it accepted unbound tokens from the URL (login CSRF / session fixation).
//
// The OAuth return is now consumed in exactly ONE place — src/app/auth/google-callback/page.tsx via
// lib/auth/googleLogin.ts, using a PKCE code bound to this browser by an HttpOnly cookie. This component
// no longer touches OAuth codes or tokens on any route.
//
// What remains: password-reset e-mail links that landed on the wrong page (Supabase falls back to the
// Site URL when redirect_to is not allow-listed) are forwarded to /reset-password with the hash intact —
// the token is NEVER consumed here, only handed to the reset page (AUDIT S2-001).
// ═══════════════════════════════════════════════════════════════

import { useEffect } from 'react'
import { recoveryLandingTarget, isSignupConfirmationHash } from '@/app/reset-password/resetPasswordHelpers'

export const GOOGLE_CALLBACK_PATH = '/auth/google-callback'

export default function GoogleAuthHandler() {
  useEffect(() => {
    const forward = recoveryLandingTarget(window.location.pathname, window.location.hash)
    if (forward) { window.location.replace(forward); return }
    // Sign-up verification link: the e-mail address is now confirmed on Supabase's side; the customer just has to sign in.
    // The tokens in the hash are never used — drop them from the URL right away (the page keeps ?verified=1 for its message).
    if (isSignupConfirmationHash(window.location.hash)) {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search) } catch { /* ignore */ }
    }
  }, [])

  return null
}
