// ─────────────────────────────────────────────────────────────
// /api/account/notifications
//
// GET  → fetch notification preferences for authenticated user
// POST → update one or more notification preference columns
//
// Columns (all BOOLEAN, default per schema):
//   notif_email_orders     — transactional order updates via email
//   notif_whatsapp_orders  — transactional order updates via WhatsApp
//   notif_sms_orders       — transactional order updates via SMS
//   notif_email_marketing  — marketing / promotional emails
//
// Rate limit: 30 req/min per IP (generous — toggles fire on every switch)
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin,
  getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile,
  checkRateLimit,
  checkCsrf,
} from '@/lib/api/serverUtils'

// Allowlist of columns this endpoint may read/write
const NOTIF_COLUMNS = [
  'notif_email_orders',
  'notif_whatsapp_orders',
  'notif_sms_orders',
  'notif_email_marketing',
] as const

type NotifColumn = typeof NOTIF_COLUMNS[number]

// ── GET /api/account/notifications ────────────────────────────
export async function GET(req: NextRequest) {
  let token    = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    const prefs: Record<NotifColumn, boolean> = {
      notif_email_orders:    (profile.notif_email_orders    as boolean) ?? true,
      notif_whatsapp_orders: (profile.notif_whatsapp_orders as boolean) ?? true,
      notif_sms_orders:      (profile.notif_sms_orders      as boolean) ?? true,
      notif_email_marketing: (profile.notif_email_marketing as boolean) ?? false,
    }

    const res = ok({ success: true, prefs })
    ;(res as NextResponse).headers.set('Cache-Control', 'no-store')
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    // BUG FIX [ERROR HANDLING]: previously no console.error and raw err.message
    // exposed in production (Supabase internals from syncCustomerProfile/sbAuth).
    console.error('[notifications GET]', e)
    return fail(500, process.env.NODE_ENV === 'production'
      ? 'Failed to fetch notification preferences'
      : (err.message || 'Failed to fetch notification preferences'))
  }
}
export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  const ip = (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
  if (!checkRateLimit(`notif_post:${ip}`, 30, 60_000)) {
    return NextResponse.json(
      { error: 'Too many requests — please wait a moment.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

  let token    = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > 4_096) return fail(413, 'Request body too large')

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return fail(400, 'Invalid JSON') }

  // Only accept whitelisted boolean columns
  const patch: Record<string, boolean> = {}
  for (const col of NOTIF_COLUMNS) {
    if (col in body) {
      if (typeof body[col] !== 'boolean') return fail(400, `${col} must be a boolean`)
      patch[col] = body[col] as boolean
    }
  }
  if (Object.keys(patch).length === 0) {
    return fail(400, 'No valid preference fields provided')
  }

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${profile.id}`, {
      ...patch,
      updated_at: new Date().toISOString(),
    })

    const res = ok({ success: true })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    // BUG FIX [ERROR HANDLING]: previously no console.error and raw err.message
    // exposed in production.
    console.error('[notifications POST]', e)
    return fail(500, process.env.NODE_ENV === 'production'
      ? 'Failed to update notification preferences'
      : (err.message || 'Failed to update notification preferences'))
  }
}
