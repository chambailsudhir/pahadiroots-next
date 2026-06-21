// ─────────────────────────────────────────────────────────────────────────────
// proxy.ts (formerly middleware.ts)
//
// BUG FIX (Next.js 16 migration): Next 16 deprecated the `middleware.ts` file
// convention in favor of `proxy.ts` — same execution point (intercepts every
// matched request before it reaches a route), but now runs on the Node.js
// runtime instead of the Edge runtime. Build warning was:
//   "The middleware file convention is deprecated. Please use proxy instead."
// This is a straight rename (file + exported function name); all logic below
// — rate limiting, store-open check — is unchanged and behaves identically.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const RATE_WINDOW_SEC  = 60        // 1 minute
const API_LIMIT        = 20        // 20 API requests/minute per IP
const COUPON_LIMIT     = 5         // 5 coupon attempts/minute per IP (brute-force prevention)
const ORDERS_LIMIT     = 10        // 10 order submissions/minute per IP (matches route-level guard)

// ─── store_open TTL cache ─────────────────────────────────────────────────────
// next: { revalidate } is ignored in Edge middleware (no App Router cache).
// This lightweight in-process cache fires at most one Supabase call per
// cold-start instance per 30 s, dropping N calls/min to ~1 per 30 s.
let _storeOpenCache: { value: boolean; expiresAt: number } | null = null
const STORE_OPEN_TTL_MS = 30_000 // 30 seconds

async function getCachedStoreOpen(): Promise<boolean> {
  const now = Date.now()
  if (_storeOpenCache && now < _storeOpenCache.expiresAt) {
    return _storeOpenCache.value
  }

  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnon) return true // no config — fail open

  const res = await fetch(
    `${supabaseUrl}/rest/v1/site_settings?key=eq.store_open&select=value`,
    {
      headers: {
        apikey:        supabaseAnon,
        Authorization: `Bearer ${supabaseAnon}`,
      },
      // Short timeout — don't block page load; fail-open on timeout
      signal: AbortSignal.timeout(2000),
    }
  )
  if (!res.ok) return true // DB unavailable — fail open

  const data = await res.json()
  const value = data?.[0]?.value !== 'false'
  _storeOpenCache = { value, expiresAt: now + STORE_OPEN_TTL_MS }
  return value
}


// ─── Distributed rate limiter (Upstash KV) ───────────────────────────────────
// Uses the same INCR + EXPIRE pipeline already used by auth/route.ts.
// Falls back to a per-instance Map when KV is not configured (local dev only).
// The fallback is NOT reliable across Vercel instances — configure Upstash KV
// via UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for production.
type RateEntry = { count: number; reset: number }
const _localRateMap = new Map<string, RateEntry>()

// Emit a single warning per cold-start when KV is absent in production so the
// issue surfaces in Vercel logs without flooding every subsequent request.
let _kvMissingWarned = false

async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const kvUrl   = process.env.UPSTASH_REDIS_REST_URL
  const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (kvUrl && kvToken) {
    try {
      const rlKey = `mw:rl:${key}`
      const res = await fetch(`${kvUrl}/pipeline`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify([
          ['INCR',   rlKey],
          ['EXPIRE', rlKey, windowSec, 'NX'],  // NX = only set expiry on first write
        ]),
        signal: AbortSignal.timeout(1500),
      })
      if (res.ok) {
        const result = await res.json() as [[string, number], [string, number]]
        const count  = result[0][1]
        return count <= limit  // true = allowed
      }
    } catch {
      // KV unreachable — fall through to in-process fallback
    }
  }

  // In-process fallback (local dev / KV not yet configured)
  if (!_kvMissingWarned) {
    _kvMissingWarned = true
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[middleware] Upstash KV not configured — rate-limiting falls back to a per-instance ' +
        'Map. Burst limits are NOT enforced globally across Vercel edge replicas. ' +
        'Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN to fix this.'
      )
    }
  }
  const now   = Date.now()
  const entry = _localRateMap.get(key)
  if (!entry || now > entry.reset) {
    _localRateMap.set(key, { count: 1, reset: now + windowSec * 1000 })
    return true
  }
  if (entry.count >= limit) return false
  entry.count++
  return true
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ─── Rate limiting on API routes ─────────────────────────────────────────

  if (pathname.startsWith('/api/v1/')) {
    // BUG FIX (Next.js 15+/16 migration): `req.ip` was an Edge-runtime-only
    // convenience property and has been removed entirely (proxy.ts now runs
    // on the Node.js runtime). Also fixes a pre-existing inconsistency: this
    // was the only IP-extraction site in the codebase NOT splitting/trimming
    // x-forwarded-for (which can be a comma-separated proxy chain — using it
    // raw would weaken rate-limit keying) and the only one missing the
    // x-real-ip fallback that every other route already uses.
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown'

    // Coupon endpoint gets a tighter limit (5/min) to prevent brute-force attacks
    if (pathname === '/api/v1/coupons') {
      const allowed = await rateLimit(`coupon:${ip}`, COUPON_LIMIT, RATE_WINDOW_SEC)
      if (!allowed) {
        return NextResponse.json(
          { error: 'Too many coupon attempts. Please wait before trying again.' },
          {
            status: 429,
            headers: { 'Retry-After': String(RATE_WINDOW_SEC) },
          }
        )
      }
    }

    // Orders endpoint gets a dedicated limit (10/min) — tighter than the generic
    // API limit and consistent with the route-level checkOrderIpLimit in orders/route.ts.
    // Both share the same Upstash key space (`mw:rl:orders_ip:${ip}`) so they
    // count together as a single distributed counter.
    if (pathname === '/api/v1/orders') {
      const allowed = await rateLimit(`orders_ip:${ip}`, ORDERS_LIMIT, RATE_WINDOW_SEC)
      if (!allowed) {
        return NextResponse.json(
          { error: 'Too many order requests. Please wait before trying again.' },
          {
            status: 429,
            headers: { 'Retry-After': String(RATE_WINDOW_SEC) },
          }
        )
      }
    }

    const key = `api:${ip}`
    const allowed = await rateLimit(key, API_LIMIT, RATE_WINDOW_SEC)
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        // SEC-FIX: add Retry-After so clients know when to retry — required by
        // RFC 6585 §4 and avoids hammering the API again immediately.
        { status: 429, headers: { 'Retry-After': String(RATE_WINDOW_SEC) } }
      )
    }
    return NextResponse.next()
  }

  // ─── Store open/closed check ──────────────────────────────────────────────
  // Skip for: API routes, _next static, favicon, maintenance page itself

  const skip =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/maintenance') ||
    pathname.startsWith('/auth/') ||   // ← auth callbacks must never be intercepted
    pathname === '/favicon.ico' ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg')

  if (skip) return NextResponse.next()

  // PERF/SEC FIX: next: { revalidate: 30 } is silently ignored in Edge middleware
  // (the App Router fetch cache is not available there). Without caching, every page
  // request caused a live Supabase round-trip — N calls/min at normal traffic.
  // Fix: in-process TTL cache (30 s) so at most one Supabase hit fires per cold-start
  // instance per 30 s. In-process is acceptable here (unlike rate-limiting) because
  // store_open is a read-only soft signal; a ≤30 s per-replica inconsistency is far
  // less harmful than an uncached DB call on every request.
  try {
    const storeOpen = await getCachedStoreOpen()
    if (!storeOpen) {
      return NextResponse.rewrite(new URL('/maintenance', req.url))
    }
  } catch {
    // If check fails, allow through (fail open — better than blocking real customers)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Apply to all routes except static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
