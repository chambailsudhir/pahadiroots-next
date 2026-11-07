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

/** True when `token` was issued by /cod-verify/confirm for this phone within the last 30 minutes. */
export async function isValidCodToken(sb: SbAdmin, token: string | null | undefined, phone: string | null): Promise<boolean> {
  if (!token || !phone || token.length > 200) return false
  const since = new Date(Date.now() - COD_TOKEN_TTL_MS).toISOString()
  const rows = await sb('GET', `/rest/v1/cod_verifications?token_hash=eq.${hashCodToken(token)}&phone10=eq.${phone}` +
    `&verified_at=gt.${encodeURIComponent(since)}&select=id&limit=1`) as unknown[] | null
  return Array.isArray(rows) && rows.length > 0
}

/** Builds the gate the orders route hands to createOrder. Refuses with a typed CheckoutRejectedError (customer-safe message). */
export function makeCodRiskGate(deps: { sb: SbAdmin; settings: Record<string, string | undefined>; token?: string | null }) {
  return async ({ customerIds, codTotal, phone10 }: { customerIds: string[]; codTotal: number; phone10: string | null }) => {
    const ids = customerIds.filter(id => /^[\w-]+$/.test(id))
    if (ids.length === 0) return
    const list = ids.join(',')
    const [delivered, rto] = await Promise.all([
      deps.sb('GET', `/rest/v1/orders?customer_id=in.(${list})&order_status=eq.delivered&select=id&limit=1`),
      deps.sb('GET', `/rest/v1/orders?customer_id=in.(${list})&payment_method=in.(cod,whatsapp_cod)&order_status=eq.returned&delivered_at=is.null&select=id&limit=1`),
    ]) as [unknown[] | null, unknown[] | null]
    const risk = decideCodRisk({
      settings: deps.settings, codTotal,
      deliveredCount: Array.isArray(delivered) ? delivered.length : 0,
      rtoCount:       Array.isArray(rto) ? rto.length : 0,
    })
    if (risk === 'blocked') {
      throw new CheckoutRejectedError('Cash on Delivery is not available for this mobile number because an earlier COD order was not accepted. Please pay online — UPI, cards and net banking are all available.', 'COD_NOT_AVAILABLE')
    }
    if (risk === 'verify' && !(await isValidCodToken(deps.sb, deps.token, phone10))) {
      throw new CheckoutRejectedError('Please confirm this Cash on Delivery order with the code we send to your e-mail.', 'COD_VERIFICATION_REQUIRED')
    }
  }
}
