// ─────────────────────────────────────────────────────────────────────────────
// lib/server/loyalty.ts
//
// Server-only loyalty-point helpers shared by:
//   /api/v1/orders/route.ts   (COD path)
//   /api/v1/payments/route.ts (Razorpay path)
//
// The `import 'server-only'` guard causes a build-time error if this module
// is ever accidentally imported into a 'use client' file, preventing
// SUPABASE_SERVICE_KEY from leaking into the browser bundle.
// ─────────────────────────────────────────────────────────────────────────────
import 'server-only'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!

async function callLoyaltyRpc(
  rpc:    string,
  params: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: {
      apikey:          SERVICE_KEY,
      Authorization:   `Bearer ${SERVICE_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(params),
  })
}

/**
 * Award loyalty points after an order is confirmed.
 * Non-fatal — a failure is logged but does not abort the order flow.
 */
export async function awardLoyaltyPoints(
  customerId:  string | number,
  orderId:     string | number,
  orderTotal:  number,
  settings:    Record<string, string>,
  note = 'Earned from order',
): Promise<void> {
  if (settings.loyalty_enabled === 'false') return
  const rate = parseFloat(settings.loyalty_points_per_rupee || '1')
  const pts  = Math.floor(orderTotal * rate)
  if (pts <= 0) return
  try {
    await callLoyaltyRpc('award_loyalty_points', {
      p_customer_id: String(customerId),
      p_order_id:    String(orderId),
      p_points:      pts,
      p_note:        note,
    })
  } catch (e) {
    console.error('[loyalty] awardLoyaltyPoints failed:', e)
  }
}

/**
 * Atomically deduct redeemed points from a customer's balance.
 * Returns true on success (or when points === 0), false if the RPC
 * rejects (e.g. insufficient balance).
 */
export async function redeemLoyaltyPoints(
  customerId: string | number,
  orderId:    string | number,
  points:     number,
): Promise<boolean> {
  if (!points || points <= 0) return true
  try {
    const res    = await callLoyaltyRpc('redeem_loyalty_points', {
      p_customer_id: String(customerId),
      p_order_id:    String(orderId),
      p_points:      points,
      p_note:        'Redeemed at checkout',
    })
    const result = await res.json()
    return res.ok && (result === true || result?.result === true)
  } catch {
    return false
  }
}
