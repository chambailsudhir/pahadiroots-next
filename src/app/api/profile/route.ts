// ─────────────────────────────────────────────────────────────
// /api/profile — dedicated profile route (split from monolith)
//
// GET  → fetch current user profile (reads token from httpOnly cookie)
// POST → update profile fields
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_TOKEN, COOKIE_REFRESH } from '@/lib/auth/cookies'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function ok(data: unknown)                    { return NextResponse.json(data) }
function fail(status: number, msg: string)    { return NextResponse.json({ error: msg }, { status }) }

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

// ── Read token from httpOnly cookie ──────────────────────────
function getToken(req: NextRequest): string | null {
  return req.cookies.get(COOKIE_TOKEN)?.value ?? null
}

// ── Attempt to refresh using cookie-stored refresh token ─────
async function tryRefresh(req: NextRequest): Promise<{ token: string; newCookies: Record<string, string> } | null> {
  const refreshToken = req.cookies.get(COOKIE_REFRESH)?.value
  if (!refreshToken) return null
  try {
    const data = await sbAuth('/token?grant_type=refresh_token', { refresh_token: refreshToken })
    if (!data.access_token) return null
    return {
      token: data.access_token,
      newCookies: {
        access_token:  data.access_token,
        refresh_token: data.refresh_token ?? refreshToken,
      }
    }
  } catch {
    return null
  }
}

function applyNewCookies(res: NextResponse, cookies: Record<string, string>) {
  const IS_PROD = process.env.NODE_ENV === 'production'
  const base = { httpOnly: true, secure: IS_PROD, sameSite: 'strict' as const, path: '/' }
  res.cookies.set(COOKIE_TOKEN,   cookies.access_token,  { ...base, maxAge: 60 * 60 })
  res.cookies.set(COOKIE_REFRESH, cookies.refresh_token, { ...base, maxAge: 60 * 60 * 24 * 30 })
}

// ── GET /api/profile ─────────────────────────────────────────
export async function GET(req: NextRequest) {
  let token = getToken(req)
  let refreshed: Awaited<ReturnType<typeof tryRefresh>> = null

  if (!token) {
    refreshed = await tryRefresh(req)
    if (!refreshed) return fail(401, 'Not logged in')
    token = refreshed.token
  }

  try {
    const user    = await sbAuth('/user', null, token)
    const profile = await syncCustomerProfile(user)

    // Fetch saved addresses from normalized table
    let savedAddresses: unknown[] = []
    if (profile?.id) {
      const rows = await sbAdmin('GET',
        `/rest/v1/saved_addresses?customer_id=eq.${profile.id}&select=id,label,name,addr,city,state,pin&order=created_at.asc`
      ).catch(() => [])
      savedAddresses = Array.isArray(rows) ? rows : []
    }

    // Return saved_addresses as JSON string to keep frontend shape unchanged
    const profileWithAddresses = profile
      ? { ...profile, saved_addresses: JSON.stringify(savedAddresses) }
      : null

    const res = ok({
      success: true,
      user:    { id: user.id, email: user.email, phone: user.phone },
      profile: profileWithAddresses,
    })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.newCookies)
    return res
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    return fail(500, err.message || 'Profile fetch failed')
  }
}

// ── POST /api/profile — update fields ────────────────────────
export async function POST(req: NextRequest) {
  const token = getToken(req)
  if (!token) return fail(401, 'Not logged in')

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return fail(400, 'Invalid JSON') }

  try {
    const user    = await sbAuth('/user', null, token)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    // ── saved_addresses → normalized table (not JSON blob) ────
    if ('saved_addresses' in body) {
      const incoming = body.saved_addresses
      let addresses: Array<Record<string, unknown>> = []
      try {
        addresses = typeof incoming === 'string'
          ? JSON.parse(incoming)
          : (incoming as typeof addresses)
      } catch { return fail(400, 'Invalid saved_addresses format') }

      if (addresses.length > 10) return fail(400, 'Maximum 10 addresses allowed')

      // Full replace: delete all then re-insert
      await sbAdmin('DELETE', `/rest/v1/saved_addresses?customer_id=eq.${profile.id}`)
      if (addresses.length > 0) {
        const rows = addresses.map((a: Record<string, unknown>) => ({
          ...(a.id ? { id: a.id } : {}),
          customer_id: profile.id,
          label: a.label  || 'Home',
          name:  a.name   || null,
          addr:  a.addr   || '',
          city:  a.city   || '',
          state: a.state  || '',
          pin:   a.pin    || null,
        }))
        await sbAdmin('POST', `/rest/v1/saved_addresses`, rows)
      }
      delete body.saved_addresses
    }

    // ── Scalar profile fields → customers table ────────────────
    const allowed = ['first_name','last_name','address_line1','city','state','postal_code','phone']
    const patch: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) patch[key] = body[key]
    }
    if (Object.keys(patch).length > 0) {
      await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${profile.id}`, {
        ...patch,
        updated_at: new Date().toISOString(),
      })
    }

    return ok({ success: true })
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    return fail(err.status || 500, err.message || 'Profile update failed')
  }
}

// ── syncCustomerProfile (shared helper) ──────────────────────
async function syncCustomerProfile(user: { id: string; phone?: string; email?: string }) {
  const phone = user.phone || ''
  const email = user.email || ''
  const orParts = [`auth_user_id.eq.${user.id}`]
  if (phone) orParts.push(`phone.eq.${encodeURIComponent(phone)}`)
  if (email) orParts.push(`email.eq.${encodeURIComponent(email)}`)

  const rows = await sbAdmin('GET', `/rest/v1/customers?or=(${orParts.join(',')})&select=*&limit=3`).catch(() => null)
  if (rows && rows.length > 0) {
    let match = rows.find((r: Record<string, unknown>) => r.auth_user_id === user.id) || rows[0]
    if (match.auth_user_id !== user.id) {
      const patch: Record<string, unknown> = { auth_user_id: user.id }
      if (phone && !match.phone) patch.phone = phone
      await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${match.id}`, patch).catch(() => {})
      match = { ...match, ...patch }
    }
    return match
  }
  return null
}
