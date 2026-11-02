/**
 * AUDIT (auth-B #2): `reset_password` may only be driven by a token issued by a password-RECOVERY e-mail
 * link — never by an ordinary login session (stolen / unattended cookie, or a bearer from a normal login).
 *
 * GoTrue stamps every access token with an `amr` claim listing how the session was authenticated, e.g.
 *   password login       -> [{ method: 'password', ... }]
 *   Google               -> [{ method: 'oauth', ... }]
 *   recovery e-mail link -> [{ method: 'recovery', ... }]   (some GoTrue builds: 'otp')
 * The claim is signed; GoTrue verifies the signature again when the token is used on PUT /user, so
 * decoding it here (without verifying) can only ever make us stricter, never let a forged token through.
 */
const RECOVERY_METHODS = new Set(['recovery', 'otp'])

export function jwtAmrMethods(jwt: string): string[] {
  try {
    const part = jwt.split('.')[1]
    if (!part) return []
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { amr?: unknown }
    if (!Array.isArray(payload.amr)) return []
    return payload.amr
      .map(a => (typeof a === 'string' ? a : (a && typeof a === 'object' ? (a as { method?: unknown }).method : null)))
      .filter((m): m is string => typeof m === 'string')
  } catch {
    return []
  }
}

export function isRecoveryToken(jwt: string): boolean {
  return jwtAmrMethods(jwt).some(m => RECOVERY_METHODS.has(m))
}
