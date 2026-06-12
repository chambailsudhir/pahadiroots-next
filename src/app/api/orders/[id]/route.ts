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

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params
  if (!id) return fail(400, 'Order ID is required')

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
    const rows = await sbAdmin(
      'GET',
      `/rest/v1/orders?id=eq.${id}&customer_id=eq.${profile.id}&select=*,order_items(quantity,price_at_time,product_name_snapshot,variant_value_snapshot,product_id,products(name,emoji,image_url))&limit=1`,
    ).catch(() => null)

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return fail(404, 'Order not found')
    }

    const raw = rows[0] as Record<string, unknown>

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

    const order = {
      id:               raw.id,
      order_number:     raw.order_number,
      order_status:     String(raw.order_status || ''),
      payment_method:   raw.payment_method  ?? null,
      payment_status:   raw.payment_status  ?? null,
      total_amount:     Number(raw.total_amount) || 0,
      subtotal:         raw.subtotal        != null ? Number(raw.subtotal)        : undefined,
      coupon_discount:  raw.coupon_discount != null ? Number(raw.coupon_discount) : undefined,
      shipping_charge:  raw.shipping_charge != null ? Number(raw.shipping_charge) : undefined,
      tax:              raw.tax             != null ? Number(raw.tax)             : undefined,
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
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    return fail(500, err.message || 'Order fetch failed')
  }
}
