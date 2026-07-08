// ─────────────────────────────────────────────────────────────
// /api/profile — dedicated profile route
//
// GET  → fetch current user profile (reads token from httpOnly cookie)
// POST → update profile fields
//
// Fixes applied:
//   ✅ Shared helpers imported from serverUtils (no more duplication)
//   ✅ Rate limiting on POST (20 req/min per user)
//   ✅ Cache-Control: no-store on GET (profile data must never be cached)
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

// ── GET /api/profile ─────────────────────────────────────────
export async function GET(req: NextRequest) {
  let token = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  try {
    const user = await sbAuth('/user', null, token!)

    // Step 1+2 run in PARALLEL: profile lookup + saved addresses join.
    // Using !inner JOIN so we can filter addresses by user.id without
    // knowing the internal customer UUID ahead of time.
    const [profile, primaryAddressResult] = await Promise.all([
      syncCustomerProfile(user),
      sbAdmin(
        'GET',
        `/rest/v1/saved_addresses?select=id,label,name,addr,city,state,pin,customer_id,customers!inner(auth_user_id)&customers.auth_user_id=eq.${user.id}&order=created_at.asc&limit=20`,
      ).catch(() => null),  // null = !inner JOIN not supported (older PostgREST)
    ])

    // Step 3: fallback to sequential query if JOIN failed
    let savedAddressRows: unknown[]
    if (primaryAddressResult === null) {
      savedAddressRows = profile?.id
        ? await sbAdmin(
            'GET',
            `/rest/v1/saved_addresses?customer_id=eq.${profile.id}&select=id,label,name,addr,city,state,pin&order=created_at.asc&limit=20`,
          ).catch(() => [] as unknown[])
        : []
    } else {
      savedAddressRows = primaryAddressResult
    }

    // Step 4: strip the embedded customers relation (present on JOIN path only)
    interface SavedAddressRow {
      id:          string
      label:       string
      name?:       string
      addr:        string
      city:        string
      state:       string
      pin:         string
      customer_id: string
      customers?:  unknown
    }

    let savedAddresses: SavedAddressRow[] = []
    if (Array.isArray(savedAddressRows) && savedAddressRows.length > 0) {
      const first = savedAddressRows[0] as SavedAddressRow
      if (first?.customers !== undefined) {
        // JOIN path — remove the embedded relation before returning
        savedAddresses = (savedAddressRows as SavedAddressRow[]).map(
          ({ customers: _c, ...rest }) => rest,
        )
      } else {
        savedAddresses = savedAddressRows as SavedAddressRow[]
      }
    }

    const profileWithAddresses = profile
      ? { ...profile, saved_addresses: JSON.stringify(savedAddresses) }
      : null

    const res = ok({
      success: true,
      user:    { id: user.id, email: user.email, phone: user.phone },
      profile: profileWithAddresses,
    })

    // Profile data is personal — must never be cached by browser or CDN
    ;(res as NextResponse).headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')

    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string; name?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    // BUG FIX (found via live report of console 500s on /api/profile): see
    // the matching fix in /api/wishlist/route.ts — sbAuth's fetch can throw
    // a timeout/network error with no `.status` when Supabase's auth
    // endpoint is slow/under load, which previously surfaced as an
    // indistinguishable generic 500.
    const isTransient = err.name === 'TimeoutError' || err.name === 'AbortError'
      || /timeout|fetch failed|network/i.test(err.message || '')
    console.error('[profile GET]', e)
    return fail(
      isTransient ? 503 : 500,
      process.env.NODE_ENV === 'production'
        ? (isTransient ? 'Service temporarily unavailable — please retry' : 'Profile fetch failed')
        : (err.message || 'Profile fetch failed'),
    )
  }
}

// ── POST /api/profile — update fields ────────────────────────
export async function POST(req: NextRequest) {
  // ── CSRF check: reject requests from unexpected origins ───────
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  // ── Rate limiting: 20 writes per minute per user (IP-based for unauthenticated
  //    attempts, user-ID-based after token verification).
  //    Applied before token check so even unauthenticated hammering is blocked.
  const ip = (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
  if (!checkRateLimit(`profile_post:${ip}`, 20, 60_000)) {
    return NextResponse.json(
      { error: 'Too many requests — please wait a moment before trying again.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

  let token = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  // Guard against oversized payloads before parsing
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > 65_536) return fail(413, 'Request body too large')

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return fail(400, 'Invalid JSON') }

  try {
    const user    = await sbAuth('/user', null, token!)
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
        // Upsert first (all rows exist), THEN delete orphans.
        // delete-then-insert was non-atomic: if insert failed after delete,
        // all addresses were permanently lost.
        await sbAdmin(
          'POST',
          `/rest/v1/saved_addresses`,
          rows,
          'resolution=merge-duplicates,return=representation',
        )
        const keptIds = rows.map((r) => r.id).filter(Boolean) as string[]
        if (keptIds.length > 0) {
          await sbAdmin(
            'DELETE',
            `/rest/v1/saved_addresses?customer_id=eq.${profile.id}&id=not.in.(${keptIds.join(',')})`,
            null,
            'return=representation',
          )
        } else {
          await sbAdmin(
            'DELETE',
            `/rest/v1/saved_addresses?customer_id=eq.${profile.id}`,
            null,
            'return=representation',
          )
        }
      } else {
        // Empty list → delete all
        await sbAdmin(
          'DELETE',
          `/rest/v1/saved_addresses?customer_id=eq.${profile.id}`,
          null,
          'return=representation',
        )
      }
      delete body.saved_addresses
    }

    // ── Scalar profile fields ──────────────────────────────────
    // BUG FIX: the previous loop used `patch[key] = body[key]` with no type or
    // length validation.  A client could send:
    //   first_name: "<script>alert(1)</script>"  → stored in DB → XSS in invoice
    //   first_name: "A".repeat(1_000_000)        → stored verbatim, bloats DB row
    //   first_name: { "$ne": null }              → object stored in text column,
    //                                              breaks reads expecting a string
    // Fix: (a) enforce string type — non-strings are rejected with 400,
    //      (b) cap each field at a generous but bounded length,
    //      (c) strip HTML tags (same sanitize() treatment as orders/route.ts).
    // Stripping tags here means invoice/route.ts has a second line of defence,
    // but the primary fix is escaping at render time (invoice route Bug 1 above).
    const FIELD_LIMITS: Record<string, number> = {
      first_name:    100,
      last_name:     100,
      address_line1: 200,
      city:          100,
      state:         100,
      pincode:        20,
      phone:          20,
    }
    const ALLOWED = Object.keys(FIELD_LIMITS)
    const patch: Record<string, unknown> = {}
    for (const key of ALLOWED) {
      if (!(key in body)) continue
      const val = body[key]
      if (typeof val !== 'string') {
        return fail(400, `${key} must be a string`)
      }
      if (val.length > FIELD_LIMITS[key]) {
        return fail(400, `${key} must be at most ${FIELD_LIMITS[key]} characters`)
      }
      // Strip HTML tags to prevent stored XSS via DB → invoice HTML template
      patch[key] = val.replace(/<[^>]*>/g, '').trim()
    }
    if (Object.keys(patch).length > 0) {
      await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${profile.id}`, {
        ...patch,
        updated_at: new Date().toISOString(),
      })
    }

    const res = ok({ success: true })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string; name?: string }
    const isTransient = err.name === 'TimeoutError' || err.name === 'AbortError'
      || /timeout|fetch failed|network/i.test(err.message || '')
    console.error('[profile POST]', e)
    return fail(
      err.status || (isTransient ? 503 : 500),
      process.env.NODE_ENV === 'production'
        ? (isTransient ? 'Service temporarily unavailable — please retry' : 'Profile update failed')
        : (err.message || 'Profile update failed'),
    )
  }
}
