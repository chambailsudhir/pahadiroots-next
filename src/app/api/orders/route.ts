// ─────────────────────────────────────────────────────────────
// /api/orders — paginated + searchable orders route
//
//  ✅ GET ?page=&limit=&search=&status=
//  ✅ Returns { success, orders, total, page, pages }
//  ✅ Token refresh on expiry
//  ✅ Count via Prefer: count=exact (O(1) — no full table scan)
//  ✅ Stats merged into single aggregation query (was two separate full scans)
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_TOKEN, COOKIE_REFRESH } from '@/lib/auth/cookies'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function ok(data: unknown)                 { return NextResponse.json(data) }
function fail(status: number, msg: string) { return NextResponse.json({ error: msg }, { status }) }

async function sbAuth(path: string, body: unknown = null, token?: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method:  body !== null ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON,
               'Authorization': token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON}` },
    body: body !== null ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw { status: res.status, message: data.msg || data.error_description || 'Auth error' }
  return data
}

// sbAdminCount — uses HEAD + Prefer:count=exact to get total rows in O(1).
// PostgREST returns the count in the Content-Range header: "0-19/847"
// This replaces the old pattern of fetching ALL matching IDs (select=id, no limit),
// which was a full table scan on every page load for customers with many orders.
async function sbAdminCount(path: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'HEAD',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        'count=exact',
    },
  })
  if (!res.ok) return 0
  // Content-Range: <start>-<end>/<total>  e.g. "0-19/847" or "*/0" when empty
  const contentRange = res.headers.get('content-range') || ''
  const match = contentRange.match(/\/(\d+)$/)
  return match ? parseInt(match[1], 10) : 0
}

async function sbAdmin(method: string, path: string, body: unknown = null) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY,
               'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw { status: res.status, message: text }
  return text ? JSON.parse(text) : null
}

function getToken(req: NextRequest) { return req.cookies.get(COOKIE_TOKEN)?.value ?? null }

async function tryRefresh(req: NextRequest) {
  const rt = req.cookies.get(COOKIE_REFRESH)?.value
  if (!rt) return null
  try {
    const data = await sbAuth('/token?grant_type=refresh_token', { refresh_token: rt })
    if (!data.access_token) return null
    return { token: data.access_token, refresh: data.refresh_token ?? rt }
  } catch { return null }
}

function applyNewCookies(res: NextResponse, access: string, refresh: string) {
  const IS_PROD = process.env.NODE_ENV === 'production'
  const base = { httpOnly: true, secure: IS_PROD, sameSite: 'strict' as const, path: '/' }
  res.cookies.set(COOKIE_TOKEN,   access,  { ...base, maxAge: 60 * 60 })
  res.cookies.set(COOKIE_REFRESH, refresh, { ...base, maxAge: 60 * 60 * 24 * 30 })
}

async function syncCustomerProfile(user: { id: string; phone?: string; email?: string }) {
  const orParts = [`auth_user_id.eq.${user.id}`]
  if (user.phone) orParts.push(`phone.eq.${encodeURIComponent(user.phone)}`)
  if (user.email) orParts.push(`email.eq.${encodeURIComponent(user.email)}`)
  const rows = await sbAdmin('GET', `/rest/v1/customers?or=(${orParts.join(',')})&select=*&limit=3`).catch(() => null)
  if (!rows?.length) return null
  return rows.find((r: Record<string, unknown>) => r.auth_user_id === user.id) || rows[0]
}

const STATUS_MAP: Record<string, string> = {
  pending:'pending', confirmed:'confirmed', processing:'processing', packed:'packed',
  shipped:'shipped', delivered:'delivered', cancelled:'cancelled', returned:'returned',
  refunded:'refunded', return_requested:'return_requested', return_approved:'return_approved',
  return_received:'return_received', refund_initiated:'refund_initiated',
  refund_completed:'refund_completed', return_rejected:'return_rejected',
}

async function getCustomerOrders(
  customerId: string | number,
  { page, limit, search, status }: { page: number; limit: number; search: string; status: string }
) {
  const offset = (page - 1) * limit

  // Build status filter
  let statusFilter = ''
  if (status) {
    const statuses = status.split(',').map(s => `order_status.eq.${s.trim()}`).join(',')
    statusFilter = `&or=(${statuses})`
  }

  // Build search filter (order_number contains)
  let searchFilter = ''
  if (search) {
    searchFilter = `&order_number=ilike.*${encodeURIComponent(search)}*`
  }

  const baseFilter = `/rest/v1/orders?customer_id=eq.${customerId}${statusFilter}${searchFilter}`

  // Get total count via Prefer:count=exact — O(1), no rows returned.
  // Previously this fetched all matching IDs (select=id, no limit) — a full table
  // scan on every page load for customers with many orders.
  const total = await sbAdminCount(baseFilter)

  // Get paginated rows
  const rows = await sbAdmin(
    'GET',
    `${baseFilter}&select=id,order_number,order_status,payment_method,payment_status,total_amount,created_at,tracking_number,courier,shipped_at,delivered_at,updated_at,order_items(quantity,price_at_time,product_name_snapshot,variant_value_snapshot,product_id,products(emoji,image_url)),returns(id,status,reason,created_at)&order=created_at.desc&limit=${limit}&offset=${offset}`
  ).catch(() => [])

  const orders = (rows || []).map((o: Record<string, unknown>) => {
    const rawItems = (o.order_items as Array<{
      quantity: number; price_at_time: number; product_name_snapshot: string | null;
      variant_value_snapshot: string | null; product_id: string | null;
      products?: { emoji?: string; image_url?: string }
    }>) || []
    const items = rawItems.map(i => ({
      qty: i.quantity, price: i.price_at_time,
      name: i.product_name_snapshot || 'Product',
      variant: i.variant_value_snapshot || null,
      emoji: i.products?.emoji || '🌿',
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

// ── GET /api/orders?page=1&limit=20&search=&status= ──────────
export async function GET(req: NextRequest) {
  let token = getToken(req)
  let refreshed: { token: string; refresh: string } | null = null

  if (!token) {
    refreshed = await tryRefresh(req)
    if (!refreshed) return fail(401, 'Not logged in')
    token = refreshed.token
  }

  const { searchParams } = req.nextUrl
  const page   = Math.max(1, parseInt(searchParams.get('page')  || '1', 10))
  const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
  const search = (searchParams.get('search') || '').trim()
  const status = (searchParams.get('status') || '').trim()

  try {
    const user    = await sbAuth('/user', null, token)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    const result = await getCustomerOrders(profile.id, { page, limit, search, status })

    // Fetch summary stats only on first page with no filters.
    // Single query selecting only the two columns needed for aggregation —
    // previously this was a separate full-table fetch (select=order_status,total_amount)
    // running on every unfiltered page 1 load, in addition to the count scan.
    let stats = null
    if (page === 1 && !search && !status) {
      const allRows = await sbAdmin('GET',
        `/rest/v1/orders?customer_id=eq.${profile.id}&select=order_status,total_amount`
      ).catch(() => [])
      if (Array.isArray(allRows)) {
        stats = {
          delivered: allRows.filter((o: Record<string, string>) => o.order_status === 'delivered').length,
          active:    allRows.filter((o: Record<string, string>) => ['confirmed','processing','packed','shipped'].includes(o.order_status)).length,
          cancelled: allRows.filter((o: Record<string, string>) => o.order_status === 'cancelled').length,
          spent:     allRows
            .filter((o: Record<string, string>) => o.order_status !== 'cancelled')
            .reduce((s: number, o: Record<string, unknown>) => s + (Number(o.total_amount) || 0), 0),
        }
      }
    }

    const res = ok({ success: true, ...result, ...(stats ? { stats } : {}) })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    return fail(500, err.message || 'Orders fetch failed')
  }
}
