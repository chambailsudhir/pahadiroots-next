/** AUDIT (auth-B #4): server-side type + length checks for credentials-bearing auth actions. */
export const EMAIL_MAX    = 254
export const NAME_MAX     = 100
export const PASSWORD_MAX = 128
/** Login only: lenient (legacy passwords were never length-capped) but bounded so a huge body is not forwarded. */
export const LOGIN_PASSWORD_MAX = 1024

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Trimmed e-mail, or null when not a string / empty / too long / malformed. */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim()
  if (!e || e.length > EMAIL_MAX || !EMAIL_RE.test(e)) return null
  return e
}

/** undefined = absent/empty (fine), null = invalid (wrong type or too long), string = trimmed name. */
export function cleanName(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string') return null
  const n = v.trim()
  if (n.length > NAME_MAX) return null
  return n
}

export function isPasswordString(v: unknown, max = PASSWORD_MAX): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max
}
