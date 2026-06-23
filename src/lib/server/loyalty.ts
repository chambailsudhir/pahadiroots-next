// lib/server/loyalty.ts — server-only loyalty-point helpers
//
// OBSERVABILITY FIXES:
//
// BUG 8 — bare console.error on loyalty RPC failures.
//   A loyalty RPC failure means a customer paid but their points were silently
//   not awarded or deducted. The original code used console.error which:
//     • does NOT emit a structured JSON line (breaks log aggregator filters)
//     • does NOT set alert:true (no log-drain alert rule fires)
//   Fix: replaced with captureError({alert:true}) throughout so a Logtail /
//   Datadog alert rule can page ops within seconds of a failure.
//
// BUG 9 — no timeout on Supabase RPC calls.
//   callLoyaltyRpc() had no AbortSignal.timeout. A slow Supabase response
//   would hang the calling lambda (orders/route.ts, payments/route.ts) until
//   Vercel's hard 15-second limit, causing the entire order confirmation to
//   appear hung even though the order was already committed. Fixed: 5 s timeout
//   (loyalty is non-fatal; a timeout fail-open is better than a hung response).

import 'server-only'
import { captureError } from '@/lib/logger'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!

async function callLoyaltyRpc(
  rpc:    string,
  params: Record<string, unknown>,
): Promise<Response> {
  // BUG FIX 9: added 5 s timeout — loyalty is non-fatal so a tight budget
  // is acceptable and far better than hanging the order confirmation lambda.
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: {
      apikey:          SERVICE_KEY,
      Authorization:   `Bearer ${SERVICE_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(5_000),
  })
}

/** Award loyalty points after an order is confirmed. Non-fatal. */
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
    // BUG FIX 8: alert:true — customer paid but points silently not awarded.
    captureError(e, {
      action:      'loyalty.awardLoyaltyPoints',
      customer_id: String(customerId),
      order_id:    String(orderId),
      points:      pts,
      alert:       true,
    })
  }
}

/** Atomically deduct redeemed points. Returns true on success, false on failure. */
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
  } catch (e) {
    // BUG FIX 8: alert:true — balance inconsistency if redemption skipped on paid order.
    captureError(e, {
      action:      'loyalty.redeemLoyaltyPoints',
      customer_id: String(customerId),
      order_id:    String(orderId),
      points,
      alert:       true,
    })
    return false
  }
}
