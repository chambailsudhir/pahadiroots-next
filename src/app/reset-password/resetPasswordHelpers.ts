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
