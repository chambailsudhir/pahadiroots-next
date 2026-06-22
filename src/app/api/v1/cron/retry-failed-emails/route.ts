// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/cron/retry-failed-emails
//
// Background sweep for the email dead-letter queue (see db_migration_v5_email_dlq.sql
// and lib/server/email.ts). Wired to a Vercel Cron job in vercel.json. Retries
// 'pending' rows whose backoff window has elapsed, with exponential backoff
// between attempts, until MAX_DLQ_ATTEMPTS is reached and a row is marked
// 'dead' for manual ops investigation.
//
// AUTH: Vercel Cron automatically sends `Authorization: Bearer ${CRON_SECRET}`
// for routes referenced in vercel.json's `crons` array — see
// https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
// Requires a CRON_SECRET env var to be set in Vercel; fails closed (500) if
// it's missing rather than ever running as an open, unauthenticated endpoint.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getServiceClient } from '@/lib/supabase'
import { Resend } from 'resend'
import { MAX_DLQ_ATTEMPTS } from '@/lib/server/email'
import { logger, captureError } from '@/lib/logger'

// Cap per-invocation work so this stays comfortably inside Vercel's function
// timeout even if a large backlog accumulates during an extended Resend outage.
const BATCH_SIZE = 25
const SEND_TIMEOUT_MS = 5000

// Exponential backoff between dead-letter retries: 5, 15, 45, 135 minutes
// (attempts 1–4; attempt 5 hitting MAX_DLQ_ATTEMPTS marks the row 'dead'
// before a next_retry_at is ever needed).
function nextRetryDelayMinutes(attemptsAfterThisOne: number): number {
  return 5 * Math.pow(3, attemptsAfterThisOne - 1)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms)),
  ])
}

interface FailedEmailRow {
  id:           string
  type:         string
  to_email:     string
  from_address: string
  subject:      string
  html:         string
  attempts:     number
}

export async function GET(req: NextRequest) {
  // Fail closed: never allow this route to run as an effectively-open
  // endpoint just because the env var was never configured.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    // BUG FIX 15: missing CRON_SECRET means the entire email retry system is
    // silently dead — every invocation returns 500 and dead-lettered emails
    // (including payment confirmations) are never retried. Use captureError with
    // alert:true so ops are paged immediately rather than finding out days later
    // when customers complain they never got their order confirmation.
    captureError(new Error('CRON_SECRET not configured — email retry cron is broken'), {
      action: 'cron.retry_failed_emails.no_secret',
      alert:  true,
    })
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
  }
  // BUG FIX 24b: same timing attack as revalidate/route.ts — !== leaks secret
  // timing information. Fix: timingSafeEqual from Node's crypto module.
  const receivedAuth = req.headers.get('authorization') ?? ''
  const expectedAuth = `Bearer ${cronSecret}`
  const authBuf = Buffer.from(receivedAuth)
  const expBuf  = Buffer.from(expectedAuth)
  const cronAuthValid = authBuf.length === expBuf.length && timingSafeEqual(authBuf, expBuf)
  if (!cronAuthValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getServiceClient()

  const { data: candidates, error: fetchErr } = await db
    .from('failed_emails')
    .select('id, type, to_email, from_address, subject, html, attempts')
    .eq('status', 'pending')
    .lte('next_retry_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (fetchErr) {
    // BUG FIX 15b: DB fetch failure means zero emails retried this sweep.
    // Use structured logger.error so it's parseable by log aggregators.
    logger.error('cron: failed_emails fetch failed', {
      action: 'cron.retry_failed_emails.fetch',
      error:  fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
    })
    return NextResponse.json({ error: 'Fetch failed' }, { status: 500 })
  }

  let claimed = 0, sent = 0, stillFailing = 0, dead = 0

  for (const row of (candidates ?? []) as FailedEmailRow[]) {
    // Atomic claim — mirrors the TOCTOU guard in webhook/razorpay/route.ts.
    // If a previous invocation is still running (slow Resend response) and
    // this one fires before it finishes, only one of them wins the claim;
    // the other sees 0 updated rows and skips, preventing a duplicate send.
    const { data: claimedRows } = await db
      .from('failed_emails')
      .update({ status: 'retrying' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')

    if (!claimedRows || claimedRows.length === 0) continue
    claimed++

    const resend = new Resend(process.env.RESEND_API_KEY)
    let errMessage: string | null = null

    try {
      const { error } = await withTimeout(
        resend.emails.send({
          from:    row.from_address,
          to:      [row.to_email],
          subject: row.subject,
          html:    row.html,
        }),
        SEND_TIMEOUT_MS,
      )
      errMessage = error ? (error.message || JSON.stringify(error)) : null
    } catch (e: unknown) {
      errMessage = e instanceof Error ? e.message : String(e)
    }

    const nowIso = new Date().toISOString()

    if (!errMessage) {
      await db.from('failed_emails')
        .update({ status: 'sent', last_attempt_at: nowIso })
        .eq('id', row.id)
      sent++
      continue
    }

    const newAttempts = row.attempts + 1
    if (newAttempts >= MAX_DLQ_ATTEMPTS) {
      await db.from('failed_emails').update({
        status:          'dead',
        attempts:        newAttempts,
        last_error:      errMessage.slice(0, 1000),
        last_attempt_at: nowIso,
      }).eq('id', row.id)
      dead++
      // BUG FIX 15c: alert:true — a dead-letter email means a customer who
      // paid never received their receipt. Needs immediate ops attention.
      captureError(
        new Error(`Email permanently dead: ${row.type} to ${row.to_email} after ${newAttempts} attempts`),
        {
          action:     'cron.retry_failed_emails.dead',
          email_type: row.type,
          to_email:   row.to_email,
          attempts:   newAttempts,
          last_error: errMessage.slice(0, 200),
          alert:      true,
        },
      )
    } else {
      const nextRetryAt = new Date(Date.now() + nextRetryDelayMinutes(newAttempts) * 60_000).toISOString()
      await db.from('failed_emails').update({
        status:          'pending',
        attempts:        newAttempts,
        last_error:      errMessage.slice(0, 1000),
        last_attempt_at: nowIso,
        next_retry_at:   nextRetryAt,
      }).eq('id', row.id)
      stillFailing++
    }
  }

  // OBSERVABILITY FIX: emit DLQ metrics so a log aggregator can chart throughput
  // and dead-letter rate over time without a separate APM product.
  logger.metric('email.dlq.sent',          sent,         'count')
  logger.metric('email.dlq.still_failing', stillFailing, 'count')
  logger.metric('email.dlq.dead',          dead,         'count')

  return NextResponse.json({
    candidates: candidates?.length ?? 0,
    claimed,
    sent,
    stillFailing,
    dead,
  })
}
