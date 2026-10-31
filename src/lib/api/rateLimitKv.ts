import 'server-only'
/**
 * rateLimitKv — shared distributed rate-limiter backed by Upstash KV.
 *
 * OBSERVABILITY FIXES applied here:
 *
 * BUG 6 — "warn once per cold-start" silent drift:
 *   The previous _kvMissingWarned module-level boolean was set to true on the
 *   first warning and never reset. In Vercel's Lambda model a warm instance
 *   reuses the boolean (stays true → zero further warnings). A new cold-start
 *   resets it to false → exactly ONE warning, then silence again.
 *   If KV is removed from env vars mid-deployment, ops get at most one log line
 *   per new Lambda instance spin-up — practically invisible.
 *
 *   Fix: emit captureError({alert:true}) on EVERY production request when KV
 *   is absent. The log aggregator alert rule fires reliably; Vercel dedupes
 *   identical log lines in the UI so the dashboard doesn't flood.
 *
 * BUG 7 — KV call failures not metriced:
 *   Previously swallowed silently. Now emits logger.metric('kv.error', 1, 'count')
 *   so a dashboard can chart the KV error rate over time.
 *
 * Consumed by:
 *   /api/v1/coupons/route.ts   (key mw:rl:coupon:<ip>,          limit 5)
 *   /api/v1/orders/route.ts    (key mw:rl:orders_ip:<ip>,       limit 10)
 *                              (key mw:rl:orders_phone:<phone>,  limit 3)
 *   /api/v1/payments/route.ts  (key mw:rl:payments_ip:<ip>,     limit 10)
 *                              (key mw:rl:payments_phone10m:<phone>, limit 6 / 600 s)   AUDIT S1-003
 *                              (key mw:rl:payments_ip10m:<ip>,       limit 20 / 600 s)  AUDIT S1-003
 *   orders + payments use checkRateLimitKvStrict() (fail CLOSED, AUDIT S1-016a); the rest keep checkRateLimitKv().
 */

import { captureError, logger } from '@/lib/logger'
import { getServiceClient } from '@/lib/supabase'

// BUG FIX (defense-in-depth): checkRateLimitKv() previously failed OPEN
// (allowed every request, no real limiting) whenever Upstash env vars were
// unavailable at runtime. That's been the confirmed live state in production
// — UPSTASH_REDIS_REST_URL/TOKEN show as configured in Vercel's dashboard,
// but a documented Vercel platform bug around "Sensitive" environment
// variables means the value doesn't reliably reach the function at runtime
// (see project notes; also reported independently on Vercel's own community
// forum with the identical symptom — dashboard shows configured, runtime
// reads empty). Waiting on that to be fixed on the dashboard side would
// leave orders/coupons/payments with zero real rate-limit protection in the
// meantime, so this adds a genuine Postgres-backed fallback (rate_limit_check
// RPC, migration add_db_rate_limit_fallback) rather than just failing open.
// Same fixed-window semantics as the Upstash path (INCR + EXPIRE NX),
// verified atomic and correct via direct SQL testing before being wired in
// here. This runs whenever KV is unavailable OR unhealthy — not just when
// unconfigured — so a transient Upstash outage gets real protection too, not
// just a logged warning.
/**
 * AUDIT S1-016(a): the limiter used to collapse "could not decide" into "allowed". Callers now
 * get the three real outcomes; which one a route treats as a refusal is the route's decision
 * (see checkRateLimitKv vs checkRateLimitKvStrict below).
 */
export type RateLimitOutcome = 'allowed' | 'blocked' | 'unavailable'

/** Retry-After (seconds) a mutation route sends when the limiter itself is unavailable. */
export const RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SEC = 10

async function checkRateLimitDb(key: string, limit: number, windowSec: number): Promise<RateLimitOutcome> {
  try {
    const db = getServiceClient()
    const { data, error } = await db.rpc('rate_limit_check', {
      p_key: key, p_limit: limit, p_window_sec: windowSec,
    })
    if (error) {
      logger.metric('kv.db_fallback.error', 1, 'count', { key_prefix: key.split(':')[2] ?? key })
      return 'unavailable' // DB fallback itself unhealthy — the caller decides open/closed (S1-016a)
    }
    if (typeof data !== 'boolean') {
      logger.metric('kv.db_fallback.error', 1, 'count', { key_prefix: key.split(':')[2] ?? key, reason: 'unexpected_response_shape' })
      return 'unavailable'
    }
    return data ? 'allowed' : 'blocked'
  } catch {
    logger.metric('kv.db_fallback.error', 1, 'count', { key_prefix: key.split(':')[2] ?? key })
    return 'unavailable'
  }
}

/**
 * Legacy boolean API, used by read-mostly / low-risk routes (coupon pre-check, order track/lookup,
 * cart validate, AI guard). Keeps the historical "fail open as an absolute last resort" behaviour
 * when BOTH Upstash and the Postgres fallback are unavailable, but now says so loudly
 * (alert:true) instead of a bare metric. Money-moving routes must use checkRateLimitKvStrict().
 */
export async function checkRateLimitKv(
  key:      string,
  limit:    number,
  windowSec = 60,
): Promise<boolean> {
  const outcome = await resolveRateLimit(key, limit, windowSec)
  if (outcome === 'unavailable') {
    captureError(new Error('Rate limiter unavailable (KV + DB fallback) — request allowed (non-strict caller)'), {
      action: 'rateLimitKv.unavailable_fail_open', key_prefix: key.split(':')[2] ?? key, alert: true,
    })
    return true
  }
  return outcome === 'allowed'
}

/**
 * AUDIT S1-016(a): fail-CLOSED variant for mutation endpoints (order / payment creation).
 * Returns the real outcome; when the limiter cannot decide ('unavailable') the route must answer
 * 503 + Retry-After (RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SEC) rather than create an order with no
 * abuse cap at all. A short-lived "please retry" beats an uncapped stock/coupon-locking window.
 */
export async function checkRateLimitKvStrict(
  key:      string,
  limit:    number,
  windowSec = 60,
): Promise<RateLimitOutcome> {
  const outcome = await resolveRateLimit(key, limit, windowSec)
  if (outcome === 'unavailable') {
    captureError(new Error('Rate limiter unavailable (KV + DB fallback) — mutation refused (fail closed)'), {
      action: 'rateLimitKv.unavailable_fail_closed', key_prefix: key.split(':')[2] ?? key, alert: true,
    })
  }
  return outcome
}

async function resolveRateLimit(
  key:      string,
  limit:    number,
  windowSec: number,
): Promise<RateLimitOutcome> {
  const kvUrl   = process.env.UPSTASH_REDIS_REST_URL
  const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!kvUrl || !kvToken) {
    // BUG FIX 6: warn on EVERY call in production (not once per cold-start).
    // alert:true makes this filterable by log aggregators (Logtail / Datadog).
    if (process.env.NODE_ENV === 'production') {
      captureError(
        new Error('Upstash KV not configured — route-level rate limits disabled'),
        {
          action: 'rateLimitKv.missing_config',
          alert:  true,
          hint:   'Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in Vercel env vars',
        },
      )
    }
    // Real protection via Postgres instead of failing open outright.
    return checkRateLimitDb(key, limit, windowSec)
  }

  try {
    const res = await fetch(`${kvUrl}/pipeline`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${kvToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR',   key],
        ['EXPIRE', key, windowSec, 'NX'],
      ]),
      signal: AbortSignal.timeout(1500),
    })

    if (!res.ok) {
      // BUG FIX 7: log KV errors as metrics so they're chartable
      logger.metric('kv.error', 1, 'count', {
        key_prefix: key.split(':')[2] ?? key,
        status: res.status,
      })
      logger.warn('[rateLimitKv] KV responded with non-OK status', { status: res.status })
      // KV unhealthy — real protection via Postgres instead of failing open.
      return checkRateLimitDb(key, limit, windowSec)
    }

    // BUG FIX (CRITICAL — "Too many requests" on the very first, single click):
    // Upstash's pipeline REST API returns an array of RESULT OBJECTS —
    // [{"result": 1}, {"result": "OK"}] — per Upstash's own documentation and
    // blog (upstash.com/blog/pipeline). This code previously typed and indexed
    // the response as [["INCR", 1], ["EXPIRE", "OK"]] tuples — result[0][1] on
    // an actual {result: 1} object reads a nonexistent numeric property and
    // returns `undefined`. `undefined <= limit` is ALWAYS false in JavaScript
    // (undefined coerces to NaN; every comparison with NaN is false) — so
    // once Upstash was actually reachable (after the env-var fix), EVERY
    // single call to checkRateLimitKv returned "blocked", regardless of the
    // real count. This is why a customer's very first, single checkout click
    // showed "Too many requests" — not an actual limit being exceeded.
    // The unit tests never caught this because their mocked fetch responses
    // matched this same wrong shape (fixed alongside this, see
    // rateLimitKv.test.ts) — asserting against an invented contract instead
    // of Upstash's real one. Only live testing surfaced it.
    const result = await res.json() as Array<{ result?: number | string; error?: string }>
    const incrResult = result[0]?.result
    if (typeof incrResult !== 'number') {
      // Malformed/unexpected response shape (or Upstash returned an
      // {error: ...} entry for the INCR command) — treat as a KV failure
      // rather than silently miscounting forever.
      logger.metric('kv.error', 1, 'count', {
        key_prefix: key.split(':')[2] ?? key,
        reason: 'unexpected_response_shape',
      })
      return checkRateLimitDb(key, limit, windowSec)
    }
    return incrResult <= limit ? 'allowed' : 'blocked'
  } catch (e: unknown) {
    const isTimeout = e instanceof Error && e.name === 'TimeoutError'
    // BUG FIX 7: track connectivity failures as metrics
    logger.metric('kv.error', 1, 'count', {
      key_prefix: key.split(':')[2] ?? key,
      reason:     isTimeout ? 'timeout' : 'network',
    })
    // KV unreachable — real protection via Postgres instead of failing open.
    return checkRateLimitDb(key, limit, windowSec)
  }
}
