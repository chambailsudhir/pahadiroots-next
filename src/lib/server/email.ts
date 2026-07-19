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
import { getServiceClient } from '@/lib/supabase'
import { getSiteSettings } from '@/lib/getSiteSettings'

export type TransactionalEmailType =
  | 'order_confirmation'
  | 'admin_order_notify'
  | 'payment_confirmation'
  | 'contact_form'
  // BUG FIX (P1 — trust): added for the newsletter signup discount-code
  // email (api/v1/actions/route.ts `subscribe`). The homepage previously
  // promised "5% off, check your inbox" without ever generating a code or
  // sending anything — this type is what actually fulfills that promise.
  | 'newsletter_welcome'

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
  let html = params.html
  try {
    const settings = await getSiteSettings()
    if (settings.email_footer_text?.trim()) {
      html += `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;color:#888;">${settings.email_footer_text}</div>`
    }
  } catch {
    // Non-fatal — an email without the footer is far better than no
    // email at all if settings happen to be unreachable.
  }

  let lastError = 'Unknown error'

  for (let attempt = 1; attempt <= INLINE_ATTEMPTS; attempt++) {
    try {
      const { error } = await withTimeout(
        resend.emails.send({
          from,
          to:      [to],
          subject,
          html,
        }),
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
