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

import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin,
  getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile,
  toPublicProfile,
  checkRateLimit,
  checkRateLimitShared,
  checkCsrf,
} from '@/lib/api/serverUtils'
import { INDIA_STATES, ADDRESS_LABELS } from '@/lib/account/constants'
import { addressesEtag, addressesContentKey, ADDRESS_SELECT } from '@/lib/server/addressEtag'
import { hasUnsafeTextChars } from '@/lib/server/sanitize'

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

// ── Atomic compare-and-replace of the address list (db_migration_v20_atomic_address_replace.sql) ──
// 'ok' / 'conflict' (the stored list is no longer what this request read) / 'unavailable' (function not deployed → caller
// falls back to the non-atomic upsert + cleanup).
async function replaceAddressesAtomically(
  customerId: string | number,
  rows: Array<Record<string, unknown>>,
  expected: Array<Record<string, unknown>>,
): Promise<'ok' | 'conflict' | 'unavailable'> {
  try {
    const res = await sbAdmin('POST', '/rest/v1/rpc/replace_saved_addresses', {
      p_customer_id: customerId,
      p_rows: rows.map(({ customer_id: _c, ...r }) => r),
      p_expected: expected,
    })
    return res === false ? 'conflict' : 'ok'
  } catch (e) {
    const err = e as { status?: number; message?: string }
    if (err?.status === 404 || /PGRST202|Could not find the function/i.test(err?.message || '')) return 'unavailable'
    throw e
  }
}

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
      ? { ...toPublicProfile(profile), saved_addresses: JSON.stringify(savedAddresses), saved_addresses_etag: addressesEtag(savedAddresses) }
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
    // AUDIT (rate limits): the in-process IP limiter above is per serverless instance. The real, cross-instance
    // limit is per ACCOUNT (shared KV/Postgres-backed).
    if (!await checkRateLimitShared(`profile_post_user:${user.id}`, 20, 60_000)) {
      return NextResponse.json(
        { error: 'Too many requests — please wait a moment before trying again.' },
        { status: 429, headers: { 'Retry-After': '60' } },
      )
    }
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    let newAddressesEtag: string | undefined
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

      // Current stored list — used for (a) the lost-update check below and (b) telling legacy rows from new ones.
      const existingRows = await sbAdmin(
        'GET',
        `/rest/v1/saved_addresses?customer_id=eq.${profile.id}&select=${ADDRESS_SELECT}&limit=50`,
      )
      // A failed read must NOT be treated as "no addresses": the etag check and the id-ownership check below both depend on it.
      const existingList: Array<Record<string, unknown> & { id: string }> = Array.isArray(existingRows) ? existingRows : []
      const changed409 = () => NextResponse.json({
        error: 'Your saved addresses were changed in another tab or device. Please reload this page to see the latest list, then try again.',
        code:  'addresses_changed',
      }, { status: 409 })

      let rows: Array<Record<string, unknown>> = []
      if (addresses.length > 0) {
        // Rows already in the DB may pre-date the phone/pincode fields (migration v13) — they stay
        // editable without being forced to gain them. NEW rows must be complete.
        const existingIds = new Set<string>(existingList.map((r: { id: string }) => String(r.id)))
        const usedIds = new Set<string>()
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

          if ([label, name, addr, city, state, pin].some(hasUnsafeTextChars) || (typeof a.phone === 'string' && hasUnsafeTextChars(a.phone))) {
            return fail(400, 'Address fields cannot contain < > or control characters')
          }
          if (!LABEL_SET.has(label))              return fail(400, 'Invalid address label')
          if (name.length > 100)                  return fail(400, 'Contact name must be at most 100 characters')
          if (addr.length > 200 || (!isExisting && addr.length < 5)) return fail(400, 'Street address must be 5–200 characters')
          if (city.length > 100 || (!isExisting && city.length < 2)) return fail(400, 'Enter a valid city')
          if (state ? !STATE_SET.has(state) : !isExisting) return fail(400, 'Select a valid state or union territory')
          if (pin   ? !isPincode(pin)       : !isExisting) return fail(400, 'Enter a valid 6-digit pincode')
          if (phone ? !isMobile(phone)      : !isExisting) return fail(400, 'Enter a valid 10-digit mobile number (starts with 6–9)')

          const rowId = isExisting && !usedIds.has(a.id as string) ? (a.id as string) : randomUUID()
          usedIds.add(rowId)
          rows.push({
            // OWNERSHIP (audit): saved_addresses has PK `id` only and is written with merge-duplicates, so a client-chosen
            // id that belongs to ANOTHER customer would overwrite that customer's row (customer_id included). Only ids
            // the caller already owns are kept; anything else (new rows, foreign ids, duplicates within the request,
            // missing / malformed ids) gets a server-minted UUID. The ids returned by the next GET are the truth.
            id: rowId,
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
      }

      // IDEMPOTENT RETRY (audit): the client retries a POST on a 5xx / timeout with the SAME etag. If the first attempt
      // actually committed, the stored list already equals the list being sent, so answer success instead of a false
      // "changed in another tab" 409 (which made the UI roll back a save that had succeeded).
      const alreadyApplied = addressesContentKey(existingList) === addressesContentKey(rows)
      if (alreadyApplied) {
        // nothing to write
      } else {
        // ACC-043b: refuse to overwrite a list that changed (other tab / device) since the client loaded it.
        // Clients that do not send an etag (older bundles) keep the previous last-write-wins behaviour (owner decision, see PR).
        if (typeof body.saved_addresses_etag === 'string' && body.saved_addresses_etag !== addressesEtag(existingList)) {
          return changed409()
        }
        // Preferred: ONE transaction that re-checks the list is still what we read (db_migration_v20). Two concurrent
        // POSTs with the same etag can no longer both pass and one delete the other's addition.
        const rpc = await replaceAddressesAtomically(profile.id as string | number, rows, existingList)
        if (rpc === 'conflict') return changed409()
        if (rpc === 'unavailable') {
          // Function not deployed yet — previous behaviour: upsert first (all rows exist), THEN delete orphans
          // (delete-then-insert was non-atomic and could lose every address).
          if (rows.length > 0) {
            await sbAdmin('POST', `/rest/v1/saved_addresses`, rows, 'resolution=merge-duplicates,return=representation')
          }
          const keptIds = rows.map((r) => r.id).filter(Boolean) as string[]
          await sbAdmin(
            'DELETE',
            keptIds.length > 0
              ? `/rest/v1/saved_addresses?customer_id=eq.${profile.id}&id=not.in.(${keptIds.join(',')})`
              : `/rest/v1/saved_addresses?customer_id=eq.${profile.id}`,
            null,
            'return=representation',
          )
        }
      }
      delete body.saved_addresses
      delete body.saved_addresses_etag
      newAddressesEtag = addressesEtag(await sbAdmin('GET', `/rest/v1/saved_addresses?customer_id=eq.${profile.id}&select=${ADDRESS_SELECT}&limit=50`).catch(() => null))
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
      // Reject markup / control / invisible characters outright (an unterminated `<img onerror=` survives tag stripping),
      // then strip tags as before (stored XSS via DB → invoice HTML template).
      if (key !== 'phone' && hasUnsafeTextChars(val)) return fail(400, `${key} cannot contain < > or control characters`)
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
      // Ownership proof belongs to a specific number: any change (or clearing) drops it. Only written when the column exists
      // (profile came from select=*) and a proof is actually held, so this is a no-op before db_migration_v25 is applied.
      if (profile.phone_verified_at && patch.phone !== (typeof profile.phone === 'string' ? tenDigits(profile.phone) : null)) {
        patch.phone_verified_at = null
      }
      // customers_normalized_phone_key is UNIQUE, so a rejected number reveals that it is registered. Slow enumeration
      // down with shared (cross-instance) limits per account and per IP. (Proper fix = OTP ownership proof — owner decision.)
      if (patch.phone !== null) {
        const okUser = await checkRateLimitShared(`profile_phone_user:${user.id}`, 5, 60 * 60_000)
        const okIp   = await checkRateLimitShared(`profile_phone_ip:${ip}`, 20, 60 * 60_000)
        if (!okUser || !okIp) {
          return NextResponse.json(
            { error: 'Too many mobile-number changes — please try again later.' },
            { status: 429, headers: { 'Retry-After': '3600' } },
          )
        }
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

    const res = ok({ success: true, ...(newAddressesEtag ? { saved_addresses_etag: newAddressesEtag } : {}) })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string; name?: string }
    const isTransient = err.name === 'TimeoutError' || err.name === 'AbortError'
      || /timeout|fetch failed|network/i.test(err.message || '')
    console.error('[profile POST]', e)
    // AUDIT ACC-039 (found in live verification): customers.normalized_phone is UNIQUE, so saving a mobile
    // number that already belongs to another account made PostgREST answer 409 and the customer saw the
    // opaque "Profile update failed". Say what actually happened (the whole update is rejected, so nothing
    // else was saved either).
    if ((err.status === 409 || /23505/.test(err.message || '')) && /phone/i.test(err.message || '')) {
      // Deliberately generic: never confirm that a number is registered to someone else.
      return fail(400, 'We could not save this mobile number. Please check it and try again, or contact support.')
    }
    return fail(
      err.status || (isTransient ? 503 : 500),
      process.env.NODE_ENV === 'production'
        ? (isTransient ? 'Service temporarily unavailable — please retry' : 'Profile update failed')
        : (err.message || 'Profile update failed'),
    )
  }
}
