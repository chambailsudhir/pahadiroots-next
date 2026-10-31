import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Signed, expiring newsletter-confirmation tokens (double opt-in).
 *
 * Why this exists (audit C-11): the public `subscribe` action used to subscribe ANY address it was given and email
 * that address a coupon, so anyone could subscribe a stranger or use the endpoint to spam an inbox. Now `subscribe`
 * only emails a confirmation link; the address is subscribed (and the coupon sent) only when its owner opens it.
 *
 * Stateless on purpose — no new table or column: the link carries the email, name, source and an expiry, signed with
 * HMAC-SHA256. The signing key is DERIVED from the Supabase service key (always configured in production, never
 * exposed to browsers), so no new environment variable has to be set.
 */

export const SUBSCRIBE_TOKEN_TTL_MS = 48 * 60 * 60 * 1000

export interface SubscribePayload { email: string; name: string | null; source: string | null }

function key(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_KEY
  if (!secret) throw new Error('SUPABASE_SERVICE_KEY is not configured — cannot sign subscribe tokens')
  return createHmac('sha256', secret).update('hv-subscribe-confirm-v1').digest()
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const sign = (body: string) => createHmac('sha256', key()).update(body).digest()

export function createSubscribeToken(p: SubscribePayload, now = Date.now()): string {
  const body = b64(JSON.stringify({ e: p.email, n: p.name, s: p.source, x: now + SUBSCRIBE_TOKEN_TTL_MS }))
  return `${body}.${b64(sign(body))}`
}

export type VerifyResult =
  | { ok: true; payload: SubscribePayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' }

export function verifySubscribeToken(token: string, now = Date.now()): VerifyResult {
  if (typeof token !== 'string' || token.length < 10 || token.length > 2000) return { ok: false, reason: 'malformed' }
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' }
  const [body, sig] = parts
  // sign() throws when the signing key is not configured. That is OUR fault, not a bad link, so it is deliberately NOT
  // caught here — the caller turns it into a 5xx instead of telling a customer their valid link is invalid.
  const expected = sign(body)
  let given: Buffer
  try { given = Buffer.from(sig, 'base64url') } catch { return { ok: false, reason: 'malformed' } }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad_signature' }
  let data: { e?: unknown; n?: unknown; s?: unknown; x?: unknown }
  try { data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return { ok: false, reason: 'malformed' } }
  if (typeof data.e !== 'string' || !data.e.includes('@') || typeof data.x !== 'number') return { ok: false, reason: 'malformed' }
  if (data.x < now) return { ok: false, reason: 'expired' }
  return { ok: true, payload: { email: data.e, name: typeof data.n === 'string' ? data.n : null, source: typeof data.s === 'string' ? data.s : null } }
}
