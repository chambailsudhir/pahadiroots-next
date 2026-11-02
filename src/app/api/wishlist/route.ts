// ─────────────────────────────────────────────────────────────
// /api/wishlist — server-side wishlist persistence
//
// GET  → returns { wishlist: string[] } for the logged-in user
// PUT  → replaces the full wishlist { wishlist: string[] }   (legacy — see the data-loss note below)
// PATCH → merges a change into the STORED list { add?: string[], remove?: string[] }   (what the storefront sends now)
//
// WHY PATCH (account audit, Nov 2026 — ACC-052, found by live verification): the client used to upload its WHOLE local list
// with PUT. After a rehydrate on a device whose local wishlist was empty (new phone, cleared storage, another browser) a
// plain visit to the home page sent `PUT {wishlist: []}` and the customer's saved wishlist on the server was replaced by
// nothing (server [11,28] → [] after one page view). A delta can only ever add or remove the specific ids the customer
// touched, so a stale local list can no longer erase anything. PUT remains for old cached bundles but will no longer
// replace a non-empty list with an empty one.
//
// Storage: customers.wishlist_items (TEXT column, JSON array of product IDs)
//
// Schema migration required (run once in Supabase SQL editor):
//   ALTER TABLE customers
//     ADD COLUMN IF NOT EXISTS wishlist_items TEXT DEFAULT NULL;
//
// ✅ Cookie auth (same as /api/profile)
// ✅ 401 on unauthenticated → client falls back to local wishlist silently
// ✅ Max 200 items enforced server-side
// ✅ Rate limited: 60 PUT/min per IP (rapid add/remove taps are debounced client-side)
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

const MAX_WISHLIST_SIZE = 200


// ── helpers ───────────────────────────────────────────────────
async function readStoredWishlistRaw(customerId: string | number): Promise<string | null> {
  const rows = await sbAdmin('GET', `/rest/v1/customers?id=eq.${customerId}&select=wishlist_items&limit=1`)
  const raw = Array.isArray(rows) && rows.length > 0 ? (rows[0] as { wishlist_items?: string | null }).wishlist_items : null
  return typeof raw === 'string' ? raw : null
}
const parseWishlist = (raw: string | null): string[] => {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [] } catch { return [] }
}
async function readStoredWishlist(customerId: string | number): Promise<string[]> {
  return parseWishlist(await readStoredWishlistRaw(customerId))
}
const cleanIds = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 64))].slice(0, MAX_WISHLIST_SIZE) : []

// ── PATCH /api/wishlist — merge a change into the stored list ──
export async function PATCH(req: NextRequest) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  if (!checkRateLimit(`wishlist_patch:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests — please wait a moment.' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  let token = getToken(req)
  const refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > 65_536) return fail(413, 'Request body too large')

  let body: { add?: unknown; remove?: unknown } = {}
  try { body = await req.json() } catch { return fail(400, 'Invalid JSON') }
  const add = cleanIds(body.add), remove = new Set(cleanIds(body.remove))
  if (add.length === 0 && remove.size === 0) return fail(400, 'Nothing to change')

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    // Read → merge → conditional write (only if nobody changed the list in between); retry a couple of times.
    let merged: string[] = []
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw      = await readStoredWishlistRaw(profile.id)
      const current  = parseWishlist(raw)
      merged = [...new Set([...current, ...add])].filter(id => !remove.has(id)).slice(0, MAX_WISHLIST_SIZE)
      if (JSON.stringify(merged) === JSON.stringify(current) && raw !== null) break          // nothing to write
      const guard = raw === null ? 'wishlist_items=is.null' : `wishlist_items=eq.${encodeURIComponent(raw)}`
      const written = await sbAdmin(
        'PATCH',
        `/rest/v1/customers?id=eq.${profile.id}&${guard}`,
        { wishlist_items: JSON.stringify(merged), updated_at: new Date().toISOString() },
      )
      if (Array.isArray(written) && written.length > 0) break
      if (attempt === 2) return fail(409, 'Your wishlist was changed elsewhere — please try again')
    }

    const res = ok({ success: true, count: merged.length, wishlist: merged })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string; name?: string }
    if (err.status === 401) return fail(401, 'Session expired')
    const isTransient = err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout|fetch failed|network/i.test(err.message || '')
    console.error('[wishlist PATCH]', e)
    return fail(isTransient ? 503 : 500, process.env.NODE_ENV === 'production' ? (isTransient ? 'Service temporarily unavailable — please retry' : 'Wishlist save failed') : (err.message || 'Wishlist save failed'))
  }
}

// ── GET /api/wishlist ─────────────────────────────────────────
export async function GET(req: NextRequest) {
  let token = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    // Read wishlist_items column — may be null for users who haven't used wishlist yet
    const rows = await sbAdmin(
      'GET',
      `/rest/v1/customers?id=eq.${profile.id}&select=wishlist_items&limit=1`,
    ).catch(() => null)

    let wishlist: string[] = []
    if (Array.isArray(rows) && rows.length > 0) {
      const raw = (rows[0] as { wishlist_items?: string | null }).wishlist_items
      if (raw) {
        try { wishlist = JSON.parse(raw) } catch { wishlist = [] }
      }
    }

    const res = ok({ wishlist })
    ;(res as NextResponse).headers.set('Cache-Control', 'private, no-store')
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string; name?: string }
    if (err.status === 401) return fail(401, 'Session expired')
    // BUG FIX (found via live report of console 500s on /api/wishlist):
    // sbAuth's fetch() has an 8s AbortSignal.timeout — if Supabase's auth
    // endpoint is slow/under load (the same root cause behind the
    // getSiteSettings/getStoreData timeout storm fixed elsewhere in this
    // pass), the fetch itself throws a timeout/network error with NO
    // `.status` property at all, which fell through to a generic 500 here
    // indistinguishable from a real bug. Surfacing 503 instead makes this
    // classifiable in logs/monitoring as "transient upstream issue" rather
    // than "broken code", and is the more correct HTTP semantic either way.
    const isTransient = err.name === 'TimeoutError' || err.name === 'AbortError'
      || /timeout|fetch failed|network/i.test(err.message || '')
    console.error('[wishlist GET]', e)
    return fail(
      isTransient ? 503 : 500,
      process.env.NODE_ENV === 'production'
        ? (isTransient ? 'Service temporarily unavailable — please retry' : 'Wishlist fetch failed')
        : (err.message || 'Wishlist fetch failed'),
    )
  }
}

// ── PUT /api/wishlist ─────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  const ip = (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
  if (!checkRateLimit(`wishlist_put:${ip}`, 60, 60_000)) {
    return NextResponse.json(
      { error: 'Too many requests — please wait a moment.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

  let token = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > 65_536) return fail(413, 'Request body too large')

  let body: { wishlist?: unknown } = {}
  try { body = await req.json() } catch { return fail(400, 'Invalid JSON') }

  if (!Array.isArray(body.wishlist)) return fail(400, 'wishlist must be an array')

  // Sanitise: keep only non-empty strings, deduplicate, cap at MAX
  const wishlist: string[] = [
    ...new Set(
      (body.wishlist as unknown[])
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    ),
  ].slice(0, MAX_WISHLIST_SIZE)

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    // ACC-052: never let a (possibly stale) client replace a saved list with an empty one — that is the data-loss path.
    // A deliberate "clear" has to say so (x-wishlist-clear: 1); the current storefront uses PATCH and never needs to.
    if (wishlist.length === 0 && req.headers.get('x-wishlist-clear') !== '1') {
      const stored = await readStoredWishlist(profile.id)
      if (stored.length > 0) {
        const res = ok({ success: true, count: stored.length, ignored: 'empty_list_would_erase_saved_items' })
        if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
        return res
      }
    }

    await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${profile.id}`, {
      wishlist_items: JSON.stringify(wishlist),
      updated_at:     new Date().toISOString(),
    })

    const res = ok({ success: true, count: wishlist.length })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string; name?: string }
    if (err.status === 401) return fail(401, 'Session expired')
    const isTransient = err.name === 'TimeoutError' || err.name === 'AbortError'
      || /timeout|fetch failed|network/i.test(err.message || '')
    console.error('[wishlist PUT]', e)
    return fail(
      isTransient ? 503 : 500,
      process.env.NODE_ENV === 'production'
        ? (isTransient ? 'Service temporarily unavailable — please retry' : 'Wishlist save failed')
        : (err.message || 'Wishlist save failed'),
    )
  }
}
