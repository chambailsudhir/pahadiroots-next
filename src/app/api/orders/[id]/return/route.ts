// ─────────────────────────────────────────────────────────────
// POST /api/orders/[id]/return — initiate a return request
//
//  ✅ Token auth + refresh (mirrors /api/orders/[id] pattern)
//  ✅ Ownership check: customer_id=eq.${profile.id} prevents IDOR
//  ✅ Only delivered orders within the 7-day window are returnable
//  ✅ Idempotent: 409 if a return is already in progress
//  ✅ Body: { reason: string }
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_TOKEN, COOKIE_REFRESH } from '@/lib/auth/cookies'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const RETURN_REASONS = [
  'Damaged or defective product',
  'Wrong item received',
  'Item not as described',
  'Changed my mind',
  'Other',
] as const

const RETURNABLE_WINDOW_DAYS = 7

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

// ── POST /api/orders/[id]/return ──────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params
  if (!id) return fail(400, 'Order ID is required')
  // Validate format before touching the DB — rejects crafted IDs like "1;--" or overlong strings.
  // Accepts standard UUIDs (8-4-4-4-12 hex) and plain numeric IDs.
  const isValidId = /^[0-9]+$/.test(id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  if (!isValidId) return fail(400, 'Invalid order ID')

  // Parse + validate body
  let reason = ''
  try {
    const body = await req.json()
    reason = (body?.reason ?? '').trim()
  } catch {
    return fail(400, 'Invalid request body')
  }
  if (!reason) return fail(400, 'A return reason is required')
  if (!RETURN_REASONS.includes(reason as typeof RETURN_REASONS[number])) {
    return fail(400, `Invalid reason. Must be one of: ${RETURN_REASONS.join(', ')}`)
  }

  // Auth
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

    // Fetch order with ownership check
    const rows = await sbAdmin(
      'GET',
      `/rest/v1/orders?id=eq.${id}&customer_id=eq.${profile.id}&select=id,order_status,delivered_at,updated_at,order_number&limit=1`,
    ).catch(() => null)

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return fail(404, 'Order not found')
    }

    const order = rows[0] as {
      id: string
      order_status: string
      delivered_at: string | null
      updated_at:   string | null
      order_number: string
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

    // Guard against duplicate return requests
    const RETURN_IN_PROGRESS = ['return_requested', 'return_approved', 'return_received', 'refunded', 'refund_initiated', 'refund_completed']
    if (RETURN_IN_PROGRESS.includes(order.order_status)) {
      return fail(409, 'A return request is already in progress for this order')
    }

    // Update order status to return_requested
    await sbAdmin(
      'PATCH',
      `/rest/v1/orders?id=eq.${id}&customer_id=eq.${profile.id}`,
      {
        order_status:    'return_requested',
        return_reason:   reason,
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
    return fail(500, err.message || 'Return request failed')
  }
}
