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

import type { SupabaseClient } from '@supabase/supabase-js'

export type CouponClaimResult =
  | { ok: true;  usageId: number }
  | { ok: false; error: string; code?: string }

export async function claimCouponUse(
  db: SupabaseClient,
  couponId: number | string,
  customerId: number | string | null,
): Promise<CouponClaimResult> {
  // customers.id is a bigint; a non-numeric id cannot match any customer, so it carries no history.
  const cust = customerId == null ? null : Number(customerId)
  const { data, error } = await db.rpc('claim_coupon_use', {
    p_coupon_id:   Number(couponId),
    p_customer_id: cust !== null && Number.isFinite(cust) ? cust : null,
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

/** Ids from a text[]/jsonb/comma-string column, normalised to trimmed strings. */
export function toIdList(v: unknown): string[] {
  if (v == null) return []
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  return arr.map(x => String(x).trim()).filter(Boolean)
}
