// ─────────────────────────────────────────────────────────────
// /api/v1/loyalty — Pahadi Coins (loyalty points) API
//
//  GET  → returns { points, value_inr, label, max_redeem_pct, min_redeem }
//  POST action=validate → checks if redemption amount is valid
//       action=referral_code → returns the customer's referral code
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin,
  getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile,
} from '@/lib/api/serverUtils'

// ── Helpers ───────────────────────────────────────────────────
function asNumber(v: string | undefined, fallback: number) {
  const n = parseFloat(v ?? '')
  return isNaN(n) ? fallback : n
}

async function getSettings(): Promise<Record<string, string>> {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/site_settings?key=in.(loyalty_enabled,loyalty_points_per_rupee,loyalty_points_value,loyalty_max_redeem_pct,loyalty_points_label,loyalty_min_redeem,referral_bonus_points)`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  )
  const rows: Array<{ key: string; value: string }> = await res.json().catch(() => [])
  return Object.fromEntries((rows || []).map(r => [r.key, r.value]))
}

// ── GET /api/v1/loyalty ───────────────────────────────────────
// Returns current points balance + loyalty config
export async function GET(req: NextRequest) {
  let token = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    // Fetch fresh points balance from DB
    const customerRow: any = await sbAdmin(
      'GET',
      `/rest/v1/customers?id=eq.${profile.id}&select=loyalty_points,referral_code&limit=1`,
    ).then((r: any[]) => r?.[0] ?? null).catch(() => null)

    const settings      = await getSettings()
    const loyaltyEnabled = settings.loyalty_enabled !== 'false'
    const pointsValue   = asNumber(settings.loyalty_points_value, 0.25)
    const minRedeem     = asNumber(settings.loyalty_min_redeem, 40)
    const maxRedeemPct  = asNumber(settings.loyalty_max_redeem_pct, 20)
    const label         = settings.loyalty_points_label || 'Pahadi Coins'
    const points        = Number(customerRow?.loyalty_points ?? 0)

    const res = ok({
      enabled:       loyaltyEnabled,
      points,
      value_inr:     Math.floor(points * pointsValue),   // ₹ equivalent
      points_value:  pointsValue,                        // per-point value in ₹
      min_redeem:    minRedeem,
      max_redeem_pct: maxRedeemPct,
      label,
      referral_code: customerRow?.referral_code ?? null,
    })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: any) {
    if (e?.status === 401) return fail(401, 'Session expired')
    return fail(500, e?.message || 'Loyalty fetch failed')
  }
}

// ── POST /api/v1/loyalty ──────────────────────────────────────
// action=validate  → validates a redemption amount against user's balance
// action=history   → last 20 loyalty transactions
export async function POST(req: NextRequest) {
  let token = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  try {
    const body   = await req.json()
    const action = body.action as string

    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    // ── action=validate ────────────────────────────────────────
    if (action === 'validate') {
      const { points_to_redeem, order_subtotal } = body as {
        points_to_redeem: number
        order_subtotal:   number
      }

      if (!Number.isInteger(points_to_redeem) || points_to_redeem <= 0) {
        return fail(400, 'Invalid points amount')
      }

      const [customerRow, settings] = await Promise.all([
        sbAdmin('GET', `/rest/v1/customers?id=eq.${profile.id}&select=loyalty_points&limit=1`)
          .then((r: any[]) => r?.[0] ?? null),
        getSettings(),
      ])

      const balance       = Number(customerRow?.loyalty_points ?? 0)
      const pointsValue   = asNumber(settings.loyalty_points_value, 0.25)
      const minRedeem     = asNumber(settings.loyalty_min_redeem, 40)
      const maxRedeemPct  = asNumber(settings.loyalty_max_redeem_pct, 20)

      if (points_to_redeem < minRedeem) {
        return fail(400, `Minimum ${minRedeem} points required to redeem`)
      }
      if (points_to_redeem > balance) {
        return fail(400, `Insufficient balance — you have ${balance} points`)
      }

      // Max redemption cap: points_to_redeem * pointsValue ≤ maxRedeemPct% of subtotal
      const maxValueCap = Math.floor(order_subtotal * maxRedeemPct / 100)
      const redeemValue = Math.floor(points_to_redeem * pointsValue)
      if (redeemValue > maxValueCap) {
        return fail(400, `Maximum redemption is ₹${maxValueCap} (${maxRedeemPct}% of order)`)
      }

      const res = ok({
        valid:         true,
        points:        points_to_redeem,
        discount_inr:  redeemValue,
        balance_after: balance - points_to_redeem,
      })
      if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
      return res
    }

    // ── action=history ─────────────────────────────────────────
    if (action === 'history') {
      const rows = await sbAdmin(
        'GET',
        `/rest/v1/loyalty_transactions?customer_id=eq.${profile.id}&select=id,type,points,balance_after,note,created_at,order_id&order=created_at.desc&limit=30`,
      ).catch(() => [])

      const res = ok({ transactions: rows ?? [] })
      if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
      return res
    }

    return fail(400, 'Unknown action')

  } catch (e: any) {
    if (e?.status === 401) return fail(401, 'Session expired')
    return fail(500, e?.message || 'Loyalty error')
  }
}
