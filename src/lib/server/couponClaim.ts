// ─────────────────────────────────────────────────────────────────────────────
// lib/server/couponClaim.ts  (server only)
//
// F-07 (Oct 2026 audit): the storefront used to check a coupon's usage cap and per-customer limit
// with plain reads and write the counter after the order — two simultaneous orders could both pass.
// The database now owns this: claim_coupon_use() takes the coupon row lock and performs every check
// plus the reservation in ONE transaction, recording a coupon_usage row with order_id NULL.
//   • createOrder claims BEFORE it commits an order,
//   • attaches the order id once the order exists,
//   • releases the claim if anything fails first (release_coupon_claim).
// A claim orphaned by a crashed process is released by release_stale_coupon_claims() (run from the
// pending-order sweep).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export type CouponClaimResult =
  | { ok: true;  usageId: number }
  | { ok: false; error: string; code?: string }

export async function claimCouponUse(
  db: SupabaseClient,
  couponId: number | string,
  customerId: number | string | null,
  /**
   * Who is claiming when there is no verified account (db_migration_v32): a stable hash of the normalised phone. The database counts
   * prior uses by customer id OR this key under the coupon row lock, so two concurrent GUEST checkouts with the same phone can no
   * longer both take a one-time coupon (verification finding F-2).
   */
  identityKey: string | null = null,
): Promise<CouponClaimResult> {
  // customers.id is a bigint; a non-numeric id cannot match any customer, so it carries no history.
  const cust = customerId == null ? null : Number(customerId)
  const { data, error } = await db.rpc('claim_coupon_use', {
    p_coupon_id:   Number(couponId),
    p_customer_id: cust !== null && Number.isFinite(cust) ? cust : null,
    p_identity_key: identityKey || null,
  })
  if (error) throw new Error(`coupon claim failed: ${error.message}`)
  const r = (data ?? {}) as { ok?: boolean; usage_id?: number; error?: string; code?: string }
  if (r.ok && typeof r.usage_id === 'number') return { ok: true, usageId: r.usage_id }
  return { ok: false, error: r.error || 'This coupon could not be applied', code: r.code }
}

export async function releaseCouponClaim(db: SupabaseClient, usageId: number): Promise<void> {
  const { error } = await db.rpc('release_coupon_claim', { p_usage_id: usageId })
  if (error) throw new Error(`coupon claim release failed: ${error.message}`)
}

/** The identity key for claim_coupon_use: sha-256 of the normalised 10-digit phone (never the raw number in the table). */
export function couponIdentityKey(normalizedPhone: string | null | undefined): string | null {
  const digits = String(normalizedPhone ?? '').replace(/\D/g, '').slice(-10)
  if (digits.length !== 10) return null
  return 'ph:' + createHash('sha256').update('coupon-identity:' + digits).digest('hex')
}

/** Ids from a text[]/jsonb/comma-string column, normalised to trimmed strings. */
export function toIdList(v: unknown): string[] {
  if (v == null) return []
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  return arr.map(x => String(x).trim()).filter(Boolean)
}
