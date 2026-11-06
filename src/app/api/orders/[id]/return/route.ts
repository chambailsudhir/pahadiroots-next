// ─────────────────────────────────────────────────────────────
// POST /api/orders/[id]/return — initiate a return request
//
//  ✅ Token auth + refresh
//  ✅ CSRF check (Origin/Referer validation)
//  ✅ Ownership check: customer_id=eq.${profile.id} prevents IDOR
//  ✅ Only delivered orders within the 48-hour window are returnable
//  ✅ Idempotent: 409 if a return is already in progress for the same item
//  ✅ Body: { reason, other_detail?, order_item_id?, variant_id?, product_id?,
//            quantity?, resolution? ('refund' | 'replace'), photo_paths? }
//  ✅ photo_paths: object paths from the sibling /return/upload-url route; only
//     accepted if they sit under this order's own returns/<id>/ prefix of the
//     PRIVATE return-evidence bucket, and only kept if the object exists
//     (signing it proves that). The bare object paths are stored in
//     returns.photo_urls; a short-lived read link is minted whenever they are
//     viewed — see lib/server/returnEvidence.ts (ACC-051, L-8)
//  ✅ Line-item aware: when an order has >1 item, the client identifies
//     which one via variant_id/product_id (or order_item_id); server
//     re-verifies it actually belongs to this order against order_items
//     before trusting any of it. Omitting these preserves the original
//     whole-order return behavior.
//  ✅ resolution='replace' server-re-validated against canReplace(reason) —
//     never trust the client's Refund/Replace toggle gating
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

import { verifyEvidencePaths } from '@/lib/server/returnEvidence'
import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin,
  getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile,
  checkCsrf,
} from '@/lib/api/serverUtils'
import { RETURN_REASON_CODES, RETURNABLE_WINDOW_HOURS, canReplace, canSelfServeReturn, returnWindowStart } from '@/lib/account/constants'

// Return window: 48 hours from delivery (see RETURNABLE_WINDOW_HOURS in
// constants.ts for the single source of truth shared with the client-side
// eligibility check in useOrders.ts's canReturn()).

/**
 * Statuses the DB unique index ignores (ux_returns_active_order_item: status <> ALL('refunded','rejected','replaced') —
 * db_migration_v24). A REPLACED return is finished: the customer holds a new unit and may return it if it is damaged too.
 */
const INDEX_TERMINAL_RETURN_STATUSES = ['refunded', 'rejected', 'replaced']

/** sbAdmin throws { status, message: <PostgREST JSON body> } — pull the SQLSTATE out of it. */
function pgErrorCode(e: unknown): string | null {
  const msg = (e as { message?: unknown })?.message
  if (typeof msg !== 'string') return null
  try {
    const c = (JSON.parse(msg) as { code?: unknown }).code
    if (typeof c === 'string') return c
  } catch { /* not JSON */ }
  return /"code"\s*:\s*"(\d{5})"/.exec(msg)?.[1] ?? null
}

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
  // Item-level + resolution fields (Replacement workflow). All optional —
  // omitting them preserves the original whole-order return behavior.
  let itemId:      string | number | null = null
  let variantId:   string | number | null = null
  let productId:   string | number | null = null
  let quantity:    number | null          = null
  let resolution:  'refund' | 'replace'   = 'refund'
  let photoPaths:  string[]               = []
  let photoUrls:   string[]               = []     // verified object paths, filled in after the ownership check
  try {
    const body  = await req.json()
    reason      = (body?.reason       ?? '').trim()
    // BUG FIX: otherDetail had no length cap and was stored raw in the DB.
    // An attacker could submit a multi-MB "Other" reason, bloating the DB row
    // and potentially the admin email. Cap at 500 chars and strip HTML tags.
    otherDetail = (body?.other_detail ?? '').toString().slice(0, 500).trim().replace(/<[^>]*>/g, '')

    itemId    = (body?.order_item_id ?? null) as string | number | null
    variantId = (body?.variant_id    ?? null) as string | number | null
    productId = (body?.product_id    ?? null) as string | number | null
    if (body?.quantity != null) {
      // Floor FIRST, then validate: 0.5 used to pass `> 0` and then floor to 0 (stored as quantity 0).
      const q = Math.floor(Number(body.quantity))
      if (!Number.isFinite(q) || q < 1) return fail(400, 'Quantity must be a whole number of at least 1')
      quantity = q
    }
    if (body?.resolution === 'replace') resolution = 'replace'
    // Photo evidence (ACC-051): the browser sends the object PATHS it was given by /return/upload-url, never URLs. Only
    // paths under this order's own returns/<id>/ prefix of the PRIVATE return-evidence bucket are accepted; they are verified
    // against storage below, after the customer has been authenticated and the order ownership checked.
    if (Array.isArray(body?.photo_paths)) {
      const pathRe = new RegExp(`^returns/${id}/[0-9]+-[A-Za-z0-9._-]{1,200}$`)
      photoPaths = [...new Set<string>(body.photo_paths.filter((u: unknown): u is string => typeof u === 'string' && pathRe.test(u) && !u.includes('..')))].slice(0, 4)
    }
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
  // FSSAI-consistent food-safety policy (see canSelfServeReturn's own
  // comment in constants.ts): self-serve returns/replacements are
  // restricted to genuine quality/fulfillment issues only, same as every
  // major food e-commerce player. 'changed_mind'/'other' are still valid
  // reason codes overall (admin staff can log them manually on a
  // customer's behalf via phone/WhatsApp), just not through this
  // self-serve endpoint — never trust the client's dropdown options alone.
  if (!canSelfServeReturn(reason)) {
    return fail(422, 'Online returns are available for damaged, wrong item, not-as-described, or missing-item issues. For anything else, please contact support.')
  }
  // SEC/DATA-FIX: never trust the client's Refund/Replace toggle gating —
  // re-validate resolution against the reason server-side too. Mirrors
  // admin's own canReplace(reason) check (pahadi-admin/src/lib/returns.js)
  // and the DB's returns_replace_reason_check constraint (migration 041).
  if (resolution === 'replace' && !canReplace(reason)) {
    return fail(422, 'Replacement is only available for damaged, wrong item, not as described, or missing parts.')
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

    // Only delivered orders can be returned (checked before any item lookup / photo signing).
    if (order.order_status !== 'delivered') {
      return fail(422, 'Only delivered orders can be returned')
    }

    // Enforce the 48-hour return window, measured from delivered_at ONLY (updated_at is bumped by every write to the order,
    // so using it as a fallback let any later update re-open the window). For an item that was REPLACED the window is
    // counted from the replacement instead (shipped + transit estimate, see returnWindowStart) so a damaged replacement
    // can still be returned. The extension only ever comes from a replaced return stored in the DB for the SAME variant.
    if (!order.delivered_at) {
      return fail(422, 'We could not confirm the delivery date for this order. Please contact support to raise a return.')
    }
    // Ownership check for line-item returns: if the customer specified
    // which item they're returning (order has >1 item), confirm that item
    // actually belongs to *this* order before trusting any of its fields.
    // Without this, a crafted request could reference a variant_id/
    // product_id from a completely different order/customer. The `returns`
    // table has no order_item_id column (confirmed against the real schema
    // — pahadi-admin's returns page keys off variant_id/product_id/quantity
    // directly), so the check matches on variant_id+product_id against this
    // order's own order_items rather than a synthetic id.
    let matchedQuantity: number | null = null
    if (itemId != null || variantId != null || productId != null) {
      const orderItemRows = await sbAdmin(
        'GET',
        `/rest/v1/order_items?order_id=eq.${order.id}&select=id,variant_id,product_id,quantity`,
      ).catch(() => null)
      const orderItems = Array.isArray(orderItemRows) ? orderItemRows : []
      const match = orderItems.find((it: { id: string | number; variant_id: string | number | null; product_id: string | number | null; quantity: number }) => {
        if (itemId != null && String(it.id) === String(itemId)) return true
        if (itemId == null) {
          const variantMatches = variantId != null ? String(it.variant_id) === String(variantId) : it.variant_id == null
          const productMatches = productId != null ? String(it.product_id) === String(productId) : true
          return variantMatches && productMatches
        }
        return false
      })
      if (!match) {
        return fail(403, 'That item does not belong to this order')
      }
      // Trust the DB's own product_id/variant_id/quantity for the item we
      // just verified, not whatever the client sent alongside it.
      variantId       = match.variant_id
      productId       = match.product_id
      matchedQuantity = match.quantity
      if (quantity == null || quantity > match.quantity) quantity = match.quantity
    } else {
      // Whole-order return: guard_return_item skips rows with variant_id NULL, so a client value would be stored
      // unchecked (and skew unit_refund_amount / the credit note). The amount is set by admin; quantity is fixed.
      quantity = 1
    }

    // Window check AFTER the item is resolved: the replacement extension must use the DB's variant for the item actually
    // being returned, never the client-supplied variant_id (which could point at a different, replaced item).
    let replacementShippedAt: string | null = null
    const replacedRows = await sbAdmin(
      'GET',
      `/rest/v1/returns?order_id=eq.${id}&status=eq.replaced&select=variant_id,replacement_shipped_at&order=replacement_shipped_at.desc.nullslast&limit=20`,
    ).catch(() => null)
    if (Array.isArray(replacedRows)) {
      const match = replacedRows.find((r: { variant_id: string | number | null; replacement_shipped_at: string | null }) =>
        r.replacement_shipped_at && (variantId == null ? r.variant_id == null : String(r.variant_id) === String(variantId)))
      replacementShippedAt = match?.replacement_shipped_at ?? null
    }
    const windowStart = returnWindowStart(order.delivered_at, replacementShippedAt)
    const hoursSince = windowStart == null ? NaN : (Date.now() - windowStart) / 3_600_000
    // hoursSince < 0: a replacement has been shipped but is not expected to have arrived yet - nothing to return yet.
    if (Number.isFinite(hoursSince) && hoursSince < 0) {
      return fail(422, replacementShippedAt
        ? 'Your replacement is still on its way. You can raise a return once it has been delivered.'
        : 'We could not confirm the delivery date for this order. Please contact support to raise a return.')
    }
    if (!Number.isFinite(hoursSince) || hoursSince > RETURNABLE_WINDOW_HOURS) {
      return fail(422, `Return window has closed (${RETURNABLE_WINDOW_HOURS} hours from ${replacementShippedAt ? 'delivery of your replacement' : 'delivery'})`)
    }

    // Idempotency check — confirmed real schema: a return "in progress" means
    // any row in `returns` for this order/item whose status is still active
    // (the admin's real 6-value lifecycle: requested → approved → received →
    // refunded/replaced, or rejected — see pahadi-admin/src/lib/returns.js
    // RETURN_STATUSES).
    // NOTE (Nov 2026 audit): 'replaced' is terminal — the customer holds a new unit and may return it if it is damaged too
    // (db_migration_v24 made the unique index and guard_return_item agree). The pre-check below mirrors the index.
    // BUG FIX: scoped to the same item (variant_id), matching admin's own
    // client-side duplicate check (pahadi-admin/src/app/admin/returns/page.jsx
    // — `(r.variant_id||null) === (form.variant_id||null)`). Without this, a
    // multi-item order with an in-progress return on item A would incorrectly
    // block a customer from requesting a separate return on item B.
    const existingReturns = await sbAdmin(
      'GET',
      `/rest/v1/returns?order_id=eq.${id}&select=id,status,variant_id&order=created_at.desc`,
    ).catch(() => null)
    // BUG FIX (pre-existing, not introduced by this change): this used to
    // only exclude 'rejected', meaning a customer whose return was
    // successfully 'refunded' could never submit another return on that
    // item again — e.g. a second, unrelated defective delivery of the same
    // product on a later reorder would be permanently blocked. Admin's own
    // terminal-state exclusion list (pahadi-admin/src/lib/returns.js
    // RETURN_STATUSES usage + the three identical filters in
    // admin/returns/page.jsx) now excludes 'refunded', 'rejected', and
    // 'replaced' — matched here.
    // The DB is the source of truth: unique index ux_returns_active_order_item is on
    // (order_id, coalesce(variant_id,-1)) WHERE status <> ALL('refunded','rejected','replaced') and a whole-order
    // return (key -1) is a separate key from item returns. The route additionally refuses to mix the two kinds (open whole-order
    // return + open item return) because they would double-count the same goods.
    const existingList = Array.isArray(existingReturns) ? existingReturns : []
    const openList = existingList.filter((r: { status: string }) => !INDEX_TERMINAL_RETURN_STATUSES.includes(r.status))
    const isWholeOrder = variantId == null
    const existing = openList.find((r: { variant_id: string | number | null }) =>
      isWholeOrder || r.variant_id == null || String(r.variant_id) === String(variantId)
    )
    if (existing) {
      return fail(409, 'A return request is already in progress for this item')
    }

    // Photo evidence → verified object paths (only now: authenticated, and the order is this customer's). A path that does
    // not exist in the private bucket cannot be signed and is silently dropped. Read links are minted on view (L-8).
    if (photoPaths.length > 0) {
      photoUrls = await verifyEvidencePaths(photoPaths, { url: process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey: process.env.SUPABASE_SERVICE_KEY! })
    }

    // customer_name — matches the field admin's own return-creation flow
    // populates (pahadi-admin/src/app/admin/returns/page.jsx).
    const customerName = [
      (profile as { first_name?: string }).first_name,
      (profile as { last_name?: string }).last_name,
    ].filter(Boolean).join(' ').trim() || null

    // INSERT into the dedicated `returns` table — matching the exact live
    // schema (confirmed via information_schema.columns, cross-checked
    // against pahadi-admin's create_return handler in
    // src/app/api/admin/route.js so both repos write the identical shape).
    // `reason` and `description` are separate real columns, so the
    // free-text "Other" explanation goes in `description` rather than
    // being concatenated into `reason`. variant_id/product_id/quantity are
    // populated when the customer picked a specific item (verified above
    // against this order's own order_items); left null for a whole-order
    // return, same as before. `resolution` records the customer's
    // Refund/Replace choice — replacement_variant_id/replacement_quantity
    // are intentionally left for admin staff to assign once they've
    // inspected the return (mirrors admin's own flow: the customer says
    // *that* they want a replacement, not *which* variant ships back).
    // `refund_amount` and `unit_refund_amount`/`refund_gst_amount` are left
    // unset here for the same reason. `status` defaults to 'requested' in
    // the DB but is set explicitly for clarity. orders.payment_status is
    // deliberately NOT touched here — per admin's STATUS_PAYMENT_MAP,
    // 'requested' has no payment-status side effect; only a later
    // admin-driven transition does.
    try {
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
        variant_id:    variantId,
        product_id:    productId,
        quantity:      quantity ?? 1,
        resolution,
        photo_urls:    photoUrls.length > 0 ? photoUrls : null,
      },
      'return=minimal',
    )
    } catch (insertErr) {
      // Read-then-insert races (double click) and DB-only rules surface here, not in the pre-check.
      const code = pgErrorCode(insertErr)
      if (code === '23505') return fail(409, 'A return request is already in progress for this item')
      if (code === '23514') return fail(422, 'This item has already been returned (or has a return in progress) for the full quantity you bought.')
      throw insertErr
    }

    const res = ok({
      success: true,
      message: resolution === 'replace'
        ? `Replacement request submitted for order ${order.order_number}. Our team will contact you within 24–48 hours.`
        : `Return request submitted for order ${order.order_number}. Our team will contact you within 24–48 hours.`,
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
