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
 */

import { captureError, logger } from '@/lib/logger'

export async function checkRateLimitKv(
  key:      string,
  limit:    number,
  windowSec = 60,
): Promise<boolean> {
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
    return true // fail-open: middleware general limit still applies
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
      return true // KV unhealthy — fail-open
    }

    const result = await res.json() as [[string, number], [string, number]]
    return result[0][1] <= limit
  } catch (e: unknown) {
    const isTimeout = e instanceof Error && e.name === 'TimeoutError'
    // BUG FIX 7: track connectivity failures as metrics
    logger.metric('kv.error', 1, 'count', {
      key_prefix: key.split(':')[2] ?? key,
      reason:     isTimeout ? 'timeout' : 'network',
    })
    return true // fail-open
  }
}
