// ─────────────────────────────────────────────────────────────────────────────
// lib/server/email.ts — transactional email send with retry + dead-letter queue
//
// Consumed by:
//   /api/v1/orders/route.ts    (customer confirmation + admin notification)
//   /api/v1/payments/route.ts  (payment confirmation)
//   /api/v1/actions/route.ts   (contact form)
//
// AUDIT FIX [ERROR HANDLING — CRITICAL]: every call site previously did
// `await resend.emails.send(...)` wrapped in try/catch, logging only on a
// *thrown* exception. But the Resend SDK's internal fetchRequest() catches
// BOTH network errors and non-2xx API responses itself and always resolves
// with `{ data: null, error }` — it does not reject. That means none of the
// existing catch blocks ever fired for the most common real-world failure:
// a bad/expired API key, an unverified sending domain, a bounced recipient,
// a monthly send-volume cap, or a Resend-side rate limit. The email failed
// to send with literally zero trace anywhere, while the order/payment/
// contact flow continued as if it had succeeded — a true silent failure,
// and on top of that, no retry and no record to recover from it later.
//
// Fix, in two parts:
//   1. Check the resolved `error` field explicitly (not just rely on a
//      thrown exception) — see sendTransactionalEmail() below.
//   2. If every inline attempt still fails, persist a dead-letter row in
//      `failed_emails` (see db_migration_v5_email_dlq.sql) instead of just
//      logging and moving on. /api/v1/cron/retry-failed-emails sweeps that
//      table on a schedule (see vercel.json `crons`) and retries with
//      exponential backoff, until MAX_DLQ_ATTEMPTS is reached and the row
//      is marked 'dead' for manual ops investigation.
//
// `import 'server-only'` causes a build-time error if this module is ever
// accidentally imported into a 'use client' file, preventing
// RESEND_API_KEY / SUPABASE_SERVICE_KEY from leaking into the browser bundle.
// ─────────────────────────────────────────────────────────────────────────────
import 'server-only'
import { Resend } from 'resend'
import { createHash } from 'node:crypto'
import { getServiceClient } from '@/lib/supabase'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { sanitizeHtml } from '@/lib/server/sanitize'
import { emailSafeHtml } from '@/lib/server/emailSafeHtml'

export type TransactionalEmailType =
  | 'order_confirmation'
  | 'admin_order_notify'
  | 'payment_confirmation'
  | 'order_cancelled'
  | 'signup_verification'
  | 'contact_form'
  // BUG FIX (P1 — trust): added for the newsletter signup discount-code
  // email (api/v1/actions/route.ts `subscribe`). The homepage previously
  // promised "5% off, check your inbox" without ever generating a code or
  // sending anything — this type is what actually fulfills that promise.
  | 'newsletter_welcome'
  // Nov 2026: "How was your order?" mail sent a few days after delivery (lib/server/reviewRequests.ts).
  | 'review_request'
  // Nov 2026 (finding G): the forgot-password link mail (api/auth/route.ts) — used to bypass this module and go to Resend directly.
  | 'password_reset'

export interface SendTransactionalEmailParams {
  type:      TransactionalEmailType
  to:        string
  subject:   string
  html:      string
  /** Defaults to 'HimVeda by Pahadi Roots <noreply@pahadiroots.com>' — override only if a call site genuinely needs a distinct sender display name (e.g. contact-form notifications). */
  from?:     string
  /** Free-form ops/replay reference (e.g. { order_id, order_number }). Never put secrets here. */
  context?:  Record<string, unknown>
  /** Per-attempt timeout. Default 5s matches the budget already used at every call site. */
  timeoutMs?: number
}

export interface SendTransactionalEmailResult {
  sent:          boolean
  error?:        string
  /** True once a failure has been durably persisted to failed_emails for later retry. */
  deadLettered?: boolean
}

// Attempts made INLINE, within the current request, before falling back to
// the dead-letter queue. Kept small (2) so a Resend outage doesn't eat into
// the calling route's own request budget (orders/payments routes already
// have other work to do after the email block).
const INLINE_ATTEMPTS         = 2
const INLINE_RETRY_DELAY_MS   = 400
// Background-sweep attempts (via the cron route) before giving up entirely
// and marking a row 'dead'. Exported so the cron route's backoff schedule
// and any ops tooling stay in sync with this single source of truth.
export const MAX_DLQ_ATTEMPTS = 5

/**
 * Nov 2026 (e-mail verification, finding H): a Resend rejection that NO retry can fix — a malformed recipient, a missing field, an
 * unverified from address, an unknown resource. The dead-letter sweep used to retry these 5× over ~3.3 h before giving up; it now closes
 * the row as 'dead' on the first sweep (with the error) so ops see it at once, while 5xx / rate-limit / API-key / network failures keep
 * the backoff schedule. Classified by Resend's error `name` (https://resend.com/docs/api-reference/errors); only when there is no code
 * (an older SDK, a hand-built error) does the message text decide. A known but non-permanent code always wins over the text.
 */
const PERMANENT_RESEND_ERROR_NAMES = new Set([
  'validation_error',          // 403/422: e.g. "Invalid `to` field"
  'missing_required_field',    // 422
  'invalid_parameter',         // 422
  'invalid_from_address',      // 403
  'not_found',                 // 404
  'invalid_attachment',        // 422
])
const PERMANENT_RESEND_MESSAGE = /invalid `?(to|from|cc|bcc|reply_to)`? field|not a valid email|missing `?\w+`? field|address is not verified/i
export function isPermanentEmailFailure(error: { name?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const name = typeof error.name === 'string' ? error.name.trim() : ''
  if (name) return PERMANENT_RESEND_ERROR_NAMES.has(name)
  return PERMANENT_RESEND_MESSAGE.test(error.message || '')
}

/**
 * One e-mail = one Resend `Idempotency-Key` (Nov 2026 verification). A 5 s client timeout on a send that Resend DID accept was
 * retried inline, dead-lettered and re-sent by the sweep, so a payment confirmation could arrive two or three times. The key is a
 * hash of what is sent (type, recipient, subject, body), so the inline retries and every later dead-letter retry of the same mail
 * share it and Resend delivers it once (keys live 24 h on Resend's side). SDK 3.x has no option for it, but its post() merges
 * request options, so the client's own auth headers are copied and the key is added; without them the mail is sent as before.
 */
export function emailIdempotencyKey(type: string, to: string, subject: string, html: string): string {
  return `${type}:` + createHash('sha256').update(`${type}\n${to}\n${subject}\n${html}`).digest('hex').slice(0, 48)
}
export function sendWithIdempotency(
  resend: Resend,
  payload: { from: string; to: string[]; subject: string; html: string },
  idempotencyKey: string,
): ReturnType<Resend['emails']['send']> {
  const base = (resend as unknown as { headers?: unknown }).headers
  if (!(base instanceof Headers)) return resend.emails.send(payload)
  const headers = new Headers(base)
  headers.set('Idempotency-Key', idempotencyKey)
  return resend.emails.send(payload, { headers } as unknown as Parameters<Resend['emails']['send']>[1])
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms)),
  ])
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Send a transactional email with bounded inline retries, falling back to a
 * persistent dead-letter row if every inline attempt fails.
 *
 * IMPORTANT: this function never throws. Every failure path — Resend
 * resolving with `{ error }`, a thrown network/timeout error, even a failed
 * DB insert while trying to dead-letter — is caught internally and reported
 * via the return value. Callers do not need their own try/catch; just
 * `await` it and optionally branch on `result.sent` if the caller wants to
 * surface something to the user (none currently do — all four call sites
 * treat email as non-fatal to the user-facing flow, same as before this fix).
 */
export async function sendTransactionalEmail(
  params: SendTransactionalEmailParams,
): Promise<SendTransactionalEmailResult> {
  const { type, to, subject, context, timeoutMs = 5000 } = params
  const from = params.from ?? 'HimVeda by Pahadi Roots <noreply@pahadiroots.com>'
  const resend = new Resend(process.env.RESEND_API_KEY)

  // BUG FIX (confirmed against a live admin-panel screenshot): the Email
  // tab's own UI claims "Email Footer Text: Appears at bottom of every
  // outgoing email ✅" — nothing anywhere in this codebase ever read
  // email_footer_text. Injected here, centrally, in the one function
  // every transactional email actually passes through — rather than
  // editing every call site (orders, payments, contact form,
  // newsletter) individually — so it genuinely applies to "every
  // outgoing email" as claimed, not just the ones someone remembers to
  // update later.
  let html = emailSafeHtml(params.html)   // Outlook-safe backgrounds, see emailSafeHtml.ts
  try {
    const settings = await getSiteSettings()
    if (settings.email_footer_text?.trim()) {
      // AUDIT (Oct 2026, System): this admin-editable text was injected into every e-mail as raw HTML. It now goes through the
      // same allow-list sanitiser as the announcement bar, so a stray <script>/<iframe>/on…= can never reach a customer's inbox.
      const footer = `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;color:#888;">${sanitizeHtml(settings.email_footer_text)}</div>`
      // INSIDE the document (before </body>): content after </html> is dropped or misplaced by Outlook and some webmail.
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${footer}</body>`) : html + footer
    }
  } catch {
    // Non-fatal — an email without the footer is far better than no
    // email at all if settings happen to be unreachable.
  }

  let lastError = 'Unknown error'

  for (let attempt = 1; attempt <= INLINE_ATTEMPTS; attempt++) {
    try {
      const { error } = await withTimeout(
        sendWithIdempotency(resend, { from, to: [to], subject, html }, emailIdempotencyKey(type, to, subject, html)),
        timeoutMs,
      )
      // The check that was missing everywhere: Resend resolves successfully
      // even on an API-level rejection — `error` carries the real failure.
      if (!error) return { sent: true }
      lastError = error.message || JSON.stringify(error)
    } catch (e: unknown) {
      // Genuine thrown exception — our own withTimeout() timing out, or an
      // unexpected SDK-internal throw (e.g. while rendering a React template).
      lastError = e instanceof Error ? e.message : String(e)
    }

    if (attempt < INLINE_ATTEMPTS) await sleep(INLINE_RETRY_DELAY_MS * attempt)
  }

  console.error(`[email] ${type} to ${to} failed after ${INLINE_ATTEMPTS} attempt(s):`, lastError)

  // Dead-letter so the cron sweep can retry later instead of the email
  // being lost the moment this request finishes.
  try {
    const db = getServiceClient()
    const { error: insertErr } = await db.from('failed_emails').insert({
      type,
      to_email:      to,
      from_address:  from,
      subject,
      html,
      context:       context ?? null,
      last_error:    lastError.slice(0, 1000),
      attempts:      0,
      status:        'pending',
      next_retry_at: new Date().toISOString(),
    })
    if (insertErr) {
      // Last resort: the DLQ insert itself failed (DB down, schema drift).
      // Nothing more we can do here — log loudly so this shows up in
      // monitoring, distinct from a routine "retry scheduled" log line.
      console.error(`[email] DEAD-LETTER INSERT FAILED for ${type} to ${to} — email is LOST:`, insertErr)
      return { sent: false, error: lastError, deadLettered: false }
    }
  } catch (dlqErr) {
    console.error(`[email] DEAD-LETTER INSERT THREW for ${type} to ${to} — email is LOST:`, dlqErr)
    return { sent: false, error: lastError, deadLettered: false }
  }

  return { sent: false, error: lastError, deadLettered: true }
}
