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
//
//  ARCHITECTURE FIX (see PAHADI_ROOTS_SESSION_REPORT.md §2): this route
//  used to PATCH orders.order_status to values like 'return_requested'
//  and write orders.return_reason / orders.return_requested_at. None of
//  that exists in the real schema:
//    - order_status is a Postgres enum with only 7 values (pending,
//      confirmed, packed, shipped, delivered, cancelled, returned) —
//      it never changes for a return. Setting it to 'return_requested'
//      crashed with `invalid input value for enum order_status_enum`.
//    - orders.return_reason / orders.return_requested_at do not exist
//      (confirmed via live schema inspection — zero rows returned).
//  The admin panel (pahadi-admin) already has a complete, working,
//  separate system: a dedicated `returns` table with its own 5-value
//  `status` lifecycle (requested → approved → received → refunded, or
//  rejected). orders.order_status is never touched by any of it — the
//  order just stays 'delivered'. This route now matches that system:
//  it INSERTs into `returns` instead of mutating `orders` at all.
//
//  CROSS-REPO FIX (this session — pahadi-admin's actual source reviewed,
//  not just described secondhand): `reason` now uses admin's exact
//  lowercase codes (see constants.ts RETURN_REASONS) instead of English
//  sentences, so admin's auto-restock rules and reason filters recognise
//  returns created from the storefront. Also confirmed: orders.payment_status
//  is never touched by this route, and deliberately so — admin's own
//  STATUS_PAYMENT_MAP sets it to 'refund_pending' on approval, which turned
//  out to not be a real payment_status_enum value (see
//  db_migration_v10_add_refund_pending_payment_status.sql and the session
//  report) — a DB-level fix, not something this route needed to change.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin,
  getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile,
  checkCsrf,
} from '@/lib/api/serverUtils'
import { RETURN_REASON_CODES } from '@/lib/account/constants'

// BUG FIX (policy accuracy — flagged by founder): this was enforcing a
// 7-day return window, which doesn't match the site's actual Return &
// Refund Policy (48 hours from delivery, with photo/video proof — see
// /policies/returns). A 7-day window is also wrong for an FMCG/food
// business where most items are perishable and can't take that risk.
const RETURNABLE_WINDOW_HOURS = 48

export async function POST(
  req: NextRequest,
  // BUG FIX (Next.js 15+/16 migration): `params` is now a Promise.
  { params }: { params: Promise<{ id: string }> },
) {
  // ── CSRF check ────────────────────────────────────────────────
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  const { id } = await params
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
  // CROSS-REPO FIX: validated against admin's real reason codes (confirmed
  // via pahadi-admin/src/app/admin/returns/page.jsx RETURN_REASONS) — not
  // free-text sentences, so every return's `reason` value is something
  // admin's own UI, auto-restock rules, and filters actually recognise.
  if (!RETURN_REASON_CODES.includes(reason as typeof RETURN_REASON_CODES[number])) {
    return fail(400, `Invalid reason. Must be one of: ${RETURN_REASON_CODES.join(', ')}`)
  }
  // "other" requires a free-text explanation so admin staff have context
  if (reason === 'other' && !otherDetail) {
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

    // Idempotency check — confirmed real schema: a return "in progress" means
    // any row in `returns` for this order whose status isn't 'rejected' (the
    // admin's 5-value lifecycle: requested → approved → received → refunded,
    // or rejected). A rejected return doesn't block a fresh request.
    const existingReturns = await sbAdmin(
      'GET',
      `/rest/v1/returns?order_id=eq.${id}&select=id,status&order=created_at.desc&limit=1`,
    ).catch(() => null)
    const existing = Array.isArray(existingReturns) ? existingReturns[0] : null
    if (existing && existing.status !== 'rejected') {
      return fail(409, 'A return request is already in progress for this order')
    }

    // Only delivered orders can be returned
    if (order.order_status !== 'delivered') {
      return fail(422, 'Only delivered orders can be returned')
    }

    // Enforce 48-hour return window
    const deliveredDate = order.delivered_at || order.updated_at
    if (deliveredDate) {
      const hoursSince = (Date.now() - new Date(deliveredDate).getTime()) / 3_600_000
      if (hoursSince > RETURNABLE_WINDOW_HOURS) {
        return fail(422, `Return window has closed (${RETURNABLE_WINDOW_HOURS} hours from delivery)`)
      }
    }

    // customer_name — matches the field admin's own return-creation flow
    // populates (pahadi-admin/src/app/admin/returns/page.jsx).
    const customerName = [
      (profile as { first_name?: string }).first_name,
      (profile as { last_name?: string }).last_name,
    ].filter(Boolean).join(' ').trim() || null

    // INSERT into the dedicated `returns` table — matching the exact live
    // schema (confirmed via information_schema.columns). `reason` and
    // `description` are separate real columns, so the free-text "Other"
    // explanation goes in `description` rather than being concatenated
    // into `reason`. Item-level fields (variant_id, product_id, quantity,
    // unit_refund_amount, refund_gst_amount) and `refund_amount` are left
    // unset here — this is a whole-order return request; only admin staff
    // (after inspecting the return) assign a refund amount / line items.
    // `status` defaults to 'requested' in the DB but is set explicitly for
    // clarity. orders.payment_status is deliberately NOT touched here —
    // per admin's STATUS_PAYMENT_MAP, 'requested' has no payment-status
    // side effect; only a later admin-driven transition does.
    await sbAdmin(
      'POST',
      '/rest/v1/returns',
      {
        order_id:      order.id,
        order_number:  order.order_number,
        customer_name: customerName,
        reason,
        description:   otherDetail || null,
        status:        'requested',
      },
      'return=minimal',
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
    // SEC-FIX: never expose raw DB/Supabase error messages in production —
    // they can leak table names, constraint names, and other internals.
    const clientMsg = process.env.NODE_ENV !== 'production'
      ? (err.message || 'Return request failed')
      : 'Return request failed. Please try again or contact support.'
    return fail(500, clientMsg)
  }
}
