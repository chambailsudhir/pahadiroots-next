import { GEO_COOKIE, geoValueFor } from '@/lib/consentRegion'
import { NextRequest, NextResponse } from 'next/server'
import { isStoreOpen } from '@/lib/siteSettingsHelpers'
import { STRICT_CSP_PATH, buildStrictCsp, makeNonce } from '@/lib/strictCsp'
import { buildCsp } from '@/lib/csp'
import { clientIpKey } from '@/lib/api/clientIp'

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
//
// BUG FIX (Issue C1, Oct 2026 audit):
//  - The old pattern was only start-anchored, so any top-level path that
//    merely BEGAN with an exempt word (/authentic-honey, /api-docs,
//    /maintenance-tips) skipped the gate. Exempt words now need a path
//    boundary (`/` or end of string).
//  - Files served from /public (images, /js/*, fonts…) were gated too: with
//    the store closed they redirected to /maintenance, breaking every asset
//    the maintenance page itself could reference, and each one cost a
//    Supabase round-trip. Static files are never "pages" — exempt anything
//    that ends in a known asset extension.
export const MAINTENANCE_EXEMPT_PATTERN = new RegExp(
  '^/(?:(?:api|auth|maintenance|reset-password|_next)(?:/|$)|(?:favicon\\.ico|robots\\.txt|sitemap\\.xml)$)' +
  '|\\.(?:png|jpe?g|webp|avif|gif|svg|ico|css|js|mjs|map|json|txt|xml|webmanifest|woff2?|ttf|otf|mp4|webm)$',
  'i',
)

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Same key/value REST read already used by /api/v1/cart-settings and the
// contact page (both anon-key reads of site_settings — RLS already allows
// this), so no new access pattern is introduced here.
//
// BUG FIX (Issue C1): `next: { revalidate: 30 }` is a Data-Cache hint that is
// not guaranteed to apply to fetches made inside proxy.ts, so the claim of a
// "30s edge cache" could not be relied on and every page navigation could pay
// a Supabase round-trip. Cache the answer in module memory instead (per
// instance): 30s after a successful read, 5s after a failure so a transient
// blip neither hammers Supabase nor sticks. Still fail-open.
// Oct 2026: 30s -> 3s. "Close Store" must take effect in seconds. The read is one tiny indexed row, so a short
// per instance cache costs next to nothing.
const STORE_OPEN_TTL_OK_MS   = 3_000
const STORE_OPEN_TTL_FAIL_MS = 5_000
let storeClosedCache: { closed: boolean; expiresAt: number } | null = null
// Round-2 audit: when the cache expired, every concurrent navigation fired its OWN read (a burst of N requests = N queries on an
// already slow database). All callers now share one in-flight read.
let storeClosedInFlight: Promise<boolean> | null = null

function isStoreClosed(): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON) return Promise.resolve(false) // not configured → fail-open
  if (storeClosedCache && storeClosedCache.expiresAt > Date.now()) return Promise.resolve(storeClosedCache.closed)
  if (!storeClosedInFlight) storeClosedInFlight = readStoreClosed().finally(() => { storeClosedInFlight = null })
  return storeClosedInFlight
}

async function readStoreClosed(): Promise<boolean> {
  const now = Date.now()
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/site_settings?key=eq.store_open&select=value`,
      {
        headers: { apikey: SUPABASE_ANON as string, Authorization: `Bearer ${SUPABASE_ANON as string}` },
        signal: AbortSignal.timeout(1_500),
        // Always hit Supabase when the in-memory cache above has expired.
        cache: 'no-store',
      },
    )
    if (!res.ok) {
      storeClosedCache = { closed: false, expiresAt: now + STORE_OPEN_TTL_FAIL_MS }
      return false
    }
    const rows: { value: string }[] = await res.json()
    const closed = rows[0]?.value !== undefined && !isStoreOpen({ store_open: rows[0].value })
    storeClosedCache = { closed, expiresAt: now + STORE_OPEN_TTL_OK_MS }
    return closed
  } catch {
    // timeout/network error → fail-open, site stays up
    storeClosedCache = { closed: false, expiresAt: now + STORE_OPEN_TTL_FAIL_MS }
    return false
  }
}

// ── Strict CSP inputs ───────────────────────────────────────────────────
// The consent bootstrap script in the root layout depends on two owner settings; its CSP hash must be computed from the same
// values. Read them (anon key, same RLS-safe table as the store_open read above) at most once a minute.
interface BootstrapSettings { google_tag_id: string; cookie_consent_mode: string }
let bootstrapCache: { v: BootstrapSettings; expiresAt: number } | null = null
// Failure TTL + single flight (round-2 audit): a failed read used to be retried by EVERY request on /products, /checkout, /account ...
// (each waiting up to 1.5 s for the slow database). After a failure the last good value (or null) is served for 5 s, and
// concurrent callers share one read.
let bootstrapFailUntil = 0
let bootstrapInFlight: Promise<BootstrapSettings | null> | null = null

function getBootstrapSettings(): Promise<BootstrapSettings | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON) return Promise.resolve(null)
  const now = Date.now()
  if (bootstrapCache && bootstrapCache.expiresAt > now) return Promise.resolve(bootstrapCache.v)
  if (bootstrapFailUntil > now) return Promise.resolve(bootstrapCache?.v ?? null)
  if (!bootstrapInFlight) bootstrapInFlight = readBootstrapSettings().finally(() => { bootstrapInFlight = null })
  return bootstrapInFlight
}

async function readBootstrapSettings(): Promise<BootstrapSettings | null> {
  const now = Date.now()
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/site_settings?key=in.(google_tag_id,cookie_consent_mode)&select=key,value`,
      { headers: { apikey: SUPABASE_ANON as string, Authorization: `Bearer ${SUPABASE_ANON as string}` }, signal: AbortSignal.timeout(1_500), cache: 'no-store' },
    )
    if (!res.ok) { bootstrapFailUntil = now + 5_000; return bootstrapCache?.v ?? null }
    const rows = await res.json() as { key: string; value: string }[]
    const v: BootstrapSettings = { google_tag_id: '', cookie_consent_mode: '' }
    for (const r of rows) if (r.key === 'google_tag_id' || r.key === 'cookie_consent_mode') v[r.key] = r.value ?? ''
    bootstrapCache = { v, expiresAt: now + 60_000 }
    bootstrapFailUntil = 0
    return v
  } catch {
    bootstrapFailUntil = now + 5_000
    return bootstrapCache?.v ?? null
  }
}

/**
 * Checkout and account pages: per-request nonce CSP (see lib/strictCsp.ts). If the settings it depends on cannot be read, fall
 * back to the normal cache-friendly policy for that one response instead of risking a policy that blocks our own scripts.
 */
async function withStrictCsp(req: NextRequest): Promise<NextResponse> {
  const pathname = req.nextUrl.pathname
  const settings = await getBootstrapSettings()
  const nonce = makeNonce()
  const csp = settings
    ? buildStrictCsp({ pathname, nonce, ...settings })
    : buildCsp({ allowEval: /^\/checkout(\/|$)/.test(pathname) })
  const requestHeaders = new Headers(req.headers)
  if (settings) { requestHeaders.set('x-nonce', nonce); requestHeaders.set('content-security-policy', csp) }
  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set('Content-Security-Policy', csp)
  return withGeoCookie(req, res)
}

/**
 * Hands the visitor's country class to the browser (`hv_geo` = eu | row | unk) so the cookie-consent
 * banner can be region-aware WITHOUT making the page dynamic: the HTML stays identical (and cacheable)
 * for everyone and the decision is made client-side. Only rewritten when the value changes.
 * See lib/consentRegion.ts.
 */
function withGeoCookie(req: NextRequest, res: NextResponse): NextResponse {
  try {
    if (req.method !== 'GET') return res
    const value = geoValueFor(req.headers.get('x-vercel-ip-country'))
    if (req.cookies.get(GEO_COOKIE)?.value === value) return res
    res.cookies.set(GEO_COOKIE, value, { path: '/', maxAge: 60 * 60 * 24, sameSite: 'lax', httpOnly: false, secure: process.env.NODE_ENV === 'production' })
  } catch { /* never let a cookie break a page */ }
  return res
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const pathname = req.nextUrl.pathname

  // ── 1. Store maintenance gate ──────────────────────────────────────────
  if (req.method === 'GET' && !MAINTENANCE_EXEMPT_PATTERN.test(pathname)) {
    if (await isStoreClosed()) {
      return NextResponse.redirect(new URL('/maintenance', req.url))
    }
  }

  // ── 1b. Strict per-request CSP for the payment and account pages ───────
  if (req.method === 'GET' && STRICT_CSP_PATH.test(pathname)) {
    return withStrictCsp(req)
  }

  // ── 2. /api/v1/* rate limiting ─────────────────────────────────────────
  // Only apply to /api/v1/* — Next.js internals, /api/auth, static files, etc. pass through.
  if (!API_V1_PATTERN.test(pathname)) {
    return withGeoCookie(req, NextResponse.next())
  }

  // GET requests are idempotent — only rate-limit state-mutating methods.
  if (req.method === 'GET') {
    return NextResponse.next()
  }

  const kvUrl   = process.env.UPSTASH_REDIS_REST_URL
  const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (kvUrl && kvToken) {
    const ip  = clientIpKey(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim())   // IPv6 -> its /64
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
        // BUG FIX (same class of bug found and fixed in rateLimitKv.ts and
        // api/auth/route.ts): Upstash's pipeline REST API returns an array
        // of RESULT OBJECTS — [{"result": 1}, {"result": "OK"}] — not
        // [["INCR", 1], ["EXPIRE", "OK"]] tuples. result[0][1] on a real
        // {result: 1} object reads a nonexistent property → undefined.
        // Here the bug ran the OTHER direction from the route-level checks:
        // `undefined > GLOBAL_LIMIT` is ALSO always false in JavaScript, so
        // this global edge-level limiter could never trigger at all — it
        // silently did nothing for every request, rather than blocking
        // everything. Lower severity than the route-level version (this is
        // defense-in-depth on top of the route-level IP/phone limits, not
        // the only protection), but still a real gap: this global layer is
        // meant to catch basic bot/abuse traffic before it even reaches a
        // route handler.
        const result = await res.json() as Array<{ result?: number | string; error?: string }>
        const count  = result[0]?.result

        if (typeof count === 'number' && count > GLOBAL_LIMIT) {
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

// ── Matcher ────────────────────────────────────────────────────────────────
// PERF FIX (Oct 2026 — Vercel "75% of Fluid Active CPU" warning; the Usage
// page showed ~42% of all CPU burned in *middleware* on a low-traffic store):
// the old matcher, '/((?!_next/static|_next/image).*)', ran this file for
// EVERY request that wasn't a Next static chunk — every /public asset
// (/logo.png, /js/ai-assistant.js, fonts, icons, sitemap, robots), every
// router prefetch, every analytics beacon, every GET to a read-only API.
// Each of those is a billed invocation even though proxy() immediately
// returned NextResponse.next() for nearly all of them (the in-function
// MAINTENANCE_EXEMPT_PATTERN check could skip the Supabase read, but not the
// invocation itself). Bots and crawlers multiply this: one HTML page pulls
// 10-40 assets, and scanners hammer random paths.
//
// The matcher now selects ONLY what proxy() actually acts on, so everything
// else never invokes it at all:
//   1. Page navigations (for the maintenance gate) — minus /api, /auth,
//      /maintenance, /_next, anything ending in a static-asset extension,
//      and router PREFETCH requests (a prefetch only warms the client cache;
//      the real navigation that follows is still gated).
//   2. Mutating /api/v1/* routes (for the global IP rate limit) — minus the
//      GET-only / self-limited routes listed below, which the limiter always
//      skipped anyway (GET is exempt). New /api/v1 routes stay covered by
//      default; only routes named here opt out.
//
// Keep STATIC_EXT in sync with the extension list in MAINTENANCE_EXEMPT_PATTERN.
// NOTE: Next requires `config` to be statically analysable, so the pieces are
// written out literally rather than built from variables.
export const config = {
  matcher: [
    {
      source:
        '/((?!api/|auth/|_next/|maintenance$|maintenance/|.*\\.(?:png|jpe?g|webp|avif|gif|svg|ico|css|js|mjs|map|json|txt|xml|webmanifest|woff2?|ttf|otf|mp4|webm)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
    // analytics/track has its own bot filter + per-IP limiter and is the
    // single hottest POST on the site (one per page view) — an extra Upstash
    // round-trip per beacon bought almost no protection.
    '/api/v1/((?!analytics/track|cart-settings|cart-upsells|coupon-hints|search-catalog|store-data|cron/|orders/lookup|orders/track|loyalty/history).*)',
  ],
}
