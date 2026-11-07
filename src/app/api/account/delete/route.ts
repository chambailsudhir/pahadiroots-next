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
//   2. Refuse (409) while any order is still in progress
//   3. Closed orders: reduce shipping_address to the invoice set (name, address lines, city, state, pincode, GSTIN) —
//      phone, e-mail and every other key are erased; notes, return photos, ledger notes, wishlist, carts are erased
//   4. Anonymise customers row — name becomes "Deleted User", PII → NULL (unlinks the login; last DB write)
//   4b. Anonymise the customer's product reviews (name -> 'Anonymous customer', unlinked; rating/text kept)
//   5. Write DPDP audit record to event_logs
//   6. Delete Supabase Auth user  ← irrecoverable, always last
//   7. Clear session cookies + respond
//
// RETENTION (owner decision, modelled on large marketplaces): invoices / credit notes must be kept for 72 months after
// the due date of the annual return (CGST Act s.36, Rule 56(20)); DPDP Act allows retention required by law. So closed
// orders keep ONLY what an invoice needs. Counsel to confirm — see PR.
//
// Rate limit: 3 req/hour per IP
// ─────────────────────────────────────────────────────────────

import { clientIpKey } from '@/lib/api/clientIp'
import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  ok, fail,
  sbAuth, sbAdmin,
  getToken, tryRefresh,
  checkRateLimitShared,
  checkCsrf,
  applyNewCookies,
} from '@/lib/api/serverUtils'
// VERIFY ROUND (L-6): answers built here by hand (error bodies with a `code`) carry the same header as ok()/fail() — a
// shared cache must never store a customer's answer. Local on purpose: route tests mock serverUtils wholesale.
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' } as const
import { COOKIE_TOKEN, COOKIE_REFRESH } from '@/lib/auth/cookies'
import { brandedEmail, emailSiteUrl } from '@/lib/server/emailShell'
import { emailSafeHtml } from '@/lib/server/emailSafeHtml'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!
const IS_PROD      = process.env.NODE_ENV === 'production'
const RESEND_KEY   = process.env.RESEND_API_KEY
const SITE_URL     = emailSiteUrl()   // finding F: a clean https origin only (never localhost / http / trailing slash) in the mail

// order_status_enum values after which nothing more happens to the parcel or the money (checked against the live enum:
// pending, confirmed, processing, packed, shipped, out_for_delivery, delivered, cancelled, payment_failed, returned,
// return_requested, return_approved, return_received, return_rejected, refund_initiated, refund_completed, refunded).
// Everything NOT listed here is "open": the courier still needs the destination, or a return / refund is in flight.
const TERMINAL_ORDER_STATUSES = ['delivered', 'cancelled', 'payment_failed', 'returned', 'return_rejected', 'refund_completed', 'refunded'] as const
const EVIDENCE_BUCKET = 'return-evidence'

// The ONLY keys of orders.shipping_address that survive on a closed order: what a GST invoice / credit note prints.
// `state` and `pincode` MUST stay (DB trigger set_order_gst_split recomputes CGST/SGST/IGST from the address on
// UPDATE OF shipping_address; dropping state would change the tax split of a historical invoice).
const INVOICE_ADDRESS_KEYS = ['name', 'address_line1', 'address_line2', 'city', 'state', 'pincode', 'gstin'] as const

/**
 * Reduce a shipping_address snapshot to the invoice set. Returns `null` when nothing needs to be written
 * (already minimal → idempotent, no trigger fired) and `'drop'` for a value that cannot be parsed.
 */
function minimiseShippingAddress(raw: unknown): Record<string, unknown> | null | 'drop' {
  if (raw == null) return null
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) } catch { return 'drop' }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return 'drop'
  const src = obj as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of INVOICE_ADDRESS_KEYS) {
    if (!(k in src)) continue
    const v = src[k]
    if (v === null || v === undefined) continue
    if (k === 'gstin' && (typeof v !== 'string' || !v.trim())) continue
    out[k] = v
  }
  const unchanged = typeof raw !== 'string'
    && Object.keys(src).length === Object.keys(out).length
    && Object.keys(out).every(k => src[k] === out[k])
  return unchanged ? null : out
}
const chunk = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

// The audit row must prove WHEN and THAT an erasure happened without keeping the requester's IP (personal data) after
// erasure. Keyed hash (service key as secret) truncated to 64 bits — not reversible by brute-forcing the IPv4 space.
function hashIp(ip: string): string {
  return createHmac('sha256', SUPABASE_KEY || 'no-key').update(ip).digest('hex').slice(0, 16)
}

// Delete every object under returns/<orderId>/ in the private return-evidence bucket (Storage REST API).
async function deleteReturnEvidence(orderIds: Array<string | number>): Promise<void> {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  for (const group of chunk(orderIds, 10)) {
    await Promise.all(group.map(async (orderId) => {
      const prefix = `returns/${orderId}`
      const listRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${EVIDENCE_BUCKET}`, {
        method: 'POST', headers, signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
      })
      if (!listRes.ok) throw new Error(`return-evidence list failed (${listRes.status})`)
      const items = await listRes.json().catch(() => []) as Array<{ name?: string }>
      const paths = (Array.isArray(items) ? items : []).map(i => i?.name).filter((n): n is string => !!n).map(n => `${prefix}/${n}`)
      if (paths.length === 0) return
      const delRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${EVIDENCE_BUCKET}`, {
        method: 'DELETE', headers, signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ prefixes: paths }),
      })
      if (!delRes.ok) throw new Error(`return-evidence delete failed (${delRes.status})`)
    }))
  }
}

// ── Step 5.5: Send deletion confirmation email ────────────────
// Non-fatal — deletion proceeds even if Resend is unreachable.
// Called AFTER the auth user was deleted, with the address captured before erasure (a failed deletion must never
// produce a "your account has been deleted" mail).
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
        html: emailSafeHtml(brandedEmail({
          heading: 'Account deleted',
          bodyHtml: `<p style="margin:0 0 12px">Your account has been deleted and your personal data erased, in accordance with the <strong>Digital Personal Data Protection Act 2023</strong>, except for the records we are legally required to keep (below).</p><p style="font-size:14px;line-height:1.6;margin:16px 0 4px"><strong>Erased or anonymised</strong></p><ul style="font-size:14px;line-height:1.9;padding-left:20px;margin-top:0"><li>Your name, phone number, e-mail, GSTIN and profile address, saved delivery addresses, wishlist and abandoned carts</li><li>The phone number, e-mail and any other details stored with the delivery address of your past orders</li><li>Newsletter and back-in-stock subscriptions, and queued e-mails to this address</li><li>Return photos and your name and comments on return requests, order notes, and notes on Pahadi Coins entries</li></ul><p style="font-size:14px;line-height:1.6;margin:16px 0 4px"><strong>Retained as required by GST and tax law</strong></p><ul style="font-size:14px;line-height:1.9;padding-left:20px;margin-top:0"><li>For completed orders only: the recipient name, delivery address (lines, city, state, pincode) and, for business orders, the GSTIN printed on the invoice, together with the invoice and payment amounts. GST law (CGST Act s.36 and Rule 56) requires us to keep these for up to 6 years. Your phone number and e-mail are <strong>not</strong> kept on these orders, and the data is never used for marketing</li></ul><p style="font-size:14px;line-height:1.6">Product reviews you posted stay on our product pages (rating and text) but your name is replaced by &ldquo;Anonymous customer&rdquo; and they are unlinked from your account; write to us if you would like one removed.</p><p style="font-size:14px;margin:16px 0 0">If you didn't request this, please contact us immediately. You can create a new account at <a href="${SITE_URL}" style="color:#2d6a4f">${SITE_URL}</a> at any time.</p>`,
          cta: { label: 'WhatsApp Support', href: 'https://wa.me/919899984895' },
        })),
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
    // 404 = already gone (e.g. a retry after a response was lost) — that is the desired end state.
    if (res.status === 404) return
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
  const ip = clientIpKey(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip'))   // IPv6 → /64
  // VERIFY ROUND (L-7): shared (KV / Postgres) limiter like export and profile — the in-process one was per serverless instance.
  if (!await checkRateLimitShared(`account_delete:${ip}`, 3, 60 * 60_000)) {
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
        return NextResponse.json({ error: 'Please enter your password to confirm deletion.', code: 'password_required' }, { status: 403, headers: PRIVATE_HEADERS })
      }
      // Throttle password guesses made through this endpoint (per account, shared across instances).
      if (!await checkRateLimitShared(`account_delete_pw:${userId}`, 5, 15 * 60_000)) {
        return fail(429, 'Too many attempts — please wait a few minutes.', { 'Retry-After': '900' })
      }
      try {
        await sbAuth('/token?grant_type=password', { email: user.email, password: body.password })
      } catch {
        return NextResponse.json({ error: 'That password is incorrect.', code: 'reauth_failed' }, { status: 403, headers: PRIVATE_HEADERS })
      }
    } else {
      const lastSignIn = Date.parse(String(user.last_sign_in_at ?? ''))
      const FRESH_MS   = 15 * 60_000
      if (!Number.isFinite(lastSignIn) || Date.now() - lastSignIn > FRESH_MS) {
        return NextResponse.json({
          error: 'For your security, please sign out, sign in again with Google, and retry within 15 minutes.',
          code:  'reauth_required',
        }, { status: 403, headers: PRIVATE_HEADERS })
      }
    }

    // ── Step 1: Resolve customers.id (bigint) from auth_user_id ──
    // A failed LOOKUP must abort: treating it as "no customer row" would skip anonymisation and
    // still delete the login — the exact failure mode that left PII behind before.
    const customerRows = await sbAdmin(
      'GET',
      `/rest/v1/customers?auth_user_id=eq.${userId}&select=id,email,phone&limit=1`,
    )

    // customers.id is bigint — cast to string for URL params
    const customerId: string | null = customerRows?.[0]?.id != null
      ? String(customerRows[0].id)
      : null

    // Captured BEFORE anything is erased: every address this person used (account + customer row).
    const userEmail: string = typeof user.email === 'string' ? user.email : ''
    const emailSet = new Set<string>()
    for (const e of [userEmail, customerRows?.[0]?.email]) {
      if (typeof e === 'string' && e.trim()) { emailSet.add(e.trim()); emailSet.add(e.trim().toLowerCase()) }
    }

    // ORDER OF STEPS (audit): nothing irreversible-and-visible happens until every check passed, and the step that
    // UNLINKS the customer row (the one a retry cannot redo) is the last database write. Every earlier step is
    // idempotent, so a failure leaves a still-active account the customer can simply retry.
    let orderIds: Array<string | number> = []
    if (customerId) {
      // ── Step 2: refuse while any order is still in flight ────────
      // The previous version NULLed orders.shipping_address for ALL orders — including shipped / packed / COD-confirmed
      // ones — destroying the courier destination, and was not transactional. In-flight orders need the recipient;
      // closed orders keep it too (invoice / credit-note retention, see PR note for counsel).
      const open = await sbAdmin(
        'GET',
        `/rest/v1/orders?customer_id=eq.${customerId}&order_status=not.in.(${TERMINAL_ORDER_STATUSES.join(',')})&select=id&limit=1`,
      )
      if (Array.isArray(open) && open.length > 0) {
        return NextResponse.json({
          error: 'You still have an order, return or refund in progress. We need your delivery details until it is completed, so your account cannot be deleted yet. Please wait until your open orders are delivered or cancelled, or contact support on WhatsApp and we will help.',
          code:  'open_orders',
        }, { status: 409, headers: PRIVATE_HEADERS })
      }

      // All of this customer's order ids (paged — PostgREST caps a response at 1000 rows).
      for (let offset = 0; offset < 100_000; offset += 1000) {
        const page = await sbAdmin('GET', `/rest/v1/orders?customer_id=eq.${customerId}&select=id&order=id.asc&limit=1000&offset=${offset}`)
        if (!Array.isArray(page)) throw new Error('unexpected orders response')
        orderIds.push(...page.map((o: { id: string | number }) => o.id))
        if (page.length < 1000) break
      }

      // An order can stay 'delivered' while a return / replacement / refund on it is still open (returns live in their own
      // table). Erasing now would destroy the evidence and contact details that claim needs.
      for (const ids of chunk(orderIds, 100)) {
        const openRet = await sbAdmin('GET', `/rest/v1/returns?order_id=in.(${ids.join(',')})&status=not.in.(refunded,rejected,replaced)&select=id&limit=1`)
        if (Array.isArray(openRet) && openRet.length > 0) {
          return NextResponse.json({
            error: 'You still have a return or refund in progress. We need your details until it is completed, so your account cannot be deleted yet. Please wait until it is finished, or contact support on WhatsApp.',
            code:  'open_orders',
          }, { status: 409, headers: PRIVATE_HEADERS })
        }
      }

      // ── Step 3: return-evidence photos (private bucket) + free text on returns ──
      if (orderIds.length > 0) await deleteReturnEvidence(orderIds)
      for (const ids of chunk(orderIds, 100)) {
        await sbAdmin(
          'PATCH',
          `/rest/v1/returns?order_id=in.(${ids.join(',')})`,
          { customer_name: 'Deleted User', description: null, photo_urls: null },
          'return=minimal',
        )
      }

      // ── Step 4: customer-written free text on orders / ledger ────
      // Closed orders keep only the invoice set of shipping_address (below) and not what the customer typed in the notes box.
      await sbAdmin('PATCH', `/rest/v1/orders?customer_id=eq.${customerId}`, { notes: null }, 'return=minimal')
      await sbAdmin('PATCH', `/rest/v1/loyalty_transactions?customer_id=eq.${customerId}`, { note: null }, 'return=minimal')

      // ── Step 4b: minimise shipping_address on closed orders (read-modify-write per order) ──
      // phone, e-mail and any other key are erased; the invoice set stays. Idempotent: an already-minimal snapshot is
      // skipped, so a retry after a later failure re-writes nothing. Fatal on error (account stays active, retryable).
      const terminalList = TERMINAL_ORDER_STATUSES.join(',')
      for (let offset = 0; offset < 100_000; offset += 1000) {
        const page = await sbAdmin('GET', `/rest/v1/orders?customer_id=eq.${customerId}&order_status=in.(${terminalList})&select=id,shipping_address&order=id.asc&limit=1000&offset=${offset}`)
        if (!Array.isArray(page)) throw new Error('unexpected orders response')
        for (const o of page as Array<{ id: string | number; shipping_address: unknown }>) {
          const next = minimiseShippingAddress(o.shipping_address)
          if (next === null) continue
          if (next === 'drop') console.warn('[account/delete] unparseable shipping_address erased', { order_id: o.id })
          await sbAdmin('PATCH', `/rest/v1/orders?id=eq.${o.id}`, { shipping_address: next === 'drop' ? null : next }, 'return=minimal')
        }
        if (page.length < 1000) break
      }

      // ── Step 5: personal rows keyed by customer ──────────────────
      // saved_addresses (table), wishlist and abandoned carts (name/email/phone snapshots).
      for (const table of ['saved_addresses', 'wishlist', 'abandoned_carts']) {
        await sbAdmin('DELETE', `/rest/v1/${table}?customer_id=eq.${customerId}`, null, 'return=minimal')
      }

      // ── Step 5b: product reviews (verified-purchase reviews, db_migration_v23) ──
      // Like the big marketplaces, the review itself (rating + text) stays - it is public content other shoppers rely on -
      // but it is anonymised and unlinked from the account and order. Tolerates the columns not existing yet (migration
      // not applied): then there is nothing linked to this customer and the step is a no-op, never a failed deletion.
      try {
        await sbAdmin(
          'PATCH',
          `/rest/v1/reviews?customer_id=eq.${customerId}`,
          { customer_name: 'Anonymous customer', customer_id: null, order_id: null },
          'return=minimal',
        )
      } catch (e) {
        const x = e as { status?: number; message?: unknown }
        const missingColumn = x?.status === 400 && /42703|PGRST204|does not exist|Could not find/i.test(String(x?.message ?? ''))
        if (!missingColumn) throw e
      }
    }

    // ── Step 6: rows keyed by e-mail address (no customer link) ──
    // Newsletter and back-in-stock subscriptions, and queued (undelivered) e-mails addressed to this person.
    for (const email of emailSet) {
      const q = encodeURIComponent(email)
      await sbAdmin('DELETE', `/rest/v1/subscribers?email=eq.${q}`, null, 'return=minimal')
      await sbAdmin('DELETE', `/rest/v1/stock_notifications?email=eq.${q}`, null, 'return=minimal')
      await sbAdmin('DELETE', `/rest/v1/failed_emails?to_email=eq.${q}&status=in.(pending,retrying)`, null, 'return=minimal')
      // BUG FIX (Nov 2026 verification): abandoned carts are saved per browser session with name / email / phone and no
      // customer_id (api/v1/actions), so the customer_id delete in step 5 never reached them.
      await sbAdmin('DELETE', `/rest/v1/abandoned_carts?email=eq.${q}`, null, 'return=minimal')
    }
    {
      const phone = String(customerRows?.[0]?.phone ?? '').replace(/\D/g, '').slice(-10)
      if (phone.length === 10) {
        await sbAdmin('DELETE', `/rest/v1/abandoned_carts?or=(phone.eq.${phone},phone.eq.%2B91${phone},phone.eq.91${phone},phone.eq.0${phone})`, null, 'return=minimal')
      }
    }

    if (customerId) {
      // ── Step 7: Anonymise customers row (LAST database write) ────
      // AUDIT ACC-033 — ROOT CAUSE of "Account deletion failed (500)": every write used to end in
      // `.catch(() => null)` and the PATCH sent a column that does not exist (`postal_code`); the error was swallowed,
      // `customers.auth_user_id` stayed set and the auth-user delete died on FK customers_auth_user_id_fkey (23503).
      // This step is FATAL and verified: if it did not apply we stop BEFORE the irreversible auth deletion.
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
          tags:            [],            // admin-assigned labels about the person
          referral_code:   null,          // personal share code
          source:          null,
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
    }

    // ── Step 8: DPDP audit log ────────────────────────────────────
    // event_logs.entity_id is TEXT (not uuid). The requester's IP is stored only as a keyed hash.
    // A failure is retried once and then LOGGED LOUDLY (it used to be swallowed); it does not block the erasure itself,
    // which the data subject is entitled to.
    const auditRow = {
      entity_type: 'customer',
      entity_id:   customerId ?? userId,
      event:       'account.deleted.dpdp',
      actor:       userId,
      metadata: {
        ip_hash:       hashIp(ip),
        reason:        'user_requested',
        dpdp_act_2023: true,
        requested_at:  new Date().toISOString(),
      },
    }
    let auditOk = false
    for (let attempt = 0; attempt < 2 && !auditOk; attempt++) {
      try { await sbAdmin('POST', '/rest/v1/event_logs', auditRow, 'return=minimal'); auditOk = true } catch (e) {
        if (attempt === 1) console.error('[account/delete] AUDIT ROW NOT WRITTEN (erasure itself completed)', { entity_id: auditRow.entity_id, err: e })
      }
    }

    // ── Step 9: Delete Supabase Auth user ─────────────────────────
    // Irrecoverable — the very last step. Retried once; if it still fails the customer row is already unlinked, the
    // person gets an error (no "deleted" e-mail) and support is pointed to the logged entity id.
    try {
      await deleteAuthUser(userId)
    } catch (e) {
      console.error('[account/delete] auth user deletion failed after database erasure', { userId, err: e })
      await deleteAuthUser(userId)
    }

    // ── Step 10: confirmation e-mail — only now that the deletion succeeded ──
    // Uses the address captured before erasure; non-fatal.
    await sendDeletionConfirmation(userEmail)

    // ── Step 7: Clear cookies + respond ──────────────────────────
    const successMsg = (userEmail
      ? `Account deleted. A confirmation has been sent to ${userEmail}. `
      : 'Account deleted successfully. ')
      + 'Your personal data has been erased. Retained on completed orders: only what a GST invoice needs (recipient name, delivery address and, for business orders, GSTIN) for up to 6 years, as required by GST law; your phone number and e-mail are not kept on those orders.'
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
