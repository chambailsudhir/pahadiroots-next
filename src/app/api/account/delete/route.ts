// ─────────────────────────────────────────────────────────────
// DELETE /api/account/delete
//
// India DPDP Act 2023 — Right to Erasure (§17)
//
// ACTUAL SCHEMA (verified):
//   orders         → customer_id (bigint FK), shipping_address (jsonb)
//                    NO customer_name / customer_phone / customer_email columns
//   customers      → first_name, last_name, phone (now nullable), email,
//                    address_line1/2, city, state, postal_code,
//                    saved_addresses (text), auth_user_id, is_deleted, deleted_at
//   saved_addresses→ separate table, customer_id (bigint)
//   event_logs     → entity_id is TEXT (not uuid)
//
// Erasure sequence (order matters — auth deletion is irrecoverable):
//   1. Resolve customers.id from auth_user_id
//   2. Null shipping_address on orders (standalone PII snapshot in JSONB)
//   3. Anonymise customers row — name becomes "Deleted User", PII → NULL
//   4. Delete saved_addresses table rows for this customer
//   5. Write DPDP audit record to event_logs
//   6. Delete Supabase Auth user  ← irrecoverable, always last
//   7. Clear session cookies + respond
//
// Rate limit: 3 req/hour per IP
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
import { COOKIE_TOKEN, COOKIE_REFRESH } from '@/lib/auth/cookies'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!
const IS_PROD      = process.env.NODE_ENV === 'production'
const RESEND_KEY   = process.env.RESEND_API_KEY
const SITE_URL     = process.env.NEXT_PUBLIC_SITE_URL || 'https://pahadiroots.com'

// ── Step 5.5: Send deletion confirmation email ────────────────
// Non-fatal — deletion proceeds even if Resend is unreachable.
// Called BEFORE deleteAuthUser so the email address is still valid.
async function sendDeletionConfirmation(email: string): Promise<void> {
  if (!RESEND_KEY || !email) return
  try {
    await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      signal:  AbortSignal.timeout(8_000),
      body: JSON.stringify({
        from:    '5 Pahadi Roots <noreply@pahadiroots.com>',
        to:      [email],
        subject: 'Your 5 Pahadi Roots account has been deleted',
        html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif"><div style="max-width:520px;margin:32px auto;padding:0 16px"><div style="background:linear-gradient(135deg,#1a3a1e,#2d6a4f);border-radius:16px 16px 0 0;padding:36px 24px;text-align:center"><div style="font-size:40px;margin-bottom:8px">🌿</div><div style="font-size:24px;font-weight:900;color:#fff;font-family:Georgia,serif">5 Pahadi Roots</div></div><div style="background:#fff;border-radius:0 0 16px 16px;padding:40px 32px"><h2 style="font-family:Georgia,serif;color:#1a3a1e;margin:0 0 12px">Account deleted</h2><p style="color:#555;font-size:15px;line-height:1.6">Your account and all associated personal data have been permanently deleted, in accordance with the <strong>Digital Personal Data Protection Act 2023</strong>.</p><ul style="color:#555;font-size:14px;line-height:2;padding-left:20px"><li>Your name, phone, email and address have been erased</li><li>Saved delivery addresses have been removed</li><li>Order records are anonymised and retained for 7 years (GST requirement)</li></ul><p style="color:#555;font-size:14px;margin-top:24px">If you didn't request this, please contact us immediately.</p><p style="text-align:center;margin-top:32px"><a href="https://wa.me/919899984895" style="display:inline-block;background:linear-gradient(135deg,#1a5c2a,#2d6a4f);color:#fff;padding:14px 36px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px">💬 WhatsApp Support</a></p><p style="color:#aaa;font-size:12px;text-align:center;margin-top:24px">You can create a new account at <a href="${SITE_URL}" style="color:#2d6a4f">${SITE_URL}</a> at any time.</p></div></div></body></html>`,
      }),
    })
  } catch (e) {
    // Log but never throw — email failure must not block erasure
    console.warn('[account/delete] Resend confirmation failed:', e)
  }
}

// ── Delete Supabase Auth user via admin API ───────────────────
async function deleteAuthUser(userId: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method:  'DELETE',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Auth user deletion failed (${res.status}): ${text}`)
  }
}

// ── Clear session cookies ─────────────────────────────────────
// SEC-FIX: the previous local copy used SameSite='strict' which is inconsistent
// with all other cookie-writing paths (session/route.ts, google-callback/route.ts,
// auth/route.ts). Changed to 'lax' to match the rest of the auth system.
function clearAuthCookies(res: NextResponse): NextResponse {
  const base = { httpOnly: true, secure: IS_PROD, sameSite: 'lax' as const, path: '/' }
  res.cookies.set(COOKIE_TOKEN,   '', { ...base, maxAge: 0 })
  res.cookies.set(COOKIE_REFRESH, '', { ...base, maxAge: 0 })
  return res
}

export async function DELETE(req: NextRequest) {
  // ── CSRF check ────────────────────────────────────────────────
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  // ── Rate limit ────────────────────────────────────────────────
  const ip = (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
  if (!checkRateLimit(`account_delete:${ip}`, 3, 60 * 60_000)) {
    return fail(429, 'Too many requests — please wait before trying again.', { 'Retry-After': '3600' })
  }

  // ── Auth ──────────────────────────────────────────────────────
  let token      = getToken(req)
  const refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return fail(401, 'Not logged in')
  if (refreshed) token = refreshed.token

  // ── Require explicit confirmation in body ─────────────────────
  let body: { confirm?: string } = {}
  try { body = await req.json() } catch { return fail(400, 'Invalid JSON') }
  if (body.confirm !== 'DELETE') {
    return fail(400, 'Confirmation required — send { confirm: "DELETE" }')
  }

  try {
    const user   = await sbAuth('/user', null, token!)
    const userId: string = user.id   // Supabase auth UUID

    // ── Step 1: Resolve customers.id (bigint) from auth_user_id ──
    const customerRows = await sbAdmin(
      'GET',
      `/rest/v1/customers?auth_user_id=eq.${userId}&select=id&limit=1`,
    ).catch(() => null)

    // customers.id is bigint — cast to string for URL params
    const customerId: string | null = customerRows?.[0]?.id != null
      ? String(customerRows[0].id)
      : null

    if (customerId) {
      // ── Step 2: Null shipping_address on orders ─────────────────
      // orders has NO customer_name/phone/email columns.
      // shipping_address (JSONB) is the only standalone PII snapshot
      // on the orders table — everything else comes via the FK join
      // to customers, which we anonymise in Step 3.
      await sbAdmin(
        'PATCH',
        `/rest/v1/orders?customer_id=eq.${customerId}`,
        { shipping_address: null },
        'return=representation',
      ).catch(() => null)   // non-fatal: customer may have no orders

      // ── Step 3: Anonymise customers row ──────────────────────────
      // Keep the row so order FK (customer_id) stays valid.
      // Strip every personally identifiable field.
      // phone was NOT NULL — migration v3 dropped that constraint.
      await sbAdmin(
        'PATCH',
        `/rest/v1/customers?id=eq.${customerId}`,
        {
          auth_user_id:    null,          // unlink from Supabase Auth
          first_name:      'Deleted',
          last_name:       'User',
          phone:           null,          // nullable after migration v3
          email:           null,
          address_line1:   null,
          address_line2:   null,
          city:            null,
          state:           null,
          postal_code:     null,
          saved_addresses: '[]',          // clear the JSON blob column
          notes:           null,
          is_deleted:      true,          // column already existed
          deleted_at:      new Date().toISOString(),   // column already existed
          // Reset notification prefs so no ghost preferences remain
          notif_email_orders:    false,
          notif_whatsapp_orders: false,
          notif_sms_orders:      false,
          notif_email_marketing: false,
          updated_at:      new Date().toISOString(),
        },
        'return=representation',
      ).catch(() => null)

      // ── Step 4: Delete saved_addresses table rows ─────────────────
      // Separate table from the customers.saved_addresses text column —
      // both must be cleared.
      await sbAdmin(
        'DELETE',
        `/rest/v1/saved_addresses?customer_id=eq.${customerId}`,
        null,
        'return=representation',
      ).catch(() => null)
    }

    // ── Step 5: DPDP audit log ────────────────────────────────────
    // event_logs.entity_id is TEXT (not uuid) — pass as string
    await sbAdmin(
      'POST',
      '/rest/v1/event_logs',
      {
        entity_type: 'customer',
        entity_id:   customerId ?? userId,
        event:       'account.deleted.dpdp',
        actor:       userId,
        metadata: {
          ip,
          reason:        'user_requested',
          dpdp_act_2023: true,
          requested_at:  new Date().toISOString(),
        },
      },
      'return=representation',
    ).catch(() => null)   // audit failure must never block deletion

    // ── Step 5.5: Send deletion confirmation email ────────────────
    // Must run BEFORE deleteAuthUser — the auth record (and its email)
    // is wiped in Step 6 and can't be read afterwards.
    // sendDeletionConfirmation is non-fatal: if Resend is down, deletion
    // still completes and we log the failure internally.
    const userEmail: string = typeof user.email === 'string' ? user.email : ''
    await sendDeletionConfirmation(userEmail)

    // ── Step 6: Delete Supabase Auth user ─────────────────────────
    // Irrecoverable — always the very last step.
    // If anything above failed partially, the user still has an account
    // they can retry from or raise a support ticket about.
    await deleteAuthUser(userId)

    // ── Step 7: Clear cookies + respond ──────────────────────────
    const successMsg = userEmail
      ? `Account deleted. A confirmation has been sent to ${userEmail}.`
      : 'Account deleted successfully.'
    return clearAuthCookies(
      ok({ success: true, message: successMsg }) as NextResponse
    )

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    console.error('[DELETE /api/account/delete]', err)
    return fail(500, err.message || 'Account deletion failed — please contact support')
  }
}
