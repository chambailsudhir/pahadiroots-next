// AUDIT S2-001 — pure helpers for /reset-password (kept out of page.tsx so the
// page module only exports what Next allows, and so they can be unit-tested
// without rendering).

// Kept in sync with api/auth/route.ts (RESET_PASSWORD_MIN_LENGTH) — the server
// enforces the same floor; the client check only gives instant feedback.
export const RESET_PASSWORD_MIN_LENGTH = 8
export const RESET_PASSWORD_MAX_LENGTH = 128

// sessionStorage key — the hash is stripped from the URL on first render, so
// a reload must still be able to show the outcome instead of "invalid link".
export const RESET_RESULT_KEY = 'pr_reset_result'

/**
 * Parse a Supabase recovery hash. Only `type=recovery` tokens are accepted —
 * a Google/implicit login hash that somehow lands on this page must never be
 * turned into a password reset.
 */
export function parseRecoveryHash(hash: string): { token: string | null; error: string | null } {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const error  = params.get('error_description') || params.get('error')
  if (error) return { token: null, error: error.replace(/\+/g, ' ') }
  const token = params.get('access_token')
  if (!token || params.get('type') !== 'recovery') return { token: null, error: null }
  return { token, error: null }
}

export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < RESET_PASSWORD_MIN_LENGTH) return `Password must be at least ${RESET_PASSWORD_MIN_LENGTH} characters`
  if (password.length > RESET_PASSWORD_MAX_LENGTH) return 'Password is too long'
  if (password !== confirm) return 'Passwords do not match'
  return null
}

/**
 * A Supabase e-mail link that cannot be honoured on the page it was sent to lands on the SITE URL
 * (usually "/") when `redirect_to` is not in the project's redirect allow-list. Decide whether the
 * current location is such a landing and, if so, where it must be forwarded to so the customer reaches
 * the reset form (or the "link expired — send a new one" screen) instead of the home page.
 *   • a valid recovery token (`type=recovery` + `access_token`) on ANY route except /reset-password
 *   • an expired / already-used e-mail link (`error_code=otp_expired`) on the home page only
 *     (never on /auth/google-callback, where `access_denied` means the customer cancelled Google sign-in)
 * Returns the absolute-path target (hash preserved) or null when nothing should happen.
 */
export function recoveryLandingTarget(pathname: string, hash: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/reset-password') return null
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  if (params.get('type') === 'recovery' && params.get('access_token')) return '/reset-password' + hash
  if (path === '/' && params.get('error_code') === 'otp_expired') return '/reset-password' + hash
  return null
}

export function friendlyLinkError(raw: string | null): string {
  if (!raw) return 'This reset link is invalid or has expired.'
  if (/expired|invalid/i.test(raw)) return 'This reset link has expired or was already used. Reset links work only once and for a short time.'
  return raw
}
