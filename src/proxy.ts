import { NextRequest, NextResponse } from 'next/server'

/**
 * middleware.ts — first-layer edge guardrail.
 *
 * Responsibilities
 * ────────────────
 * 1. Store maintenance gate (ALL page routes, added — see BUG FIX below).
 * 2. Rate limiting for /api/v1/* routes (unchanged, see below).
 *
 * ── BUG FIX (store maintenance gate never actually existed) ───────────────
 * `site_settings.store_open` is a real, admin-editable flag — SiteSettings
 * has had a typed `store_open` field with a documented default, there's a
 * dedicated /maintenance page with its own copy, robots.ts already
 * disallows /maintenance from being indexed, and auth/layout.tsx even has a
 * comment ("Prevents store maintenance check from blocking OAuth callback")
 * written in anticipation of this check. But nothing anywhere ever actually
 * read store_open and acted on it — this file's matcher was scoped to only
 * /api/v1/*, so it never ran for page requests at all. Toggling "Close
 * Store" in the admin panel had zero effect on the live storefront; visitors
 * could keep browsing, adding to cart, and checking out regardless.
 * Fixed by widening the matcher to (nearly) all paths and redirecting to
 * /maintenance when store_open === 'false', while explicitly exempting
 * /api (webhooks/health must keep working), /auth (OAuth callback, per the
 * pre-existing comment), /maintenance itself (no redirect loop), and Next
 * internals/static assets.
 *
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
 *    since it's a transient network issue, not a misconfiguration. The store
 *    maintenance check below follows the same fail-open philosophy: if the
 *    settings fetch errors or times out, the site stays UP rather than
 *    accidentally locking out every customer because of a transient network blip.
 */

const API_V1_PATTERN = /^\/api\/v1\//

// 120 mutations / 60 s per IP — generous enough for legitimate users,
// tight enough to stop naive flood attacks before they hit route handlers.
const GLOBAL_LIMIT  = 120
const WINDOW_SEC    = 60

// Paths the maintenance gate must never touch, regardless of store_open.
// Exported for direct unit testing (see src/__tests__/proxyMaintenanceGate.test.ts) —
// getting this regex wrong either breaks webhooks/OAuth or creates a redirect loop.
export const MAINTENANCE_EXEMPT_PATTERN = /^\/(api|auth|maintenance|_next|favicon\.ico|robots\.txt|sitemap\.xml)/

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Same key/value REST read already used by /api/v1/cart-settings and the
// contact page (both anon-key reads of site_settings — RLS already allows
// this), so no new access pattern is introduced here.
async function isStoreClosed(): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON) return false // not configured → fail-open
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/site_settings?key=eq.store_open&select=value`,
      {
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        signal: AbortSignal.timeout(1_500),
        // Cached for 30s at the edge — a maintenance toggle doesn't need to be
        // instant, and this keeps the check cheap on every single page view.
        next: { revalidate: 30 },
      },
    )
    if (!res.ok) return false
    const rows: { value: string }[] = await res.json()
    return rows[0]?.value === 'false'
  } catch {
    return false // timeout/network error → fail-open, site stays up
  }
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const pathname = req.nextUrl.pathname

  // ── 1. Store maintenance gate ──────────────────────────────────────────
  if (req.method === 'GET' && !MAINTENANCE_EXEMPT_PATTERN.test(pathname)) {
    if (await isStoreClosed()) {
      return NextResponse.redirect(new URL('/maintenance', req.url))
    }
  }

  // ── 2. /api/v1/* rate limiting ─────────────────────────────────────────
  // Only apply to /api/v1/* — Next.js internals, /api/auth, static files, etc. pass through.
  if (!API_V1_PATTERN.test(pathname)) {
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
  // Widened from '/api/v1/:path*' so the maintenance gate can run on page
  // routes too. Excludes Next's own static/image pipeline (never needs
  // gating) — everything else is filtered inside proxy() via
  // MAINTENANCE_EXEMPT_PATTERN / API_V1_PATTERN so the two concerns stay
  // independently readable instead of fighting over one matcher regex.
  matcher: ['/((?!_next/static|_next/image).*)'],
}

