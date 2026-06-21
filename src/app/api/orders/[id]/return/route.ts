// ─────────────────────────────────────────────────────────────
// POST /api/orders/[id]/return — initiate a return request
//
//  ✅ Token auth + refresh
//  ✅ CSRF check (Origin/Referer validation)
//  ✅ Ownership check: customer_id=eq.${profile.id} prevents IDOR
//  ✅ Only delivered orders within the 7-day window are returnable
//  ✅ Idempotent: 409 if a return is already in progress
//  ✅ Body: { reason: string }
//  ✅ Shared helpers from serverUtils (no duplication)
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin,
  getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile,
  checkCsrf,
} from '@/lib/api/serverUtils'
import { RETURN_REASONS } from '@/lib/account/constants'

const RETURNABLE_WINDOW_DAYS = 7

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  // ── CSRF check ────────────────────────────────────────────────
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  const { id } = params
  if (!id) return fail(400, 'Order ID is required')

  // Validate ID format before hitting the DB — rejects crafted IDs like "1;--"
  const isValidId =
    /^[0-9]+$/.test(id) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  if (!isValidId) return fail(400, 'Invalid order ID')

  // Parse + validate body
  let reason      = ''
  let otherDetail = ''
  try {
    const body  = await req.json()
    reason      = (body?.reason       ?? '').trim()
    // BUG FIX: otherDetail had no length cap and was stored raw in the DB.
    // An attacker could submit a multi-MB "Other" reason, bloating the DB row
    // and potentially the admin email. Cap at 500 chars and strip HTML tags.
    otherDetail = (body?.other_detail ?? '').toString().slice(0, 500).trim().replace(/<[^>]*>/g, '')
  } catch {
    return fail(400, 'Invalid request body')
  }
  if (!reason) return fail(400, 'A return reason is required')
  if (!RETURN_REASONS.includes(reason as typeof RETURN_REASONS[number])) {
    return fail(400, `Invalid reason. Must be one of: ${RETURN_REASONS.join(', ')}`)
  }
  // "Other" requires a free-text explanation so admin staff have context
  if (reason === 'Other' && !otherDetail) {
    return fail(400, 'Please provide a description when selecting "Other"')
  }

  // Auth
  let token = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    // Fetch order with ownership check
    const rows = await sbAdmin(
      'GET',
      `/rest/v1/orders?id=eq.${id}&customer_id=eq.${profile.id}&select=id,order_status,delivered_at,updated_at,order_number&limit=1`,
    ).catch(() => null)

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return fail(404, 'Order not found')
    }

    const order = rows[0] as {
      id:           string
      order_status: string
      delivered_at: string | null
      updated_at:   string | null
      order_number: string
    }

    // BUG FIX: RETURN_IN_PROGRESS was checked AFTER the `order_status !== 'delivered'`
    // guard. Since 'return_requested', 'return_approved' etc. are all non-delivered
    // statuses, they triggered "Only delivered orders can be returned" (422) before
    // the idempotency check could fire — the guard was permanently dead code.
    // A user submitting a second return request got a misleading error.
    // Fix: check in-progress states first and return the correct 409 message.
    const RETURN_IN_PROGRESS = [
      'return_requested', 'return_approved', 'return_received',
      'refunded', 'refund_initiated', 'refund_completed',
    ]
    if (RETURN_IN_PROGRESS.includes(order.order_status)) {
      return fail(409, 'A return request is already in progress for this order')
    }

    // Only delivered orders can be returned
    if (order.order_status !== 'delivered') {
      return fail(422, 'Only delivered orders can be returned')
    }

    // Enforce 7-day return window
    const deliveredDate = order.delivered_at || order.updated_at
    if (deliveredDate) {
      const daysSince = (Date.now() - new Date(deliveredDate).getTime()) / 86_400_000
      if (daysSince > RETURNABLE_WINDOW_DAYS) {
        return fail(422, `Return window has closed (${RETURNABLE_WINDOW_DAYS} days from delivery)`)
      }
    }

    // Store enriched reason: "Other: <user explanation>" so admin staff
    // see the actual context, not just the string "Other".
    const storedReason = reason === 'Other' && otherDetail
      ? `Other: ${otherDetail}`
      : reason

    // Update order status
    await sbAdmin(
      'PATCH',
      `/rest/v1/orders?id=eq.${id}&customer_id=eq.${profile.id}`,
      {
        order_status:        'return_requested',
        return_reason:       storedReason,
        return_requested_at: new Date().toISOString(),
      },
    )

    const res = ok({
      success: true,
      message: `Return request submitted for order ${order.order_number}. Our team will contact you within 24–48 hours.`,
    })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    // BUG FIX [ERROR HANDLING]: previously no console.error — a DB failure or
    // unexpected error here was completely invisible in server logs.
    console.error('[orders/[id]/return POST]', e)
    // SEC-FIX: never expose raw DB/Supabase error messages in production —
    // they can leak table names, constraint names, and other internals.
    const clientMsg = process.env.NODE_ENV !== 'production'
      ? (err.message || 'Return request failed')
      : 'Return request failed. Please try again or contact support.'
    return fail(500, clientMsg)
  }
}
