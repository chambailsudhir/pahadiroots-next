// lib/server/codVerification.ts — verification for RISKY cash-on-delivery orders (Nov 2026, owner decision).
//
// Most customers order without any extra step. Only a risky COD order is held:
//   • the phone already had a COD order refused at the door (RTO: status 'returned' with no delivery) → COD is not offered,
//     the customer pays online (owner setting `cod_block_after_rto`, default on);
//   • a FIRST order (no delivered order yet on this phone / e-mail / account), or a COD total above `cod_verify_above`
//     (default ₹1,500) → a 6-digit code is sent to the customer's e-mail and the order is placed once it is entered
//     (owner setting `cod_verification_enabled`, default on). The channel becomes WhatsApp once the Meta number is live.
// Codes and tokens are stored only as HMAC hashes bound to the phone + e-mail (table cod_verifications, db_migration_v35).
import 'server-only'
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { CheckoutRejectedError } from '@/lib/errors/checkoutErrors'

export const COD_CODE_TTL_MS      = 10 * 60_000
export const COD_TOKEN_TTL_MS     = 30 * 60_000
export const COD_MAX_ATTEMPTS     = 5
export const DEFAULT_VERIFY_ABOVE = 1500

export type CodRisk = 'ok' | 'verify' | 'blocked'

export interface CodRiskInput {
  settings:       Record<string, string | undefined>
  codTotal:       number
  deliveredCount: number   // delivered orders on this phone / e-mail / account (any payment method)
  rtoCount:       number   // COD orders refused at the door (returned without ever being delivered)
}

/** Pure decision, so it can be tested on its own and reused by the checkout hint. */
export function decideCodRisk({ settings, codTotal, deliveredCount, rtoCount }: CodRiskInput): CodRisk {
  if (settings.cod_block_after_rto !== 'false' && rtoCount > 0) return 'blocked'
  if (settings.cod_verification_enabled === 'false') return 'ok'
  const raw = Number(settings.cod_verify_above)
  const above = Number.isFinite(raw) && raw >= 0 && String(settings.cod_verify_above ?? '').trim() !== '' ? raw : DEFAULT_VERIFY_ABOVE
  if (deliveredCount === 0) return 'verify'
  if (codTotal > above) return 'verify'
  return 'ok'
}

function key(): string {
  const k = process.env.SUPABASE_SERVICE_KEY || process.env.CRON_SECRET || ''
  if (!k) throw new Error('codVerification: no server secret configured')
  return k
}
const norm = (email: string) => email.trim().toLowerCase()

export function hashCodCode(code: string, phone10: string, email: string): string {
  return createHmac('sha256', key()).update(`code|${phone10}|${norm(email)}|${code}`).digest('hex')
}
export function hashCodToken(token: string): string {
  return createHmac('sha256', key()).update(`token|${token}`).digest('hex')
}
export function newCodCode(): string { return String(randomInt(0, 1_000_000)).padStart(6, '0') }
export function newCodToken(): string { return randomBytes(32).toString('base64url') }

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function codVerificationEmailHtml(code: string): { subject: string; heading: string; bodyHtml: string } {
  return {
    subject:  `${code} is your HimVeda order verification code`,
    heading:  'Confirm your Cash on Delivery order',
    bodyHtml: `<p style="margin:0 0 12px">Use this code to confirm your Cash on Delivery order:</p>` +
      `<p style="margin:0 0 16px;font-size:30px;font-weight:700;letter-spacing:8px;color:#1a3a1e">${code}</p>` +
      `<p style="margin:0 0 12px">It is valid for 10 minutes. Do not share it with anyone — we will never ask for it on a call.</p>` +
      `<p style="margin:0;font-size:12px;color:#6b6256">Didn't try to place an order? You can ignore this e-mail.</p>`,
  }
}

// ── Order-time gate (used by the orders route through CreateOrderInput.codRiskGate) ──────────────────────────────────
type SbAdmin = (method: string, path: string, body?: unknown, prefer?: string) => Promise<unknown>

/**
 * Spend a verification token on ONE order (R4A-3, Nov 2026). Valid only when it was issued by /cod-verify/confirm for THIS
 * phone AND this order's e-mail within the last 30 minutes, and it is not yet used by another order. The claim is an atomic
 * conditional PATCH (used_at IS NULL), so parallel orders cannot share a token; a retry of the same order (same idempotency
 * key) may reuse its own claim.
 */
export async function claimCodToken(
  sb: SbAdmin, token: string | null | undefined, phone: string | null, email: string | null | undefined, orderKey: string,
): Promise<boolean> {
  const mail = email ? norm(email) : ''
  if (!token || !phone || !mail || token.length > 200 || !/^[\w-]{1,100}$/.test(orderKey)) return false
  const since = new Date(Date.now() - COD_TOKEN_TTL_MS).toISOString()
  const base = `/rest/v1/cod_verifications?token_hash=eq.${hashCodToken(token)}&phone10=eq.${phone}` +
    `&email=eq.${encodeURIComponent(mail)}&verified_at=gt.${encodeURIComponent(since)}`
  const claimed = await sb('PATCH', `${base}&used_at=is.null`, { used_at: new Date().toISOString(), used_for: orderKey }) as unknown[] | null
  if (Array.isArray(claimed) && claimed.length > 0) return true
  const mine = await sb('GET', `${base}&used_for=eq.${encodeURIComponent(orderKey)}&select=id&limit=1`) as unknown[] | null
  return Array.isArray(mine) && mine.length > 0
}

export interface CodGateContext {
  customerIds:              string[]                 // the order's customer row + phone/e-mail matches (stricter checks)
  codTotal:                 number
  phone10:                  string | null
  email?:                   string | null
  orderKey:                 string                   // idempotency key of the order being placed
  authenticatedCustomerId?: string | number | null
}

/** Builds the gate the orders route hands to createOrder. Refuses with a typed CheckoutRejectedError (customer-safe message). */
export function makeCodRiskGate(deps: { sb: SbAdmin; settings: Record<string, string | undefined>; token?: string | null }) {
  return async ({ customerIds, codTotal, phone10, email, orderKey, authenticatedCustomerId }: CodGateContext) => {
    const safe = (ids: Array<string | number>) => Array.from(new Set(ids.map(String))).filter(id => /^[\w-]{1,40}$/.test(id))
    // R4A-1: the "refused at the door" block is per PHONE — look the phone up even for a signed-in customer, so a new
    // account cannot carry a blocked number back to COD.
    let phoneIds: string[] = []
    if (phone10) {
      const rows = await deps.sb('GET', `/rest/v1/customers?normalized_phone=eq.${phone10}&select=id&limit=25`) as Array<{ id: unknown }> | null
      phoneIds = safe((Array.isArray(rows) ? rows : []).map(r => r?.id as string).filter(v => v != null))
    }
    const rtoIds = safe([...customerIds, ...phoneIds, ...(authenticatedCustomerId != null ? [authenticatedCustomerId] : [])])
    // R4A-2: trust ("already has a delivered order") comes only from the signed-in account or the phone itself — never from
    // an e-mail match, which anyone can type. E-mail matches may only make the decision stricter (they stay in rtoIds).
    const trustIds = safe(authenticatedCustomerId != null ? [authenticatedCustomerId] : phoneIds)
    const [delivered, rto] = await Promise.all([
      trustIds.length ? deps.sb('GET', `/rest/v1/orders?customer_id=in.(${trustIds.join(',')})&order_status=eq.delivered&select=id&limit=1`) : Promise.resolve([]),
      rtoIds.length ? deps.sb('GET', `/rest/v1/orders?customer_id=in.(${rtoIds.join(',')})&payment_method=in.(cod,whatsapp_cod)&order_status=eq.returned&delivered_at=is.null&select=id&limit=1`) : Promise.resolve([]),
    ]) as [unknown[] | null, unknown[] | null]
    const risk = decideCodRisk({
      settings: deps.settings, codTotal,
      deliveredCount: Array.isArray(delivered) ? delivered.length : 0,
      rtoCount:       Array.isArray(rto) ? rto.length : 0,
    })
    if (risk === 'blocked') {
      throw new CheckoutRejectedError('Cash on Delivery is not available for this mobile number because an earlier COD order was not accepted. Please pay online — UPI, cards and net banking are all available.', 'COD_NOT_AVAILABLE')
    }
    if (risk === 'verify' && !(await claimCodToken(deps.sb, deps.token, phone10, email, orderKey))) {
      throw new CheckoutRejectedError('Please confirm this Cash on Delivery order with the code we send to your e-mail.', 'COD_VERIFICATION_REQUIRED')
    }
  }
}
