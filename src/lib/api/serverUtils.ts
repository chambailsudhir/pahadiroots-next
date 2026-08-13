// ─────────────────────────────────────────────────────────────
// serverUtils — shared helpers for account API routes
//
// Consumed by:
//   /api/profile          GET + POST
//   /api/orders           GET
//   /api/orders/[id]      GET
//   /api/orders/[id]/return  POST
//
// auth/route.ts is intentionally excluded — it has its own
// specialised syncCustomerProfile (needs user_metadata for
// full_name extraction) and its own Upstash rate limiter.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_TOKEN, COOKIE_REFRESH } from '@/lib/auth/cookies'
import { captureError } from '@/lib/logger'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const IS_PROD       = process.env.NODE_ENV === 'production'

// ── Response helpers ──────────────────────────────────────────
export function ok(data: unknown)                    { return NextResponse.json(data) }
export function fail(status: number, msg: string, headers?: Record<string, string>) { return NextResponse.json({ error: msg }, { status, headers }) }

// ── CSRF protection ───────────────────────────────────────────
// Validates the Origin (or Referer fallback) of state-mutating requests
// against the app's own domain. SameSite=Strict on cookies is good but
// does not cover subdomain attacks or misconfigured CDN/proxy setups.
// Call this at the top of every POST / PATCH / DELETE handler.
// Returns a 403 response on mismatch, or null when the origin is valid.
const ALLOWED_ORIGINS = [
  'https://pahadiroots.com',
  'https://www.pahadiroots.com',
  'https://pahadiroots-next.vercel.app',
  'https://pahadiroots-next-git-main-sudhir-chambails-projects.vercel.app',
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000'] : []),
]

// Vercel injects VERCEL_URL for every deployment (e.g. "my-app-abc123.vercel.app").
// We allow only that specific URL — NOT the entire *.vercel.app namespace.
// The old regex matched ANY *.vercel.app project, meaning an attacker who deploys
// their own Vercel app could POST to this API.  Using the exact env var is safe.
function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true
  // VERCEL_URL is set per-deployment by Vercel (no NEXT_PUBLIC_ prefix — server only)
  if (process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`) return true
  return false
}

export function checkCsrf(req: NextRequest): NextResponse | null {
  // Server actions / same-origin fetch always send Origin or Referer.
  const origin  = req.headers.get('origin')
  const referer = req.headers.get('referer')

  const source = origin || (referer ? new URL(referer).origin : null)
  if (!source) {
    // No origin header at all — only safe to allow in non-production (e.g. curl in dev)
    if (process.env.NODE_ENV !== 'production') return null
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isAllowedOrigin(source)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null  // valid
}

// ── Supabase Auth call ────────────────────────────────────────
export async function sbAuth(
  path:   string,
  body:   unknown = null,
  token?: string,
) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method:  body !== null ? 'POST' : 'GET',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON,
      'Authorization': token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON}`,
    },
    body:   body !== null ? JSON.stringify(body) : undefined,
    // Prevent a slow Supabase response from hanging the serverless function
    // until Vercel's hard 15-second timeout.
    signal: AbortSignal.timeout(8000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw { status: res.status, message: data.msg || data.error_description || 'Auth error' }
  return data
}

// ── Supabase Admin REST call ──────────────────────────────────
// `prefer` defaults to 'return=representation'.
// Pass 'resolution=merge-duplicates,return=representation' for upserts.
export async function sbAdmin(
  method: string,
  path:   string,
  body:   unknown = null,
  prefer  = 'return=representation',
) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        prefer,
    },
    body: body ? JSON.stringify(body) : undefined,
    // Prevent a slow Supabase response from hanging the serverless slot
    // until Vercel's hard 15-second timeout — 8 s gives one retry budget.
    signal: AbortSignal.timeout(8_000),
  })
  const text = await res.text()
  if (!res.ok) throw { status: res.status, message: text }
  return text ? JSON.parse(text) : null
}

// ── O(1) count via HEAD + Prefer:count=exact ──────────────────
// PostgREST returns count in the Content-Range header: "0-19/847".
// This avoids fetching rows just to count them (full table scan).
export async function sbAdminCount(path: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method:  'HEAD',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        'count=exact',
    },
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) return 0
  // Content-Range: <start>-<end>/<total>  e.g. "0-19/847" or "*/0" when empty
  const cr    = res.headers.get('content-range') || ''
  const match = cr.match(/\/(\d+)$/)
  return match ? parseInt(match[1], 10) : 0
}

// ── Token helpers ─────────────────────────────────────────────
export function getToken(req: NextRequest): string | null {
  return req.cookies.get(COOKIE_TOKEN)?.value ?? null
}

export interface RefreshResult { token: string; refresh: string }

export async function tryRefresh(req: NextRequest): Promise<RefreshResult | null> {
  const rt = req.cookies.get(COOKIE_REFRESH)?.value
  if (!rt) return null
  try {
    const data = await sbAuth('/token?grant_type=refresh_token', { refresh_token: rt })
    if (!data.access_token) return null
    return { token: data.access_token, refresh: data.refresh_token ?? rt }
  } catch {
    return null
  }
}

export function applyNewCookies(res: NextResponse, access: string, refresh: string) {
  // SEC-FIX: changed sameSite from 'strict' to 'lax' to match session/route.ts
  // and google-callback/route.ts. See auth/route.ts withAuthCookies comment
  // for the full rationale. All cookie-writing paths must agree on SameSite
  // to avoid split-brain session behaviour.
  const base = { httpOnly: true, secure: IS_PROD, sameSite: 'lax' as const, path: '/' }
  res.cookies.set(COOKIE_TOKEN,   access,  { ...base, maxAge: 60 * 60 })
  res.cookies.set(COOKIE_REFRESH, refresh, { ...base, maxAge: 60 * 60 * 24 * 30 })
}

// ── syncCustomerProfile ───────────────────────────────────────
// Finds an existing customer row by auth_user_id, phone, or email.
// If none exists, upserts a new row (race-safe via merge-duplicates
// on the UNIQUE auth_user_id constraint — two concurrent first-logins
// won't create duplicate customer rows).
export async function syncCustomerProfile(user: {
  id:            string
  phone?:        string
  email?:        string
  user_metadata?: Record<string, string>
}) {
  const phone = user.phone || ''
  const email = user.email || ''
  // BUG FIX: matching on the raw phone string missed existing customers
  // whose number was stored in a different format (e.g. with vs without
  // +91 country code) — the exact bug that caused a real customer's order
  // history to silently split across two accounts (see migration 048).
  // normalized_phone is a generated column (last 10 digits, no
  // formatting) added specifically so this kind of match is format-proof.
  const normalizedPhone = phone.replace(/\D/g, '').slice(-10)

  const orParts = [`auth_user_id.eq.${user.id}`]
  if (normalizedPhone) orParts.push(`normalized_phone.eq.${normalizedPhone}`)
  if (email) orParts.push(`email.eq.${encodeURIComponent(email)}`)

  // BUG FIX (observability, found while tracing a live 404 on /api/wishlist):
  // this lookup used to swallow ANY failure (network blip, Supabase timeout)
  // down to `null`, which fell straight into the "not found" branch below and
  // attempted to INSERT a new customer row — for a user who almost certainly
  // already has one. On a transient failure this risked creating a duplicate
  // customer record instead of just failing the request. A lookup failure is
  // now a hard error (thrown, not swallowed) so the caller's existing 401/503
  // catch handling applies instead of silently reaching the insert path — and
  // it's logged so it's visible in Vercel logs rather than invisible.
  let rows: Record<string, unknown>[] | null
  try {
    rows = await sbAdmin(
      'GET',
      `/rest/v1/customers?or=(${orParts.join(',')})&select=*&limit=3`,
    )
  } catch (e: unknown) {
    captureError(e, { action: 'syncCustomerProfile.lookup', userId: user.id })
    throw e
  }

  if (rows && rows.length > 0) {
    let match =
      rows.find((r: Record<string, unknown>) => r.auth_user_id === user.id) ||
      rows.find((r: Record<string, unknown>) => normalizedPhone && r.normalized_phone === normalizedPhone) ||
      rows[0]

    if (match.auth_user_id !== user.id) {
      const patch: Record<string, unknown> = { auth_user_id: user.id }
      if (phone && !match.phone) patch.phone = phone
      await sbAdmin('PATCH', `/rest/v1/customers?id=eq.${match.id}`, patch).catch((e: unknown) => {
        console.warn('[syncCustomerProfile] patch failed — proceeding with stale match:', e)
      })
      match = { ...match, ...patch }
    }
    return match
  }

  // Not found — upsert so concurrent requests cannot create duplicate rows.
  // Use user_metadata.full_name (present after Google OAuth) to populate name fields.
  const fullName  = user.user_metadata?.full_name || ''
  const nameParts = fullName.trim().split(' ')
  const created = await sbAdmin(
    'POST',
    '/rest/v1/customers',
    {
      auth_user_id: user.id,
      first_name:   nameParts[0] || (email ? email.split('@')[0] : 'Customer'),
      last_name:    nameParts.slice(1).join(' ') || null,
      phone:        phone || null,
      email:        email || null,
    },
    'resolution=merge-duplicates,return=representation',
  ).catch((e: unknown) => {
    // BUG FIX (observability, found while tracing a live 404 on /api/wishlist):
    // this used to be a bare `.catch(() => null)` — a genuine data-integrity
    // problem (a real, authenticated Supabase user with no matching customers
    // row, and the auto-create failing — e.g. a unique constraint clash on
    // email/phone against a DIFFERENT existing customer row) surfaced to the
    // user only as an unexplained 404 "Profile not found", with zero trace in
    // Vercel logs to tell ops apart from "user just has no profile yet" (which
    // is impossible here — this branch means it just failed to create one).
    // `alert: true` so this is pageable, not just log noise: an authenticated
    // user stuck with no working profile is a real, ongoing broken experience
    // for that specific customer until someone investigates.
    captureError(e, { action: 'syncCustomerProfile.create', userId: user.id, alert: true })
    return null
  })
  return created?.[0] ?? null
}

// ── toPublicProfile ─────────────────────────────────────────────
// SECURITY FIX: syncCustomerProfile() fetches the customer row with
// `select=*` (needed server-side for a full match/upsert). Multiple routes
// were spreading that ENTIRE raw row directly into the client-facing JSON
// response (/api/profile GET, several branches of /api/auth). That was
// low-risk while `customers` only held customer-authored fields — but the
// admin panel's CRM migration (supabase-migration-customer-crm-fields.sql)
// added `notes` (free-text internal commentary written BY STAFF ABOUT this
// customer), `is_blocked` (blocklist flag), `gstin`, `is_business`, and
// `tags`. Without this allowlist, a blocked customer's own account page
// would show them `is_blocked: true` in the network tab, and any internal
// note a staff member wrote about them would ship straight to their browser.
//
// This is the single choke point every route must pass `profile` through
// before it reaches `NextResponse.json(...)`. Add new customer-facing
// fields here explicitly — do NOT spread the raw row from
// syncCustomerProfile directly into a response again.
const PUBLIC_PROFILE_FIELDS = [
  'id', 'auth_user_id', 'first_name', 'last_name', 'email', 'phone',
  'address_line1', 'address_line2', 'city', 'state', 'pincode',
  'created_at', 'updated_at',
  'notif_email_marketing', 'notif_email_orders', 'notif_sms_orders', 'notif_whatsapp_orders',
  'loyalty_points', 'wishlist_items',
] as const

export function toPublicProfile<T extends Record<string, unknown> | null | undefined>(
  profile: T,
): Partial<Record<(typeof PUBLIC_PROFILE_FIELDS)[number], unknown>> | null {
  if (!profile) return null
  const out: Record<string, unknown> = {}
  for (const key of PUBLIC_PROFILE_FIELDS) {
    if (key in profile) out[key] = (profile as Record<string, unknown>)[key]
  }
  return out
}

// ── Rate limiter ──────────────────────────────────────────────
// In-process limiter — suitable ONLY for low-risk account endpoints
// (profile reads/writes) where cross-replica consistency is not required.
//
// ⚠ DO NOT use this for any security-sensitive endpoint (auth, coupons,
//   orders, payments, loyalty redemption).  In-process state is NOT shared
//   across Vercel instances — on a multi-replica deployment each replica has
//   its own counter, giving an attacker (replicas × limit) attempts per window.
//
//   For security-sensitive routes use the Upstash KV pipeline already
//   implemented in:
//     /api/auth/route.ts
//     /api/v1/coupons/route.ts
//     /api/v1/orders/route.ts
//
// Returns true = request allowed, false = rate limit exceeded.

type RateEntry = { count: number; reset: number }
const _rateLimitMap = new Map<string, RateEntry>()

// Prune stale entries every 5 minutes to prevent memory growth
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of _rateLimitMap) {
    if (now > entry.reset) _rateLimitMap.delete(key)
  }
}, 5 * 60_000)

export function checkRateLimit(
  key:      string,
  maxHits   = 20,
  windowMs  = 60_000,
): boolean {
  const now   = Date.now()
  const entry = _rateLimitMap.get(key)
  if (!entry || now > entry.reset) {
    _rateLimitMap.set(key, { count: 1, reset: now + windowMs })
    return true   // allowed: first request in this window
  }
  if (entry.count >= maxHits) return false  // blocked
  entry.count++
  return true   // allowed
}
