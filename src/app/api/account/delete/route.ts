// ─────────────────────────────────────────────────────────────
// DELETE /api/account/delete
//
// India DPDP Act 2023 — Right to Erasure (§17)
//
// ACTUAL SCHEMA (verified):
//   orders         → customer_id (bigint FK), shipping_address (jsonb)
//                    NO customer_name / customer_phone / customer_email columns
//   customers      → first_name, last_name, phone (now nullable), email,
//                    address_line1/2, city, state, pincode,
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
  checkRateLimitShared,
  checkCsrf,
  applyNewCookies,
} from '@/lib/api/serverUtils'
import { COOKIE_TOKEN, COOKIE_REFRESH } from '@/lib/auth/cookies'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!
const IS_PROD      = process.env.NODE_ENV === 'production'
const RESEND_KEY   = process.env.RESEND_API_KEY
const SITE_URL     = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'

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
        from:    'HimVeda by Pahadi Roots <noreply@pahadiroots.com>',
        to:      [email],
        subject: 'Your HimVeda by Pahadi Roots account has been deleted',
        html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif"><div style="max-width:520px;margin:32px auto;padding:0 16px"><div style="background:linear-gradient(135deg,#1a3a1e,#2d6a4f);border-radius:16px 16px 0 0;padding:36px 24px;text-align:center"><div style="font-size:40px;margin-bottom:8px">🌿</div><div style="font-size:24px;font-weight:900;color:#fff;font-family:Georgia,serif">HimVeda by Pahadi Roots</div></div><div style="background:#fff;border-radius:0 0 16px 16px;padding:40px 32px"><h2 style="font-family:Georgia,serif;color:#1a3a1e;margin:0 0 12px">Account deleted</h2><p style="color:#555;font-size:15px;line-height:1.6">Your account and all associated personal data have been permanently deleted, in accordance with the <strong>Digital Personal Data Protection Act 2023</strong>.</p><ul style="color:#555;font-size:14px;line-height:2;padding-left:20px"><li>Your name, phone, email and address have been erased</li><li>Saved delivery addresses have been removed</li><li>Order records are anonymised and retained for the period required under GST and tax law</li></ul><p style="color:#555;font-size:14px;margin-top:24px">If you didn't request this, please contact us immediately.</p><p style="text-align:center;margin-top:32px"><a href="https://wa.me/919899984895" style="display:inline-block;background:linear-gradient(135deg,#1a5c2a,#2d6a4f);color:#fff;padding:14px 36px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px">💬 WhatsApp Support</a></p><p style="color:#aaa;font-size:12px;text-align:center;margin-top:24px">You can create a new account at <a href="${SITE_URL}" style="color:#2d6a4f">${SITE_URL}</a> at any time.</p></div></div></body></html>`,
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
  let body: { confirm?: string; password?: string } = {}
  try { body = await req.json() } catch { return fail(400, 'Invalid JSON') }
  if (body.confirm !== 'DELETE') {
    return fail(400, 'Confirmation required — send { confirm: "DELETE" }')
  }

  try {
    const user   = await sbAuth('/user', null, token!)
    const userId: string = user.id   // Supabase auth UUID

    // ── Re-authentication (AUDIT ACC-023) ─────────────────────────
    // Erasure is irreversible, and a stolen/shared session must not be enough to trigger it.
    //   • accounts with a password  → the current password must be supplied and verified
    //   • Google-only accounts      → no password exists, so require a RECENT sign-in instead
    // Every failure is a 403 with a stable `code` — never 401, which clients treat as
    // "session expired" and answer by signing the user out (see ACC-036).
    const appMeta = (user.app_metadata ?? {}) as { provider?: string; providers?: string[] }
    const providers: string[] = Array.isArray(appMeta.providers) ? appMeta.providers : (appMeta.provider ? [appMeta.provider] : [])
    const hasPassword = providers.includes('email') && typeof user.email === 'string' && user.email.length > 0

    if (hasPassword) {
      if (typeof body.password !== 'string' || body.password.length === 0) {
        return NextResponse.json({ error: 'Please enter your password to confirm deletion.', code: 'password_required' }, { status: 403 })
      }
      // Throttle password guesses made through this endpoint (per account, shared across instances).
      if (!await checkRateLimitShared(`account_delete_pw:${userId}`, 5, 15 * 60_000)) {
        return fail(429, 'Too many attempts — please wait a few minutes.', { 'Retry-After': '900' })
      }
      try {
        await sbAuth('/token?grant_type=password', { email: user.email, password: body.password })
      } catch {
        return NextResponse.json({ error: 'That password is incorrect.', code: 'reauth_failed' }, { status: 403 })
      }
    } else {
      const lastSignIn = Date.parse(String(user.last_sign_in_at ?? ''))
      const FRESH_MS   = 15 * 60_000
      if (!Number.isFinite(lastSignIn) || Date.now() - lastSignIn > FRESH_MS) {
        return NextResponse.json({
          error: 'For your security, please sign out, sign in again with Google, and retry within 15 minutes.',
          code:  'reauth_required',
        }, { status: 403 })
      }
    }

    // ── Step 1: Resolve customers.id (bigint) from auth_user_id ──
    // A failed LOOKUP must abort: treating it as "no customer row" would skip anonymisation and
    // still delete the login — the exact failure mode that left PII behind before.
    const customerRows = await sbAdmin(
      'GET',
      `/rest/v1/customers?auth_user_id=eq.${userId}&select=id&limit=1`,
    )

    // customers.id is bigint — cast to string for URL params
    const customerId: string | null = customerRows?.[0]?.id != null
      ? String(customerRows[0].id)
      : null

    if (customerId) {
      // AUDIT ACC-033 — ROOT CAUSE of "Account deletion failed (500)":
      // every write below used to end in `.catch(() => null)`, and the anonymising PATCH sent a
      // column that does not exist (`postal_code` — the real column is `pincode`). PostgREST
      // rejected the whole update (PGRST204), the swallowed error hid it, `customers.auth_user_id`
      // stayed set, and the later auth-user delete died on FK customers_auth_user_id_fkey (23503).
      // Steps 2–3 are therefore FATAL now: if PII could not be erased we stop BEFORE the
      // irreversible auth deletion and the customer can simply retry.

      // ── Step 2: Null shipping_address on orders ─────────────────
      // orders has NO customer_name/phone/email columns; shipping_address (JSONB — name, address
      // and, since ACC-035, the delivery phone) is the per-order PII snapshot.
      await sbAdmin(
        'PATCH',
        `/rest/v1/orders?customer_id=eq.${customerId}`,
        { shipping_address: null },
        'return=minimal',
      )

      // ── Step 3: Anonymise customers row ──────────────────────────
      // Keep the row so order FK (customer_id) stays valid; strip every personal field.
      const anonymised = await sbAdmin(
        'PATCH',
        `/rest/v1/customers?id=eq.${customerId}`,
        {
          auth_user_id:    null,          // unlink from Supabase Auth (releases the FK)
          first_name:      'Deleted',
          last_name:       'User',
          phone:           null,
          email:           null,
          address_line1:   null,
          address_line2:   null,
          city:            null,
          state:           null,
          pincode:         null,          // was `postal_code` — no such column (ACC-033)
          saved_addresses: '[]',          // legacy JSON blob column
          wishlist_items:  null,
          gstin:           null,
          notes:           null,
          is_deleted:      true,
          deleted_at:      new Date().toISOString(),
          notif_email_orders:    false,
          notif_whatsapp_orders: false,
          notif_sms_orders:      false,
          notif_email_marketing: false,
          updated_at:      new Date().toISOString(),
        },
        'return=representation',
      )
      if (!Array.isArray(anonymised) || anonymised.length !== 1 || anonymised[0]?.auth_user_id != null) {
        throw new Error('customer anonymisation did not apply (row not updated / still linked to auth user)')
      }

      // ── Step 4: Delete personal rows keyed by customer ───────────
      // saved_addresses (table), wishlist and abandoned carts (name/email/phone snapshots).
      // Loyalty/coupon/order rows are financial records and stay (they hold no direct PII).
      for (const table of ['saved_addresses', 'wishlist', 'abandoned_carts']) {
        await sbAdmin(
          'DELETE',
          `/rest/v1/${table}?customer_id=eq.${customerId}`,
          null,
          'return=minimal',
        )
      }
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
    const res = clearAuthCookies(
      ok({ success: true, message: successMsg }) as NextResponse
    )
    // AUDIT S2-006: the browser still holds the deleted user's PII in
    // localStorage (pr_checkout_profile: name/phone/email/address, pr-user:
    // saved addresses). Clear-Site-Data makes supporting browsers drop all DOM
    // storage for this origin as part of the erasure (DPDP §17); the client
    // additionally clears the specific keys (lib/clientLogout.ts clearClientPII).
    // "storage" is deliberate: after deletion nothing in local storage is worth
    // keeping. Not "cookies" — those are expired explicitly above.
    res.headers.set('Clear-Site-Data', '"storage"')
    return res

  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 401) return fail(401, 'Session expired — please login again')
    console.error('[DELETE /api/account/delete]', err)
    // BUG FIX [ERROR HANDLING]: previously exposed raw err.message in production.
    // deleteAuthUser() wraps the Supabase admin API response text directly in its
    // error message (e.g. "Auth user deletion failed (500): <raw Supabase JSON>").
    // In production this leaks internal auth infrastructure details. Also missing
    // the console.error which existed in the comment's intention but not in code.
    const clientMsg = process.env.NODE_ENV === 'production'
      ? 'Account deletion failed — please contact support'
      : (err.message || 'Account deletion failed — please contact support')
    return fail(500, clientMsg)
  }
}
