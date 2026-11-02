// ─────────────────────────────────────────────────────────────
// GET /api/account/data-export
//
// DPDP Act 2023 §16 — Right to Access / Data Portability
//
// Returns a JSON file containing all personal data held for the
// authenticated user: profile, saved addresses, order history, Pahadi Coins
// balance + transactions, wishlist, notification preferences and returns.
//
// Rate limit: 3 exports per 24 hours per account (shared across instances)
// plus a per-instance IP guard (download is heavy).
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin,
  getToken, tryRefresh,
  checkRateLimit,
  checkRateLimitShared,
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

    // AUDIT ACC-041: the in-process IP limiter above is per serverless instance, so the advertised
    // "once per 24 h" was never actually enforced (two back-to-back exports both succeeded).
    // Enforce per ACCOUNT across instances (KV/Postgres-backed).
    if (!await checkRateLimitShared(`data_export:${userId}`, 3, 24 * 60 * 60_000)) {
      return fail(429, 'Too many export requests — please wait 24 hours.', { 'Retry-After': String(24 * 60 * 60) })
    }

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

    // ── Everything else we hold about this customer (AUDIT ACC-041) ──
    // The export used to stop at profile / addresses / orders, i.e. it omitted the loyalty ledger,
    // wishlist, notification preferences and returns — all personal data under DPDP §16.
    const orderIds: Array<string | number> = Array.isArray(orders) ? orders.map((o: { id: string | number }) => o.id) : []
    const [loyaltyTransactions, wishlistRows, returnsRows] = customerId
      ? await Promise.all([
          sbAdmin('GET', `/rest/v1/loyalty_transactions?customer_id=eq.${customerId}&select=type,points,balance_after,note,order_id,created_at&order=created_at.desc&limit=1000`).catch(() => []),
          sbAdmin('GET', `/rest/v1/wishlist?customer_id=eq.${customerId}&select=product_id,created_at`).catch(() => []),
          orderIds.length
            ? sbAdmin('GET', `/rest/v1/returns?order_id=in.(${orderIds.join(',')})&select=order_number,reason,description,status,resolution,refund_amount,created_at,updated_at&order=created_at.desc`).catch(() => [])
            : Promise.resolve([]),
        ])
      : [[], [], []]

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
        pincode:       customer.pincode,   // was `postal_code` — no such column, so it exported blank (ACC-039)
        created_at:    customer.created_at,
        referral_code: customer.referral_code,
      } : null,
      notification_preferences: customer ? {
        order_emails:     customer.notif_email_orders,
        order_whatsapp:   customer.notif_whatsapp_orders,
        order_sms:        customer.notif_sms_orders,
        marketing_emails: customer.notif_email_marketing,
      } : null,
      pahadi_coins: customer ? {
        balance:      customer.loyalty_points,
        transactions: loyaltyTransactions,
      } : null,
      wishlist_product_ids: Array.isArray(wishlistRows) ? wishlistRows.map((w: { product_id: number }) => w.product_id) : [],
      returns: returnsRows,
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
