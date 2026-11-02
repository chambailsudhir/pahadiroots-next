// ─────────────────────────────────────────────────────────────────────────────
// lib/couponHistory.ts
//
// Nov 2026: "one person / one address, one time only" for per-customer coupons (coupons.user_limit) and first-order coupons.
//
// WHY THIS EXISTS. A coupon use is recorded in coupon_usage. For a signed-in customer the row carries their customer_id, but for a
// GUEST it is deliberately recorded with customer_id NULL (a phone number someone typed is not proof of identity, so the use is not
// credited to a customer row — audit S1-002). The old guest pre-check looked for rows by customer_id, so it could never find a
// guest's earlier use: a guest could redeem a "one use per customer" coupon again and again. And the delivery address was never
// compared at all.
//
// The history is therefore reconstructed from the ORDER each use belongs to (orders.customer_id and orders.shipping_address), which
// exists for guests too. A coupon counts as already used by this request when a recorded use belongs to
//   • the same PERSON  — the verified account, or any customer row sharing the phone / e-mail, or
//   • the same ADDRESS — same PIN code and an address line that reads as the same place (lib/addressMatch).
//
// The database is injected (anything with supabase-js's from().select()...), so this is client-safe to import and easy to test.
// ─────────────────────────────────────────────────────────────────────────────
import type { SupabaseClient } from '@supabase/supabase-js'
import { sameDeliveryAddress } from '@/lib/addressMatch'

/** Any supabase-js client (type-only import, erased at build — this module stays client-safe). */
export type CouponHistoryDb = SupabaseClient

export interface CouponUser {
  /** customers.id values that count as "this person" (verified account + phone / e-mail matches). */
  customerIds: Array<string | number>
  pincode?: string | null
  /** House / flat + area as typed (flat, area). */
  addressLine?: string | null
}

export interface PriorUse { byPerson: number; byAddress: number }

const CHUNK = 100
const MAX_USAGE_ROWS = 1000

type UsageRow = { id: number; order_id: number | null; customer_id: number | null }
type OrderRow = { id: number; customer_id: number | null; shipping_address: { pincode?: string; address_line1?: string } | null }

/**
 * How many times this coupon has already been used by this person / at this address.
 * Throws if the database cannot be read — the caller must decide (the order path fails closed).
 */
export async function countPriorCouponUse(db: CouponHistoryDb, couponId: number | string, who: CouponUser): Promise<PriorUse> {
  const ids = new Set(who.customerIds.map(String))

  const usageRes = await db.from('coupon_usage').select('id, order_id, customer_id').eq('coupon_id', Number(couponId)).limit(MAX_USAGE_ROWS)
  if (usageRes.error) throw new Error('coupon history read failed: ' + usageRes.error.message)
  const usage = (usageRes.data ?? []) as UsageRow[]
  if (usage.length === 0) return { byPerson: 0, byAddress: 0 }

  // Orders behind the uses (guest uses carry no customer_id of their own — the order is the only link).
  const orderIds = Array.from(new Set(usage.map(u => u.order_id).filter((x): x is number => x != null)))
  const orders = new Map<string, OrderRow>()
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const r = await db.from('orders').select('id, customer_id, shipping_address').in('id', orderIds.slice(i, i + CHUNK))
    if (r.error) throw new Error('coupon history order read failed: ' + r.error.message)
    for (const o of (r.data ?? []) as OrderRow[]) orders.set(String(o.id), o)
  }

  let byPerson = 0, byAddress = 0
  for (const u of usage) {
    const o = u.order_id != null ? orders.get(String(u.order_id)) : undefined
    const samePerson =
      (u.customer_id != null && ids.has(String(u.customer_id))) ||
      (o?.customer_id != null && ids.has(String(o.customer_id)))
    if (samePerson) { byPerson++; continue }
    if (o?.shipping_address && sameDeliveryAddress(
      { pincode: who.pincode, line: who.addressLine },
      { pincode: o.shipping_address.pincode, line: o.shipping_address.address_line1 },
    )) byAddress++
  }
  return { byPerson, byAddress }
}

export const COUPON_USED_BY_PERSON  = 'You have already used this coupon'
export const COUPON_USED_AT_ADDRESS = 'This coupon has already been used for this delivery address'

/** The customer-facing refusal for a per-customer-limited coupon, or null when this request may still use it. */
export function couponReuseProblem(prior: PriorUse, userLimit: number | null | undefined): string | null {
  if (userLimit == null) return null
  if (prior.byPerson >= userLimit)  return COUPON_USED_BY_PERSON
  if (prior.byAddress >= userLimit) return COUPON_USED_AT_ADDRESS
  return null
}
