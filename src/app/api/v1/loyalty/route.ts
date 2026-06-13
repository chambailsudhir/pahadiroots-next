// ─────────────────────────────────────────────────────────────
// /api/v1/loyalty — Pahadi Coins (loyalty points) API
//
//  GET  → returns { points, value_inr, label, max_redeem_pct, min_redeem }
//  POST action=validate → checks if redemption amount is valid
//       action=referral_code → returns the customer's referral code
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail, checkCsrf,
  sbAuth, sbAdmin,
  getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile,
} from '@/lib/api/serverUtils'

// ── Helpers ───────────────────────────────────────────────────
function asNumber(v: string | undefined, fallback: number) {
  const n = parseFloat(v ?? '')
  return isNaN(n) ? fallback : n
}

// Use the shared sbAdmin helper — avoids duplicating raw env-var / key handling
// here (the audit flagged the old inline fetch as a security smell because any
// future key rotation or header change had to be updated in two places).
async function getSettings(): Promise<Record<string, string>> {
  const rows: Array<{ key: string; value: string }> = await sbAdmin(
    'GET',
    '/rest/v1/site_settings?key=in.(loyalty_enabled,loyalty_points_per_rupee,loyalty_points_value,loyalty_max_redeem_pct,loyalty_points_label,loyalty_min_redeem,referral_bonus_points)',
  ).catch(() => [])
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
    const user = await sbAuth('/user', null, token!)

    // Run profile sync + settings fetch in parallel — saves ~300-500ms
    const [profile, settings] = await Promise.all([
      syncCustomerProfile(user),
      getSettings(),
    ])
    if (!profile) return fail(404, 'Profile not found')

    // syncCustomerProfile already fetches select=* so loyalty_points
    // and referral_code are already on the profile object — no extra query needed
    const customerRow = profile
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

  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && 'status' in e && (e as { status: number }).status === 401) return fail(401, 'Session expired')
    const msg = e instanceof Error ? e.message : 'Loyalty fetch failed'
    return fail(500, msg)
  }
}

// ── POST /api/v1/loyalty ──────────────────────────────────────
// action=validate  → validates a redemption amount against user's balance
// action=history   → last 20 loyalty transactions
export async function POST(req: NextRequest) {
  const csrf = checkCsrf(req)
  if (csrf) return csrf

  let token = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  try {
    const body   = await req.json()
    const action = typeof body.action === 'string' ? body.action : null
    if (!action) {
      return fail(400, 'Missing or invalid action field')
    }

    // BUG FIX: action was not validated against a known set of values. An unknown
    // action would fall through all if-blocks and return fail(400, 'Unknown action'),
    // but the user/profile DB queries above already ran — wasted DB calls for every
    // garbage action value. Reject early before any DB work.
    const ALLOWED_ACTIONS = new Set(['validate', 'history'])
    if (!action || !ALLOWED_ACTIONS.has(action)) {
      return fail(400, 'Unknown action')
    }

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

      // BUG FIX: order_subtotal was not validated — a missing, NaN, negative, or
      // non-numeric value causes maxValueCap = NaN (or a negative cap), making the
      // `redeemValue > maxValueCap` guard always false and letting any redemption
      // amount pass as valid. Validate before using it in arithmetic.
      if (
        typeof order_subtotal !== 'number' ||
        !Number.isFinite(order_subtotal)   ||
        order_subtotal < 0
      ) {
        return fail(400, 'Invalid order subtotal')
      }

      const [customerRow, settings] = await Promise.all([
        sbAdmin('GET', `/rest/v1/customers?id=eq.${profile.id}&select=loyalty_points&limit=1`)
          .then((r: Record<string, unknown>[]) => r?.[0] ?? null),
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
    // BUG FIX: this action is dead code — GET /api/v1/loyalty/history now owns
    // paginated history. This branch still exists for backwards compatibility with
    // any client that sends `action=history` via POST, but it now also applies
    // pagination (previously hardcoded to 30, no offset). Callers should migrate
    // to GET /api/v1/loyalty/history?page=N&limit=M.
    if (action === 'history') {
      const page  = Math.max(1, Number.isInteger(body.page)  ? body.page  : 1)
      const limit = Math.min(50, Math.max(1, Number.isInteger(body.limit) ? body.limit : 20))
      const offset = (page - 1) * limit

      const rows = await sbAdmin(
        'GET',
        `/rest/v1/loyalty_transactions?customer_id=eq.${profile.id}&select=id,type,points,balance_after,note,created_at,order_id&order=created_at.desc&limit=${limit}&offset=${offset}`,
      ).catch(() => [])

      const res = ok({ transactions: rows ?? [], page, limit })
      if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
      return res
    }

    return fail(400, 'Unknown action')

  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && 'status' in e && (e as { status: number }).status === 401) return fail(401, 'Session expired')
    const msg = e instanceof Error ? e.message : 'Loyalty error'
    return fail(500, msg)
  }
}
