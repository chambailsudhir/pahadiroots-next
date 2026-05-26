// ─────────────────────────────────────────────────────────────
// /api/orders — paginated + searchable orders route
//
//  ✅ GET ?page=&limit=&search=&status=
//  ✅ Returns { success, orders, total, page, pages }
//  ✅ Token refresh on expiry
//  ✅ Count via Prefer:count=exact (O(1) — no full table scan)
//
// Fix 3: Stats now fetched via get_customer_order_stats RPC
//   (DB-level aggregation — avoids full table scan on every load).
//   Graceful fallback to null if RPC is not yet deployed; the client
//   computes stats from the loaded page-1 orders in that case.
//
//   Run this SQL in Supabase once to enable the fast path:
//   ↓ see /sql/migrations/get_customer_order_stats.sql
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin, sbAdminCount,
  getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile,
} from '@/lib/api/serverUtils'

// Confirmed enum values from pg_enum — DO NOT add values not in this list
// or PostgREST will throw "invalid input value for enum order_status_enum"
const VALID_DB_STATUSES = new Set([
  'pending', 'confirmed', 'packed', 'shipped',
  'delivered', 'cancelled', 'returned',
])

// Display-label map: DB status -> UI display status
// The extra keys (return_requested etc.) are set by the app on orders
// that have a return record; they are display-only, never written to
// order_status in the DB.
const STATUS_MAP: Record<string, string> = {
  pending:          'pending',
  confirmed:        'confirmed',
  packed:           'packed',
  shipped:          'shipped',
  delivered:        'delivered',
  cancelled:        'cancelled',
  returned:         'returned',
  return_requested: 'return_requested',
  return_approved:  'return_approved',
  return_received:  'return_received',
  refund_initiated: 'refund_initiated',
  refund_completed: 'refund_completed',
  return_rejected:  'return_rejected',
}

async function getCustomerOrders(
  customerId: string | number,
  { page, limit, search, status }: { page: number; limit: number; search: string; status: string },
) {
  const offset = (page - 1) * limit

  let statusFilter = ''
  if (status) {
    // Only pass values that exist in the DB enum — unknown values would
    // cause PostgREST to throw "invalid input value for enum order_status_enum"
    const validStatuses = status
      .split(',')
      .map(s => s.trim())
      .filter(s => VALID_DB_STATUSES.has(s))
      .map(s => `order_status.eq.${s}`)
      .join(',')
    if (validStatuses) statusFilter = `&or=(${validStatuses})`
  }

  let searchFilter = ''
  if (search) {
    searchFilter = `&order_number=ilike.*${encodeURIComponent(search)}*`
  }

  const baseFilter = `/rest/v1/orders?customer_id=eq.${customerId}${statusFilter}${searchFilter}`

  // O(1) count — no rows returned
  const total = await sbAdminCount(baseFilter)

  const rows = await sbAdmin(
    'GET',
    `${baseFilter}&select=id,order_number,order_status,payment_method,payment_status,total_amount,created_at,tracking_number,courier,shipped_at,delivered_at,updated_at,order_items(quantity,price_at_time,product_name_snapshot,variant_value_snapshot,product_id,products(emoji,image_url)),returns(id,status,reason,created_at)&order=created_at.desc&limit=${limit}&offset=${offset}`,
  ).catch(() => [])

  const orders = (rows || []).map((o: Record<string, unknown>) => {
    const rawItems = (o.order_items as Array<{
      quantity: number; price_at_time: number; product_name_snapshot: string | null
      variant_value_snapshot: string | null; product_id: string | null
      products?: { emoji?: string; image_url?: string }
    }>) || []
    const items = rawItems.map(i => ({
      qty:       i.quantity,
      price:     i.price_at_time,
      name:      i.product_name_snapshot || 'Product',
      variant:   i.variant_value_snapshot || null,
      emoji:     i.products?.emoji     || '🌿',
      image_url: i.products?.image_url || null,
    }))
    const ret   = Array.isArray(o.returns) && o.returns.length > 0 ? o.returns[0] : null
    const rawSt = String(o.order_status || '')
    return {
      id: o.id, order_number: o.order_number, order_status: rawSt,
      _displayStatus: STATUS_MAP[rawSt] || rawSt,
      payment_method: o.payment_method || null, payment_status: o.payment_status || null,
      total_amount: Number(o.total_amount) || 0, created_at: o.created_at,
      tracking_number: o.tracking_number || null, courier: o.courier || null,
      shipped_at: o.shipped_at || null, delivered_at: o.delivered_at || null,
      updated_at: o.updated_at || null, items, _return: ret,
    }
  })

  return { orders, total, page, pages: Math.ceil(total / limit) }
}

// ── Fetch stats via DB-level aggregation RPC ──────────────────
// Replaces the old approach of fetching ALL order rows for aggregation.
// Returns null if the RPC function hasn't been deployed yet; the client
// falls back to computing stats from the page-1 orders already in memory.
//
// Deploy the function with:
//   supabase/migrations/get_customer_order_stats.sql   (provided separately)
async function getStatsFromRpc(
  customerId: string | number,
): Promise<{ delivered: number; active: number; cancelled: number; spent: number } | null> {
  try {
    const result = await sbAdmin(
      'POST',
      '/rest/v1/rpc/get_customer_order_stats',
      { p_customer_id: customerId },
    )
    // RPC returns an array with one row
    const row = Array.isArray(result) ? result[0] : result
    if (!row) return null
    return {
      delivered: Number(row.delivered) || 0,
      active:    Number(row.active)    || 0,
      cancelled: Number(row.cancelled) || 0,
      spent:     Number(row.spent)     || 0,
    }
  } catch {
    // RPC not yet deployed or failed — return null so client handles gracefully
    return null
  }
}

// ── GET /api/orders?page=1&limit=20&search=&status= ──────────
export async function GET(req: NextRequest) {
  let token = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  const { searchParams } = req.nextUrl
  const page   = Math.max(1, parseInt(searchParams.get('page')  || '1', 10))
  const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
  const search = (searchParams.get('search') || '').trim()
  const status = (searchParams.get('status') || '').trim()

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    // Run paginated orders + stats in parallel when both are needed.
    // Stats only on page 1 with no active filters (otherwise they'd be
    // filtered-subset stats, not the user's true account totals).
    const needsStats = page === 1 && !search && !status

    const [result, stats] = await Promise.all([
      getCustomerOrders(profile.id, { page, limit, search, status }),
      needsStats ? getStatsFromRpc(profile.id) : Promise.resolve(null),
    ])

    const res = ok({
      success: true,
      ...result,
      ...(stats ? { stats } : {}),
    })
    ;(res as NextResponse).headers.set('Cache-Control', 'private, no-store')
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    return fail(500, err.message || 'Orders fetch failed')
  }
}
