// ─────────────────────────────────────────────────────────────
// /api/orders — dedicated orders route (split from monolith)
//
// GET → fetch orders for authenticated user (reads httpOnly cookie)
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

function getToken(req: NextRequest): string | null {
  return req.cookies.get(COOKIE_TOKEN)?.value ?? null
}

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

// ── GET /api/orders ──────────────────────────────────────────
export async function GET(req: NextRequest) {
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

    const orders  = await getCustomerOrders(profile.id)
    const res = ok({ success: true, orders })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    return fail(500, err.message || 'Orders fetch failed')
  }
}

// ── syncCustomerProfile ──────────────────────────────────────
async function syncCustomerProfile(user: { id: string; phone?: string; email?: string }) {
  const phone = user.phone || ''
  const email = user.email || ''
  const orParts = [`auth_user_id.eq.${user.id}`]
  if (phone) orParts.push(`phone.eq.${encodeURIComponent(phone)}`)
  if (email) orParts.push(`email.eq.${encodeURIComponent(email)}`)
  const rows = await sbAdmin('GET', `/rest/v1/customers?or=(${orParts.join(',')})&select=*&limit=3`).catch(() => null)
  if (!rows || !rows.length) return null
  const match = rows.find((r: Record<string, unknown>) => r.auth_user_id === user.id) || rows[0]
  return match
}

// ── getCustomerOrders ────────────────────────────────────────
async function getCustomerOrders(customerId: string | number) {
  const STATUS_MAP: Record<string, string> = {
    pending: 'pending', confirmed: 'confirmed', processing: 'processing',
    packed: 'packed', shipped: 'shipped', delivered: 'delivered',
    cancelled: 'cancelled', returned: 'returned', refunded: 'refunded',
    return_requested: 'return_requested', return_approved: 'return_approved',
    return_received: 'return_received', refund_initiated: 'refund_initiated',
    refund_completed: 'refund_completed', return_rejected: 'return_rejected',
  }

  const rows = await sbAdmin(
    'GET',
    `/rest/v1/orders?customer_id=eq.${customerId}&select=id,order_number,order_status,payment_method,payment_status,total_amount,created_at,tracking_number,courier,shipped_at,delivered_at,updated_at,order_items(qty,price,name,emoji,image_url),returns(id,status,reason,created_at)&order=created_at.desc&limit=100`
  ).catch(() => [])

  return (rows || []).map((o: Record<string, unknown>) => {
    const items   = (o.order_items as unknown[]) || []
    const ret     = Array.isArray(o.returns) && o.returns.length > 0 ? o.returns[0] : null
    const rawSt   = String(o.order_status || '')
    return {
      id:              o.id,
      order_number:    o.order_number,
      order_status:    rawSt,
      _displayStatus:  STATUS_MAP[rawSt] || rawSt,
      payment_method:  o.payment_method  || null,
      payment_status:  o.payment_status  || null,
      total_amount:    Number(o.total_amount) || 0,
      created_at:      o.created_at,
      tracking_number: o.tracking_number || null,
      courier:         o.courier         || null,
      shipped_at:      o.shipped_at      || null,
      delivered_at:    o.delivered_at    || null,
      updated_at:      o.updated_at      || null,
      items,
      _return: ret,
    }
  })
}
