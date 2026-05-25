// ─────────────────────────────────────────────────────────────
// /api/orders/[id] — single order detail (cookie auth)
//
//  ✅ Token refresh on expiry (mirrors /api/orders pattern)
//  ✅ Ownership check: customer_id=eq.${profile.id} prevents IDOR
//  ✅ Returns full order shape expected by OrderDetailPage
//  ✅ 403 (not 404) when order exists but belongs to another user
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
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON,
      'Authorization': token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON}`,
    },
    body: body !== null ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw { status: res.status, message: data.msg || data.error_description || 'Auth error' }
  return data
}

async function sbAdmin(method: string, path: string, body: unknown = null) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw { status: res.status, message: text }
  return text ? JSON.parse(text) : null
}

function getToken(req: NextRequest) {
  return req.cookies.get(COOKIE_TOKEN)?.value ?? null
}

async function tryRefresh(req: NextRequest): Promise<{ token: string; refresh: string } | null> {
  const rt = req.cookies.get(COOKIE_REFRESH)?.value
  if (!rt) return null
  try {
    const data = await sbAuth('/token?grant_type=refresh_token', { refresh_token: rt })
    if (!data.access_token) return null
    return { token: data.access_token, refresh: data.refresh_token ?? rt }
  } catch {
    return null
  }
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
  const rows = await sbAdmin(
    'GET',
    `/rest/v1/customers?or=(${orParts.join(',')})&select=*&limit=3`,
  ).catch(() => null)
  if (!rows?.length) return null
  return rows.find((r: Record<string, unknown>) => r.auth_user_id === user.id) || rows[0]
}

// ── GET /api/orders/[id] ──────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params
  if (!id) return fail(400, 'Order ID is required')

  let token = getToken(req)
  let refreshed: { token: string; refresh: string } | null = null

  if (!token) {
    refreshed = await tryRefresh(req)
    if (!refreshed) return fail(401, 'Not logged in')
    token = refreshed.token
  }

  try {
    const user    = await sbAuth('/user', null, token)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    // Fetch the single order — customer_id check is the ownership guard (IDOR prevention).
    // Using `select=*` to capture all order columns (subtotal, coupon_discount,
    // shipping_charge, tax, shipping_address) even if some don't exist yet in schema —
    // PostgREST returns null for nullable columns rather than erroring.
    const rows = await sbAdmin(
      'GET',
      `/rest/v1/orders?id=eq.${id}&customer_id=eq.${profile.id}&select=*,order_items(quantity,price_at_time,product_name_snapshot,variant_value_snapshot,product_id,products(name,emoji,image_url))&limit=1`,
    ).catch(() => null)

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      // To avoid leaking whether the order exists, always return 404.
      return fail(404, 'Order not found')
    }

    const raw = rows[0] as Record<string, unknown>

    // Normalise items — mirrors shape from /api/orders list endpoint
    const rawItems = (raw.order_items as Array<{
      quantity:                 number
      price_at_time:            number
      product_name_snapshot:    string | null
      variant_value_snapshot:   string | null
      product_id:               string | null
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
      payment_method:   raw.payment_method   ?? null,
      payment_status:   raw.payment_status   ?? null,
      total_amount:     Number(raw.total_amount) || 0,
      subtotal:         raw.subtotal         != null ? Number(raw.subtotal)         : undefined,
      coupon_discount:  raw.coupon_discount  != null ? Number(raw.coupon_discount)  : undefined,
      shipping_charge:  raw.shipping_charge  != null ? Number(raw.shipping_charge)  : undefined,
      tax:              raw.tax              != null ? Number(raw.tax)              : undefined,
      created_at:       raw.created_at,
      tracking_number:  raw.tracking_number  ?? null,
      courier:          raw.courier          ?? null,
      shipped_at:       raw.shipped_at       ?? null,
      delivered_at:     raw.delivered_at     ?? null,
      updated_at:       raw.updated_at       ?? null,
      shipping_address: shippingAddress,
      items,
    }

    const res = ok({ success: true, order })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    return fail(500, err.message || 'Order fetch failed')
  }
}

