import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const RATE_WINDOW_SEC  = 60        // 1 minute
const API_LIMIT        = 20        // 20 API requests/minute per IP
const COUPON_LIMIT     = 5         // 5 coupon attempts/minute per IP (brute-force prevention)

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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ─── Rate limiting on API routes ─────────────────────────────────────────

  if (pathname.startsWith('/api/v1/')) {
    const ip  = req.ip || req.headers.get('x-forwarded-for') || 'unknown'

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

    const key = `api:${ip}`
    const allowed = await rateLimit(key, API_LIMIT, RATE_WINDOW_SEC)
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429 }
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

  try {
    // Fetch store_open setting
    const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (supabaseUrl && supabaseAnon) {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/site_settings?key=eq.store_open&select=value`,
        {
          headers: {
            apikey:        supabaseAnon,
            Authorization: `Bearer ${supabaseAnon}`,
          },
          // Cache at the edge for 30 s — store_open rarely changes and
          // hitting Supabase on every page request is unnecessary load.
          next: { revalidate: 30 },
          // Short timeout — don't block page load
          signal: AbortSignal.timeout(2000),
        }
      )

      if (res.ok) {
        const data = await res.json()
        const storeOpen = data?.[0]?.value !== 'false'

        if (!storeOpen) {
          return NextResponse.rewrite(new URL('/maintenance', req.url))
        }
      }
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
