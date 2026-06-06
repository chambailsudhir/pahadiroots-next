import { NextRequest, NextResponse } from 'next/server'
import { validateCouponSchema } from '@/lib/schemas'
import { validateCouponServer } from '@/lib/services/pricingService'
import { checkCsrf } from '@/lib/api/serverUtils'

// ── Distributed rate limiter (Upstash KV) ─────────────────────────────────────
// Uses the same Upstash KV pipeline already used by middleware.ts for the coupon
// endpoint. Both layers must use the SAME distributed store so the per-IP limit
// is enforced globally across all Vercel replicas, not just per-instance.
//
// The middleware's coupon rate limit fires first (5/min). This route-level check
// is a defence-in-depth fallback that shares the same key space, so a request
// that somehow bypasses middleware still gets blocked here.
//
// Falls back to allowing the request (fail-open) if Upstash is unreachable so
// real users aren't locked out by an infra outage. The middleware layer provides
// the primary protection in that case.
//
// Returns true = allowed, false = rate-limit exceeded.
async function checkCouponRateLimit(ip: string): Promise<boolean> {
  const kvUrl   = process.env.UPSTASH_REDIS_REST_URL
  const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!kvUrl || !kvToken) {
    // Upstash not configured — no route-level enforcement (middleware still applies).
    // Warn once per cold-start in production so the gap is visible in logs.
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[coupons] Upstash KV not configured — route-level rate limit disabled. ' +
        'Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for cross-replica enforcement.'
      )
    }
    return true // fail-open
  }

  try {
    // Reuse the same key pattern as middleware.ts (`coupon:${ip}`) so both layers
    // share a single counter — a hit at the middleware layer is also a hit here.
    const rlKey = `mw:rl:coupon:${ip}`
    const res = await fetch(`${kvUrl}/pipeline`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR',   rlKey],
        ['EXPIRE', rlKey, 60, 'NX'],  // 60-second window; NX = only set on first write
      ]),
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return true  // KV unhealthy — fail-open
    const result = await res.json() as [[string, number], [string, number]]
    const count  = result[0][1]
    return count <= 5  // allow up to 5 per 60 s
  } catch {
    // Network error / timeout — fail-open to avoid blocking legitimate users
    return true
  }
}

export async function POST(req: NextRequest) {
  // ── CSRF check ─────────────────────────────────────────────────────────────
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  // ── Rate limit: max 5 coupon attempts per IP per minute (distributed) ─────
  // Bug-fix: the previous check used checkRateLimit() from serverUtils, which
  // is an in-process Map. That Map is per-Vercel-instance — on a multi-replica
  // deployment an attacker can hit 5 attempts per instance, giving them N×5
  // attempts per minute. Replaced with the same Upstash KV pipeline used by
  // middleware.ts so the counter is global and consistent across replicas.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!await checkCouponRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many attempts — please wait a moment' }, { status: 429 })
  }

  try {
    const body   = await req.json()
    const parsed = validateCouponSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const result = await validateCouponServer(parsed.data.code, parsed.data.subtotal)
    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ success: true, coupon: result.coupon })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
