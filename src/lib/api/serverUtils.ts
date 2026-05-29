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
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000'] : []),
]

// Vercel preview URLs change per deployment so can't be hardcoded.
// Allow any *.vercel.app origin — these are Vercel-authenticated deployments,
// not reachable by arbitrary third parties, so CSRF risk is acceptable here.
function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true
  if (/^https:\/\/[a-z0-9-]+-[a-z0-9]+-[a-z0-9]+\.vercel\.app$/.test(origin)) return true
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return true
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
  const base = { httpOnly: true, secure: IS_PROD, sameSite: 'strict' as const, path: '/' }
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

  const orParts = [`auth_user_id.eq.${user.id}`]
  if (phone) orParts.push(`phone.eq.${encodeURIComponent(phone)}`)
  if (email) orParts.push(`email.eq.${encodeURIComponent(email)}`)

  const rows = await sbAdmin(
    'GET',
    `/rest/v1/customers?or=(${orParts.join(',')})&select=*&limit=3`,
  ).catch(() => null)

  if (rows && rows.length > 0) {
    let match =
      rows.find((r: Record<string, unknown>) => r.auth_user_id === user.id) ||
      rows.find((r: Record<string, unknown>) => phone && r.phone === phone) ||
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
  ).catch(() => null)
  return created?.[0] ?? null
}

// ── Rate limiter ──────────────────────────────────────────────
// In-process limiter — suitable for profile mutation endpoints which
// are lower-risk than auth actions.
//
// ⚠ In-process state is NOT shared across Vercel instances.
//   For auth-level security (send_otp, login), use the Upstash KV
//   rate limiter in /api/auth/route.ts instead.
//   Add Upstash KV here too if cross-instance enforcement is needed
//   for profile updates (rare requirement for an e-commerce account page).
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
