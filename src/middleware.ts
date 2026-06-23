import { NextRequest, NextResponse } from 'next/server'

/**
 * middleware.ts — first-layer edge guardrail for all /api/v1/* routes.
 *
 * Responsibilities
 * ────────────────
 * 1. Global IP rate limit: 120 mutation requests / 60 s across ALL /api/v1 calls.
 *    This is a broad DoS guard that rejects floods before any route handler runs.
 *    The per-route KV limits (orders: 10, payments: 10, coupons: 5) are the
 *    tighter second layer enforced inside each handler via checkRateLimitKv().
 *
 *    Key: mw:rl:global:<ip>
 *    The route-level keys (mw:rl:orders_ip, mw:rl:payments_ip, mw:rl:coupon)
 *    are separate Upstash KV entries — they operate independently so each
 *    handler still enforces its own tighter budget.
 *
 * 2. GET requests are exempt — they are idempotent and already guarded by
 *    Supabase RLS + anon key read-only access.
 *
 * Why here and not next.config.js headers()?
 *    Security headers are set in next.config.js (already deployed). Middleware
 *    is the right place for per-request logic like rate limiting because it runs
 *    at the edge before the route handler, making rejections cheap.
 *
 * Fail-open policy
 *    If Upstash KV is unreachable (network error, timeout) or not configured,
 *    requests pass through. The route-level KV limits still apply. captureError
 *    with alert:true is NOT emitted here (rateLimitKv.ts already does that for
 *    the missing-config case); a middleware timeout is logged as a warning only
 *    since it's a transient network issue, not a misconfiguration.
 */

const API_V1_PATTERN = /^\/api\/v1\//

// 120 mutations / 60 s per IP — generous enough for legitimate users,
// tight enough to stop naive flood attacks before they hit route handlers.
const GLOBAL_LIMIT  = 120
const WINDOW_SEC    = 60

export async function middleware(req: NextRequest): Promise<NextResponse> {
  // Only apply to /api/v1/* — Next.js internals, /api/auth, static files, etc. pass through.
  if (!API_V1_PATTERN.test(req.nextUrl.pathname)) {
    return NextResponse.next()
  }

  // GET requests are idempotent — only rate-limit state-mutating methods.
  if (req.method === 'GET') {
    return NextResponse.next()
  }

  const kvUrl   = process.env.UPSTASH_REDIS_REST_URL
  const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (kvUrl && kvToken) {
    const ip  = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const key = `mw:rl:global:${ip}`

    try {
      const res = await fetch(`${kvUrl}/pipeline`, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${kvToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          ['INCR',   key],
          ['EXPIRE', key, WINDOW_SEC, 'NX'],
        ]),
        // Edge: 1 s budget — cheaper than the 1.5 s in rateLimitKv.ts because
        // middleware runs on every request; fail-open quickly if KV is slow.
        signal: AbortSignal.timeout(1_000),
      })

      if (res.ok) {
        const result = await res.json() as [[string, number], [string, number]]
        const count  = result[0][1]

        if (count > GLOBAL_LIMIT) {
          return NextResponse.json(
            { error: 'Too many requests — please wait a moment' },
            { status: 429, headers: { 'Retry-After': String(WINDOW_SEC) } },
          )
        }
      }
      // Non-OK KV response → fail-open (rateLimitKv.ts logs metric on route-level calls)
    } catch {
      // Timeout or network error → fail-open.
      // No captureError here — transient network issues shouldn't page ops for every
      // edge invocation. The route-level KV check will still run and log if needed.
    }
  }
  // KV not configured → fail-open; route-level limits still apply.

  return NextResponse.next()
}

export const config = {
  // Match all /api/v1/* paths. Next.js middleware runs at the edge (Vercel Edge Network)
  // so this executes before any Node.js serverless function starts.
  matcher: ['/api/v1/:path*'],
}
