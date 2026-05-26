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

async function sbAdmin(method: string, path: string, body: unknown = null, prefer = 'return=representation') {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        prefer,
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
    // Step 1: verify token → get user (must be first, we need user.id)
    const user = await sbAuth('/user', null, token)

    // Step 2: profile lookup + primary address fetch run in PARALLEL.
    // Primary address query uses an auth_user_id JOIN so we can query by user.id
    // without waiting for syncCustomerProfile to return the internal customer UUID.
    // This eliminates one full sequential round-trip → saves ~400–700ms.
    // We use null (not []) as the catch value so we can distinguish
    // "query failed" (null) from "user has no addresses" ([]).
    const [profile, primaryAddressResult] = await Promise.all([
      syncCustomerProfile(user),
      sbAdmin('GET',
        `/rest/v1/saved_addresses?select=id,label,name,addr,city,state,pin,customer_id,customers!inner(auth_user_id)&customers.auth_user_id=eq.${user.id}&order=created_at.asc&limit=20`
      ).catch(() => null),  // null = primary query failed
    ])

    // Step 3: if primary JOIN failed (PostgREST version doesn't support !inner),
    // run a sequential fallback filtered by customer_id on the server.
    // Intentionally sequential — profile.id must be resolved before we can filter.
    // The fallback NEVER fetches addresses without a server-side customer filter.
    let savedAddressRows: unknown[]
    if (primaryAddressResult === null) {
      savedAddressRows = profile?.id
        ? await sbAdmin('GET',
            `/rest/v1/saved_addresses?customer_id=eq.${profile.id}&select=id,label,name,addr,city,state,pin&order=created_at.asc&limit=20`
          ).catch(() => [] as unknown[])
        : []
    } else {
      savedAddressRows = primaryAddressResult
    }

    // Step 4: strip the joined customers field if present (primary path only)
    // Define the row shape returned by the PostgREST query so we avoid 'as any' casts.
    interface SavedAddressRow {
      id:          string
      label:       string
      name?:       string
      addr:        string
      city:        string
      state:       string
      pin:         string
      customer_id: string
      customers?:  unknown  // present only on the JOIN path; stripped before returning
    }

    let savedAddresses: SavedAddressRow[] = []
    if (Array.isArray(savedAddressRows) && savedAddressRows.length > 0) {
      const first = savedAddressRows[0] as SavedAddressRow
      if (first?.customers !== undefined) {
        // Primary JOIN succeeded — remove the embedded customers relation before returning
        savedAddresses = (savedAddressRows as SavedAddressRow[]).map(({ customers: _c, ...rest }) => rest)
      } else {
        // Fallback path — rows already filtered server-side by customer_id
        savedAddresses = savedAddressRows as SavedAddressRow[]
      }
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
  let token = getToken(req)
  // Mirror the same refresh logic as GET: if the 1-hour access token has
  // expired while the user was editing, attempt a silent refresh so their
  // in-progress changes are not lost on Save.
  let refreshed: Awaited<ReturnType<typeof tryRefresh>> = null
  if (!token) {
    refreshed = await tryRefresh(req)
    if (!refreshed) return fail(401, 'Not logged in')
    token = refreshed.token
  }

  let body: Record<string, unknown> = {}
  // Guard against oversized payloads before parsing (e.g. a multi-MB saved_addresses blob).
  // 64 KB is generous for any legitimate profile update.
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > 65_536) return fail(413, 'Request body too large')
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
        // Critical fix: upsert first so all new rows exist, THEN remove orphans.
        // The old delete-then-insert was non-atomic: if the insert failed after
        // the delete succeeded, all addresses were permanently lost.
        await sbAdmin('POST', `/rest/v1/saved_addresses`, rows,
          'resolution=merge-duplicates,return=representation')
        // Delete any saved_addresses that were not in the incoming list.
        // Only rows that had an existing id can be kept; the rest are orphans.
        const keptIds = rows.map((r) => r.id).filter(Boolean) as string[]
        if (keptIds.length > 0) {
          await sbAdmin('DELETE',
            `/rest/v1/saved_addresses?customer_id=eq.${profile.id}&id=not.in.(${keptIds.join(',')})`,
            null, 'return=representation')
        } else {
          // No rows had a pre-existing id → this is a full replacement of all addresses
          await sbAdmin('DELETE',
            `/rest/v1/saved_addresses?customer_id=eq.${profile.id}`,
            null, 'return=representation')
        }
      } else {
        // Empty list → delete all
        await sbAdmin('DELETE',
          `/rest/v1/saved_addresses?customer_id=eq.${profile.id}`,
          null, 'return=representation')
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

    const res = ok({ success: true })
    // If the access token was silently refreshed at the top of this handler,
    // write the new cookies so the client stays authenticated.
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.newCookies)
    return res
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

  // No existing customer found — upsert rather than plain insert to be race-safe.
  // Two simultaneous requests (e.g. app tab + PWA background sync) could both
  // reach this branch; using merge-duplicates on the UNIQUE auth_user_id constraint
  // ensures only one row is ever created regardless of concurrency.
  const created = await sbAdmin(
    'POST',
    '/rest/v1/customers',
    { auth_user_id: user.id, phone: phone || null, email: email || null },
    'resolution=merge-duplicates,return=representation',
  ).catch(() => null)
  return created?.[0] ?? null
}
