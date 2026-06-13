/**
 * rateLimitKv — shared distributed rate-limiter backed by Upstash KV.
 *
 * BEFORE: coupons/route.ts, orders/route.ts, and payments/route.ts each had
 * their own inline checkXxxRateLimit() function — ~40 identical lines apiece.
 * That means 3 copies of the same INCR+EXPIRE pipeline, 3 copies of the
 * fail-open logic, 3 copies of the timeout constant.  Any change (new header,
 * different timeout, updated warning message) had to be applied in 3 places
 * and could silently diverge between routes.
 *
 * AFTER: single canonical implementation here.  Callers pass:
 *   key       — full KV key including the `mw:rl:` namespace so the counter
 *               is SHARED with middleware.ts (a hit at the middleware layer is
 *               also a hit here — no separate per-route counter).
 *   limit     — max allowed hits per window
 *   windowSec — rolling window length in seconds (default 60)
 *
 * Returns true  = request allowed
 *         false = rate limit exceeded
 *
 * Fail-open: if Upstash KV is unreachable the request is allowed so real users
 * are never blocked by an infra outage.  Middleware's general API rate limit
 * still applies in that case.
 *
 * Consumed by:
 *   /api/v1/coupons/route.ts   (key mw:rl:coupon:<ip>,         limit 5)
 *   /api/v1/orders/route.ts    (key mw:rl:orders_ip:<ip>,      limit 10)
 *                              (key mw:rl:orders_phone:<phone>, limit 3)
 *   /api/v1/payments/route.ts  (key mw:rl:payments_ip:<ip>,    limit 10)
 */

// Emit one warning per cold-start when KV is absent in production so the gap
// surfaces in Vercel logs without flooding every request.
let _kvMissingWarned = false

export async function checkRateLimitKv(
  key:      string,  // full KV key, e.g. `mw:rl:coupon:${ip}`
  limit:    number,
  windowSec = 60,
): Promise<boolean> {
  const kvUrl   = process.env.UPSTASH_REDIS_REST_URL
  const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!kvUrl || !kvToken) {
    if (!_kvMissingWarned && process.env.NODE_ENV === 'production') {
      _kvMissingWarned = true
      console.warn(
        '[rateLimitKv] Upstash KV not configured — route-level rate limits disabled. ' +
        'Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for cross-replica enforcement.',
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
        ['EXPIRE', key, windowSec, 'NX'], // NX = only set expiry on first write
      ]),
      // Short timeout so a slow KV doesn't block the route handler.
      // On timeout we fail-open (return true) so users aren't locked out.
      signal: AbortSignal.timeout(1500),
    })

    if (!res.ok) return true // KV unhealthy — fail-open

    const result = await res.json() as [[string, number], [string, number]]
    return result[0][1] <= limit // true = allowed
  } catch {
    return true // network error / timeout — fail-open
  }
}
