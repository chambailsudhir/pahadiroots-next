// ─────────────────────────────────────────────────────────────
// GET /api/account/data-export
//
// DPDP Act 2023 §16 — Right to Access / Data Portability
//
// Returns a JSON file containing all personal data held for the
// authenticated user: profile, saved addresses, and order history.
//
// Rate limit: 3 exports per 24 hours per IP (download is heavy).
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin,
  getToken, tryRefresh,
  checkRateLimit,
  checkCsrf,
  applyNewCookies,
} from '@/lib/api/serverUtils'

export async function GET(req: NextRequest) {
  // ── CSRF check ────────────────────────────────────────────────
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  // ── Rate limit: 3 exports per 24 h per IP ────────────────────
  const ip = (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
  if (!checkRateLimit(`data_export:${ip}`, 3, 24 * 60 * 60_000)) {
    return fail(429, 'Too many export requests — please wait 24 hours.', { 'Retry-After': String(24 * 60 * 60) })
  }

  // ── Auth ──────────────────────────────────────────────────────
  let token      = getToken(req)
  const refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  try {
    // ── Resolve user ─────────────────────────────────────────────
    const user = await sbAuth('/user', null, token!)
    const userId = user.id as string

    // ── Fetch customer row ────────────────────────────────────────
    const customers = await sbAdmin(
      'GET',
      `/rest/v1/customers?auth_user_id=eq.${userId}&select=*&limit=1`,
    ).catch(() => null)
    const customer = customers?.[0] ?? null
    const customerId = customer?.id

    // ── Fetch saved addresses (separate table) ───────────────────
    const savedAddresses = customerId
      ? await sbAdmin(
          'GET',
          `/rest/v1/saved_addresses?customer_id=eq.${customerId}&select=*`,
        ).catch(() => [])
      : []

    // ── Fetch orders (anonymised columns only) ───────────────────
    const orders = customerId
      ? await sbAdmin(
          'GET',
          `/rest/v1/orders?customer_id=eq.${customerId}&select=id,order_number,order_status,total_amount,created_at,shipping_address&order=created_at.desc`,
        ).catch(() => [])
      : []

    // ── Build export payload ──────────────────────────────────────
    const exportData = {
      exported_at:       new Date().toISOString(),
      dpdp_act_section:  '§16 — Right of Access / Data Portability',
      profile: customer ? {
        first_name:    customer.first_name,
        last_name:     customer.last_name,
        email:         customer.email,
        phone:         customer.phone,
        address_line1: customer.address_line1,
        city:          customer.city,
        state:         customer.state,
        postal_code:   customer.postal_code,
        created_at:    customer.created_at,
      } : null,
      auth: {
        email:      user.email,
        phone:      user.phone,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
      },
      saved_addresses: savedAddresses,
      orders,
    }

    // ── Return as downloadable JSON file ──────────────────────────
    const json = JSON.stringify(exportData, null, 2)
    const res = new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type':        'application/json',
        'Content-Disposition': 'attachment; filename="pahadiroots-my-data.json"',
        'Cache-Control':       'no-store',
      },
    })
    // SEC-FIX: if the token was silently refreshed via tryRefresh(), the new
    // access + refresh tokens must be written back into the httpOnly cookies.
    // Without this call the refreshed tokens are discarded — the next request
    // finds a stale cookie, tryRefresh() runs again (wasting a Supabase call),
    // and eventually the refresh token itself expires, logging the user out.
    if (refreshed) applyNewCookies(res, refreshed.token, refreshed.refresh)
    return res
  } catch (e: unknown) {
    console.error('[data-export] Failed:', e)
    return fail(500, 'Could not export your data — please try again.')
  }
}
