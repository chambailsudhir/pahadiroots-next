import { createHash, randomBytes } from 'node:crypto'

/** RFC 7636 code_verifier: 32 random bytes, base64url (43 chars). */
export function generatePkceVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/** RFC 7636 S256 code_challenge = BASE64URL(SHA256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/** A verifier we would ever have issued (guards against junk cookies reaching GoTrue). */
export function isPlausibleVerifier(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(v)
}
