// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/referral  { code }   — a signed-in customer applies a friend's referral code.
//
// The rules live in the database (attach_referral, db_migration_v17_referral_controls.sql) so nothing here can be
// bypassed by calling the API differently: new customers only (no order yet), never your own code, one referrer per
// customer, not the same phone / e-mail as the referrer. Applying a code pays NOTHING — coins are released later by
// the expire-pending-orders sweep, once the friend's order is delivered and the return window has passed.
//
// Always answers 200 { success:true, applied, reason? } for a business outcome (so the browser can forget a code that
// can never work); 4xx/5xx only for auth, abuse limits and real faults.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail, checkCsrf, checkRateLimit,
  sbAuth, sbAdmin, getToken, tryRefresh, applyNewCookies, syncCustomerProfile,
} from '@/lib/api/serverUtils'
import { normalizeReferralCode, referralMessage } from '@/lib/referral'

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  if (!checkRateLimit(`referral_apply:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts — please wait a minute.' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  let token = getToken(req)
  const refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  let body: { code?: unknown } = {}
  try { body = await req.json() } catch { return fail(400, 'Invalid JSON') }
  const code = normalizeReferralCode(body.code)
  if (!code) return fail(400, referralMessage('invalid_code'))

  try {
    const user    = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return fail(404, 'Profile not found')

    const result = await sbAdmin('POST', '/rest/v1/rpc/attach_referral', { p_referee_id: profile.id, p_code: code }) as { ok?: boolean; reason?: string } | null
    const applied = result?.ok === true
    const res = ok({ success: true, applied, ...(applied ? {} : { reason: result?.reason ?? 'invalid_code', message: referralMessage(result?.reason) }) })
    if (refreshed) applyNewCookies(res as NextResponse, refreshed.token, refreshed.refresh)
    return res
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string; name?: string }
    if (err.status === 401) return fail(401, 'Session expired')
    console.error('[referral POST]', e)
    return fail(500, 'Could not apply the referral code — please try again')
  }
}
