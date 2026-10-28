// ─────────────────────────────────────────────────────────────
// /api/orders/[id] — single order detail (cookie auth)
//
//  ✅ Token refresh on expiry
//  ✅ Ownership check: customer_id=eq.${profile.id} prevents IDOR
//  ✅ Returns full order shape expected by OrderDetailPage
//  ✅ 403 (not 404) when order exists but belongs to another user
//  ✅ Shared helpers from serverUtils (no duplication)
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin,
  getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile,
} from '@/lib/api/serverUtils'
import { RETURN_STATUS_TO_DISPLAY } from '@/lib/account/constants'
import { getRequestId, requestLogger, withRequestId } from '@/lib/logger'

export async function GET(
  req: NextRequest,
  // BUG FIX (Next.js 15+/16 migration): `params` is now a Promise.
  { params }: { params: Promise<{ id: string }> },
) {
  // AUDIT G2 B1: correlation id on every log line + echoed on the response.
  const requestId = getRequestId(req.headers)
  const log = requestLogger(requestId, { route: 'orders.detail' })
  const { id } = await params
  if (!id) return withRequestId(fail(400, 'Order ID is required'), requestId)

  // BUG FIX: raw `id` from the URL path was interpolated directly into the
  // Supabase REST URL with no format validation. A crafted path like
  // /api/orders/1;DROP TABLE orders-- would be sent verbatim to the DB REST API.
  // PostgREST parameterises values, so SQL injection is unlikely, but rejecting
  // invalid formats early is defence-in-depth and prevents log noise.
  const isValidId =
    /^[0-9]+$/.test(id) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  if (!isValidId) return fail(400, 'Invalid order ID')

  let token = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    // customer_id=eq.${profile.id} is the IDOR guard.
    // select=* captures all columns so newly added schema columns
    // (subtotal, shipping_charge, tax) work without route changes.
    // ARCHITECTURE FIX (see PAHADI_ROOTS_SESSION_REPORT.md §2): returns live
    // in a separate `returns` table, not on orders.order_status — joined
    // here so the detail page can show real return status/reason instead of
    // reading order_status values that never actually occur for a return.
    const rows = await sbAdmin(
      'GET',
      `/rest/v1/orders?id=eq.${id}&customer_id=eq.${profile.id}&select=*,order_items(quantity,price_at_time,product_name_snapshot,variant_value_snapshot,product_id,products(name,emoji,image_url)),returns(id,status,reason,description,refund_amount,created_at,updated_at)&limit=1`,
    ).catch(() => null)

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return withRequestId(fail(404, 'Order not found'), requestId)
    }

    const raw = rows[0] as Record<string, unknown>

    // AUDIT S3-006: the Price Details card derives the (unstored) prepaid/loyalty discount from the
    // stored columns via lib/invoiceGst computeOrderInvoice; points × loyalty_points_value splits it.
    // Best effort — a missing setting only collapses the two rows into one labelled line.
    const pointValueRows = await Promise.resolve()
      .then(() => sbAdmin('GET', '/rest/v1/site_settings?key=eq.loyalty_points_value&select=value&limit=1'))
      .catch(() => null)
    const loyaltyPointValue = Array.isArray(pointValueRows) && pointValueRows[0]?.value != null
      ? Number(pointValueRows[0].value)
      : null

    const rawItems = (raw.order_items as Array<{
      quantity:               number
      price_at_time:          number
      product_name_snapshot:  string | null
      variant_value_snapshot: string | null
      product_id:             string | null
      products?: { name?: string; emoji?: string; image_url?: string }
    }>) || []

    const items = rawItems.map(i => ({
      qty:       i.quantity,
      price:     i.price_at_time,
      name:      i.product_name_snapshot || i.products?.name || 'Product',
      variant:   i.variant_value_snapshot || null,
      emoji:     i.products?.emoji     || '🌿',
      image_url: i.products?.image_url || null,
    }))

    // Normalise shipping_address — may be a JSONB object or stringified JSON
    let shippingAddress: Record<string, string> | undefined
    const rawAddr = raw.shipping_address
    if (rawAddr && typeof rawAddr === 'object' && !Array.isArray(rawAddr)) {
      shippingAddress = rawAddr as Record<string, string>
    } else if (typeof rawAddr === 'string') {
      try { shippingAddress = JSON.parse(rawAddr) } catch { /* leave undefined */ }
    }

    // Most recent return row for this order, if any.
    const returnsArr = Array.isArray(raw.returns) ? raw.returns as Array<{
      id: unknown; status: string; reason: string | null; description: string | null
      refund_amount: number | null; created_at: string; updated_at: string | null
    }> : []
    const ret = returnsArr.length > 0
      ? [...returnsArr].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0]
      : null
    const rawStatus = String(raw.order_status || '')
    // A return in progress takes priority for display purposes — the order
    // itself stays 'delivered' throughout its return lifecycle (see
    // PAHADI_ROOTS_SESSION_REPORT.md §2).
    const displayStatus = (ret && RETURN_STATUS_TO_DISPLAY[ret.status]) || rawStatus

    const order = {
      id:               raw.id,
      order_number:     raw.order_number,
      order_status:     rawStatus,
      _displayStatus:   displayStatus,
      _return:          ret,
      payment_method:   raw.payment_method  ?? null,
      payment_status:   raw.payment_status  ?? null,
      total_amount:     Number(raw.total_amount) || 0,
      subtotal:         raw.subtotal        != null ? Number(raw.subtotal)        : undefined,
      coupon_discount:  raw.coupon_discount != null ? Number(raw.coupon_discount) : undefined,
      shipping_charge:  raw.shipping_charge != null ? Number(raw.shipping_charge) : undefined,
      cod_surcharge:    raw.cod_surcharge   != null ? Number(raw.cod_surcharge)   : undefined,
      tax:              raw.tax             != null ? Number(raw.tax)             : undefined,
      cgst:             raw.cgst            != null ? Number(raw.cgst)            : undefined,
      sgst:             raw.sgst            != null ? Number(raw.sgst)            : undefined,
      igst:             raw.igst            != null ? Number(raw.igst)            : undefined,
      round_off:        raw.round_off       != null ? Number(raw.round_off)       : undefined,
      loyalty_points_redeemed: raw.loyalty_points_redeemed != null ? Number(raw.loyalty_points_redeemed) : undefined,
      loyalty_point_value: Number.isFinite(loyaltyPointValue as number) ? loyaltyPointValue : undefined,
      created_at:       raw.created_at,
      tracking_number:  raw.tracking_number ?? null,
      courier:          raw.courier         ?? null,
      shipped_at:       raw.shipped_at      ?? null,
      delivered_at:     raw.delivered_at    ?? null,
      updated_at:       raw.updated_at      ?? null,
      shipping_address: shippingAddress,
      items,
    }

    const res = ok({ success: true, order })
    ;(res as NextResponse).headers.set('Cache-Control', 'private, no-store')
    withRequestId(res as NextResponse, requestId)
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return withRequestId(fail(401, 'Session expired — please login again'), requestId)
    // AUDIT S2-022: PostgREST / upstream text is logged, never returned to the client.
    log.error('order_detail_failed', { error: err.message || String(e) })
    return withRequestId(fail(500, 'Order fetch failed. Please quote reference ' + requestId), requestId)
  }
}
