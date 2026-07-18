// ─────────────────────────────────────────────────────────────
// /api/orders — paginated + searchable orders route
//
//  ✅ GET ?page=&limit=&search=&status=
//  ✅ Returns { success, orders, total, page, pages, stats }
//  ✅ stats now includes loyalty_points balance (from updated RPC)
//  ✅ Token refresh on expiry
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin, sbAdminCount,
  getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile,
} from '@/lib/api/serverUtils'
import { RETURNS_FILTER_SENTINEL, RETURN_STATUS_TO_DISPLAY } from '@/lib/account/constants'

// All statuses that actually exist in the orders.order_status column.
// ARCHITECTURE FIX (see PAHADI_ROOTS_SESSION_REPORT.md §2): confirmed live,
// order_status_enum has exactly 7 values. There is no return_* or refund_*
// value here — returns live entirely in the separate `returns` table, joined
// in below. The "Returns" tab is now handled via RETURNS_FILTER_SENTINEL
// (an inner join on `returns`), not by filtering order_status.
const VALID_DB_STATUSES = new Set([
  'pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned',
])

async function getCustomerOrders(
  customerId: string | number,
  { page, limit, search, status }: { page: number; limit: number; search: string; status: string },
) {
  const offset = (page - 1) * limit

  // "Returns" tab: no order_status value ever represents a return (see
  // architecture note above), so this is an inner join against `returns`
  // instead of an order_status filter — `returns!inner` restricts results
  // to orders that actually have at least one linked return row.
  const isReturnsTab = status === RETURNS_FILTER_SENTINEL
  const returnsEmbed = isReturnsTab
    ? 'returns!inner(id,status,reason,description,refund_amount,created_at,updated_at)'
    : 'returns(id,status,reason,description,refund_amount,created_at,updated_at)'

  let statusFilter = ''
  if (status && !isReturnsTab) {
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

  // BUG FIX: sbAdminCount does a plain HEAD count against `baseFilter` with no
  // embed — fine for order_status-based tabs, but for the Returns tab the
  // count must reflect the inner-join restriction too, or the pager will
  // think there are more pages than actually exist. Count via the embedded
  // query's Content-Range instead of a separate bare HEAD when on that tab.
  const total = isReturnsTab
    ? await sbAdminCount(`${baseFilter}&select=id,${returnsEmbed}`)
    : await sbAdminCount(baseFilter)

  const rows = await sbAdmin(
    'GET',
    `${baseFilter}&select=id,order_number,order_status,payment_method,payment_status,total_amount,created_at,tracking_number,courier,shipped_at,delivered_at,updated_at,loyalty_points_redeemed,loyalty_points_earned,order_items(quantity,price_at_time,product_name_snapshot,variant_value_snapshot,product_id,products(emoji,image_url)),${returnsEmbed}&order=created_at.desc&limit=${limit}&offset=${offset}`,
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
    // Most recent return row for this order, if any (returns!inner still
    // comes back as an array embed under the `returns` key either way).
    const returnsArr = Array.isArray(o.returns) ? o.returns : []
    const ret = returnsArr.length > 0
      ? [...returnsArr].sort((a: { created_at?: string }, b: { created_at?: string }) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0]
      : null
    const rawSt = String(o.order_status || '')
    // A return in progress takes priority over the underlying order_status
    // for display purposes — the order itself stays 'delivered' throughout,
    // but the customer needs to see where their *return* actually is.
    const displayStatus = (ret && RETURN_STATUS_TO_DISPLAY[(ret as { status: string }).status])
      || rawSt
    return {
      id: o.id, order_number: o.order_number, order_status: rawSt,
      _displayStatus: displayStatus,
      payment_method: o.payment_method || null, payment_status: o.payment_status || null,
      total_amount: Number(o.total_amount) || 0, created_at: o.created_at,
      tracking_number: o.tracking_number || null, courier: o.courier || null,
      shipped_at: o.shipped_at || null, delivered_at: o.delivered_at || null,
      updated_at: o.updated_at || null, items, _return: ret,
      loyalty_points_earned:   Number(o.loyalty_points_earned)   || 0,
      loyalty_points_redeemed: Number(o.loyalty_points_redeemed) || 0,
    }
  })

  return { orders, total, page, pages: Math.ceil(total / limit) }
}

// ── Fetch stats via DB-level aggregation RPC ───────────────────
// Updated RPC now also returns loyalty_points balance.
// Falls back gracefully if the new RPC column doesn't exist yet.
async function getStatsFromRpc(
  customerId: string | number,
): Promise<{
  delivered: number; active: number; cancelled: number;
  spent: number; loyalty_points: number
} | null> {
  try {
    const result = await sbAdmin(
      'POST',
      '/rest/v1/rpc/get_customer_order_stats',
      { p_customer_id: customerId },
    )
    const row = Array.isArray(result) ? result[0] : result
    if (!row) return null
    return {
      delivered:      Number(row.delivered)      || 0,
      active:         Number(row.active)         || 0,
      cancelled:      Number(row.cancelled)      || 0,
      spent:          Number(row.spent)          || 0,
      // New column added in db_migration_v4_loyalty.sql
      loyalty_points: Number(row.loyalty_points) || 0,
    }
  } catch (err) {
    // BUG FIX [ERROR HANDLING]: previously bare `catch` with no logging — if the
    // get_customer_order_stats RPC is missing, times out, or returns an error, the
    // stats block silently returns null and the account page shows blank stats.
    // Ops had no way to detect a broken/missing RPC. Added console.error.
    console.error('[getStatsFromRpc] failed:', err)
    return null
  }
}

// ── GET /api/orders?page=1&limit=20&search=&status= ───────────
export async function GET(req: NextRequest) {
  let token = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  const { searchParams } = req.nextUrl
  const page   = Math.max(1, parseInt(searchParams.get('page')  || '1', 10))
  const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
  // BUG FIX: no length cap on the search param — an arbitrarily long value was
  // interpolated directly into the Supabase ilike filter URL (unbounded string
  // in a serverless HTTP call). Cap at 100 chars to match the searchSchema limit.
  const search = (searchParams.get('search') || '').trim().slice(0, 100)
  const status = (searchParams.get('status') || '').trim()

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

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
    // BUG FIX [ERROR HANDLING]: previously exposed raw err.message (Supabase internals) with no logging.
    console.error('[orders GET]', e)
    return fail(500, process.env.NODE_ENV === 'production' ? 'Orders fetch failed' : (err.message || 'Orders fetch failed'))
  }
}
