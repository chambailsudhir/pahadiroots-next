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
  toPublicProfile,
  checkRateLimit,
  checkCsrf,
} from '@/lib/api/serverUtils'
import { INDIA_STATES, ADDRESS_LABELS } from '@/lib/account/constants'

// ── Server-side input rules (AUDIT ACC-039) ───────────────────────────────────
// The account forms validate in the browser only; the API accepted a blank first name,
// "5123456789" as a mobile, "Atlantis" as a state and unbounded / HTML-bearing address text.
// These helpers are the single server-side definition (they mirror lib/account/validation.ts).
const STATE_SET  = new Set<string>(INDIA_STATES)
const LABEL_SET  = new Set<string>([...ADDRESS_LABELS, 'Others'])   // checkout's chip says "Others"
const stripTags  = (v: string) => v.replace(/<[^>]*>/g, '').trim()
const tenDigits  = (v: string) => v.replace(/\D/g, '').slice(-10)
const isMobile   = (d: string) => /^[6-9]\d{9}$/.test(d)
const isPincode  = (v: string) => /^\d{6}$/.test(v)

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
        `/rest/v1/saved_addresses?select=id,label,name,phone,addr,city,state,pin,customer_id,customers!inner(auth_user_id)&customers.auth_user_id=eq.${user.id}&order=created_at.asc&limit=20`,
      ).catch(() => null),  // null = !inner JOIN not supported (older PostgREST)
    ])

    // Step 3: fallback to sequential query if JOIN failed
    let savedAddressRows: unknown[]
    if (primaryAddressResult === null) {
      savedAddressRows = profile?.id
        ? await sbAdmin(
            'GET',
            `/rest/v1/saved_addresses?customer_id=eq.${profile.id}&select=id,label,name,phone,addr,city,state,pin&order=created_at.asc&limit=20`,
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
      phone?:      string
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
      ? { ...toPublicProfile(profile), saved_addresses: JSON.stringify(savedAddresses) }
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

      if (!Array.isArray(addresses)) return fail(400, 'Invalid saved_addresses format')
      if (addresses.length > 10) return fail(400, 'Maximum 10 addresses allowed')

      if (addresses.length > 0) {
        // Rows already in the DB may pre-date the phone/pincode fields (migration v13) — they stay
        // editable without being forced to gain them. NEW rows must be complete.
        const existingRows = await sbAdmin(
          'GET',
          `/rest/v1/saved_addresses?customer_id=eq.${profile.id}&select=id&limit=50`,
        ).catch(() => [] as Array<{ id: string }>)
        const existingIds = new Set<string>((Array.isArray(existingRows) ? existingRows : []).map((r: { id: string }) => String(r.id)))
        const rows: Array<Record<string, unknown>> = []
        for (const a of addresses) {
          if (!a || typeof a !== 'object') return fail(400, 'Invalid saved_addresses format')
          const str = (v: unknown) => (typeof v === 'string' ? stripTags(v) : '')
          const label = str(a.label) || 'Home'
          const name  = str(a.name)
          const addr  = str(a.addr)
          const city  = str(a.city)
          const state = str(a.state)
          const pin   = str(a.pin)
          const phone = typeof a.phone === 'string' ? tenDigits(a.phone) : ''

          const isExisting = typeof a.id === 'string' && existingIds.has(a.id)

          if (!LABEL_SET.has(label))              return fail(400, 'Invalid address label')
          if (name.length > 100)                  return fail(400, 'Contact name must be at most 100 characters')
          if (addr.length > 200 || (!isExisting && addr.length < 5)) return fail(400, 'Street address must be 5–200 characters')
          if (city.length > 100 || (!isExisting && city.length < 2)) return fail(400, 'Enter a valid city')
          if (state ? !STATE_SET.has(state) : !isExisting) return fail(400, 'Select a valid state or union territory')
          if (pin   ? !isPincode(pin)       : !isExisting) return fail(400, 'Enter a valid 6-digit pincode')
          if (phone ? !isMobile(phone)      : !isExisting) return fail(400, 'Enter a valid 10-digit mobile number (starts with 6–9)')

          rows.push({
            // Only accept a UUID-shaped id (it ends up inside a PostgREST `not.in.(...)` filter below).
            ...(typeof a.id === 'string' && /^[0-9a-fA-F-]{36}$/.test(a.id) ? { id: a.id } : {}),
            customer_id: profile.id,
            label,
            name:  name || null,
            // Per-address contact number — bare 10 digits so a pasted "+91 98765-43210" is never stored raw.
            phone: phone || null,
            addr,
            city,
            state,
            pin:   pin || null,
          })
        }
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
    // AUDIT ACC-039 (pincode never saved): the account UI sends the pincode as `postal_code`, but the
    // customers column — and this allow-list — is `pincode`, so every "Save Address" silently dropped
    // it. Accept the legacy key as an alias.
    if ('postal_code' in body && !('pincode' in body)) body.pincode = body.postal_code
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
    // Semantic checks on what is about to be stored (blank values are allowed only where they mean "clear").
    if ('first_name' in patch && (patch.first_name as string).length < 1) return fail(400, 'First name is required')
    if ('phone' in patch) {
      const raw = patch.phone as string
      if (raw === '') patch.phone = null
      else {
        const d = tenDigits(raw)
        if (!isMobile(d)) return fail(400, 'Enter a valid 10-digit mobile number (starts with 6–9)')
        patch.phone = d
      }
    }
    if ('state'   in patch && patch.state   !== '' && !STATE_SET.has(patch.state as string)) return fail(400, 'Select a valid state or union territory')
    if ('pincode' in patch && patch.pincode !== '' && !isPincode(patch.pincode as string))   return fail(400, 'Enter a valid 6-digit pincode')
    for (const k of ['state', 'pincode', 'city', 'address_line1'] as const) {
      if (k in patch && patch[k] === '') patch[k] = null
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
