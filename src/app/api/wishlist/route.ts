// ─────────────────────────────────────────────────────────────
// /api/wishlist — server-side wishlist persistence
//
// GET  → returns { wishlist: string[] } for the logged-in user
// PUT  → replaces the full wishlist { wishlist: string[] }
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
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired')
    return fail(500, err.message || 'Wishlist fetch failed')
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

    await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${profile.id}`, {
      wishlist_items: JSON.stringify(wishlist),
      updated_at:     new Date().toISOString(),
    })

    const res = ok({ success: true, count: wishlist.length })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired')
    return fail(500, err.message || 'Wishlist save failed')
  }
}
