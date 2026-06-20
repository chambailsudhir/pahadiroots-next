// ─────────────────────────────────────────────────────────────
// GET /api/v1/loyalty/history
//
// Returns paginated loyalty transaction history for the
// authenticated user.
//
// Query params:
//   page  (default 1)
//   limit (default 20, max 50)
//
// Replaces the old POST /api/v1/loyalty { action: 'history' }
// pattern — GET is correct for reads, enables HTTP caching,
// and satisfies CDN cache rules.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin,
  getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile,
} from '@/lib/api/serverUtils'

export async function GET(req: NextRequest) {
  let token     = getToken(req)
  let refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  const { searchParams } = req.nextUrl
  const page  = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))
  const offset = (page - 1) * limit

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    const rows = await sbAdmin(
      'GET',
      `/rest/v1/loyalty_transactions?customer_id=eq.${profile.id}&select=id,type,points,balance_after,note,created_at,order_id&order=created_at.desc&limit=${limit}&offset=${offset}`,
    ).catch(() => [])

    const res = ok({ transactions: rows ?? [], page, limit })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err?.status === 401) return fail(401, 'Session expired')
    // BUG FIX [ERROR HANDLING]: previously exposed raw e.message (Supabase internals) with no logging.
    console.error('[loyalty/history GET]', e)
    const msg = process.env.NODE_ENV === 'production'
      ? 'Failed to fetch loyalty history — please try again'
      : (err?.message || 'Failed to fetch loyalty history')
    return fail(500, msg)
  }
}
