// ═══════════════════════════════════════════════════════════════
// /api/v1/coupon-hints — display-only coupon suggestions
//
// Returns a short list of active coupons for the checkout hint UI.
// Intentionally strips all internal operational fields (uses_count,
// max_uses, max_discount, first_order_only) — callers only get what
// is needed to render a human-readable label alongside the code.
//
// Actual discount amount is always re-computed server-side by
// /api/v1/coupons when the user applies a code — this endpoint
// is purely cosmetic and cannot be used to derive coupon values.
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { rememberGood, recallGood } from '@/lib/api/lastGood'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
// Use the anon key for this public GET endpoint — the service key would grant
// full DB write access if ever leaked. Row-level security on `coupons` must
// allow anon SELECT on non-sensitive columns (code, type, value, min_order,
// expires_at, is_active) for this to work. Internal fields (uses_count,
// max_uses, max_discount, first_order_only) are excluded by the select list.
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Only select the columns needed to render a hint label.
// expires_at is fetched internally for server-side expiry filtering but is
// intentionally excluded from the JSON response — exposing it lets scrapers
// detect when a coupon is about to expire and spam it at peak discount.
// max_uses, uses_count, max_discount, first_order_only are also excluded.
// max_uses and description are fetched ONLY for the server-side S1-010 filter
// below and are never returned.
const HINT_SELECT = 'code,type,value,min_order,expires_at,max_uses,description'

// AUDIT S1-010: the newsletter `subscribe` action mints one personal coupon per
// subscriber (`WELCOME5-<hash>`, max_uses=1, description 'Newsletter welcome…' —
// see lib/welcomeCoupon.ts, api/v1/actions/route.ts). Ordered by value with few
// higher-value public codes, those single-use personal codes filled this public
// hint list, so anyone could burn another subscriber's one-time code. A hint
// must only ever be a genuinely public, multi-use code.
const WELCOME_CODE_PREFIX   = 'WELCOME5-'
const WELCOME_DESC_PREFIX   = 'Newsletter welcome'

interface RawHint {
  code:         string
  type:         'flat' | 'percent'
  value:        number
  min_order:    number | null
  expires_at:   string | null
  max_uses?:    number | null
  description?: string | null
}

/**
 * AUDIT S1-010: true only for coupons that are safe to advertise publicly —
 * multi-use (max_uses null or > 1) and not a per-subscriber welcome code.
 * Applied in JS as well as in the PostgREST filter (belt and suspenders: the
 * last-good fallback and any RLS/column drift must not re-expose a code).
 */
function isPublicHint(c: Pick<RawHint, 'code' | 'max_uses' | 'description'>): boolean {
  if (c.max_uses != null && c.max_uses <= 1) return false
  const code = String(c.code || '').toUpperCase()
  if (code.startsWith(WELCOME_CODE_PREFIX)) return false
  if (String(c.description || '').startsWith(WELCOME_DESC_PREFIX)) return false
  return true
}

// Last-good fallback (see lib/api/lastGood.ts). Hints are purely cosmetic —
// /api/v1/coupons re-validates and re-computes every code when it is applied —
// so a stale list is harmless; an expired code just fails validation on apply.
const LAST_GOOD_KEY    = 'coupon-hints'
const LAST_GOOD_MAX_MS = 60 * 60_000 // 1 h
const FAST_TIMEOUT_MS  = 2_000

export async function GET() {
  const fallback = recallGood<{ code: string; label: string }[]>(LAST_GOOD_KEY, LAST_GOOD_MAX_MS)
  try {
    // BUG FIX 28: expired coupons were fetched from DB then filtered in JS.
    // The now() comparison should happen in the DB (pushes work to Postgres,
    // reduces payload, avoids a JS Date parsing step for each row).
    // Supabase PostgREST supports gte/lte filter operators on timestamp columns.
    // We keep the JS filter as a belt-and-suspenders guard for timezone edge cases.
    const nowIso = new Date().toISOString()
    // AUDIT S1-010: single-use codes (max_uses <= 1) and WELCOME5-* personal
    // codes are excluded in the DB query so they can never crowd out — or
    // appear in — the public list. (and=(or(...),or(...)) is PostgREST's
    // syntax for two OR groups; a bare repeated `or=` would be ambiguous.)
    const url = `${SUPABASE_URL}/rest/v1/coupons?is_active=eq.true&and=(or(expires_at.is.null,expires_at.gte.${nowIso}),or(max_uses.is.null,max_uses.gt.1))&code=not.ilike.${WELCOME_CODE_PREFIX}*&select=${HINT_SELECT}&order=value.desc&limit=10`
    const res = await fetch(url, {
      headers: {
        apikey:        ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      // SEC-FIX: add a timeout so a slow/unresponsive Supabase doesn't hang the
      // serverless function until Vercel's hard 15-second timeout fires.
      // 4 s is generous for a simple SELECT on an indexed table.
      signal: AbortSignal.timeout(fallback ? FAST_TIMEOUT_MS : 4000),
      next: { revalidate: 120 }, // cache 2 min — hints don't need to be real-time
    })

    if (!res.ok) throw new Error(`Supabase coupons: ${res.status}`)

    const raw: RawHint[] = await res.json()
    const now = new Date()

    const hints = raw
      .filter(c => !c.expires_at || new Date(c.expires_at) > now)
      .filter(isPublicHint) // AUDIT S1-010
      .slice(0, 3)
      .map(c => ({
        // expires_at intentionally excluded — exposing it is a timing leak
        // that lets scrapers detect near-expiry coupons and spam them.
        // min_order is included in the label text but not as a raw field
        // so callers can't reconstruct the full coupon profile.
        code:  c.code,
        label: c.type === 'percent'
          ? `${c.value}% off${c.min_order ? ` on ₹${c.min_order}+` : ''}`
          : `₹${c.value} off${c.min_order ? ` on ₹${c.min_order}+` : ''}`,
      }))

    rememberGood(LAST_GOOD_KEY, hints)

    // BUG FIX: the previous header was `s-maxage=120, stale-while-revalidate=240`.
    // s-maxage is a CDN/edge directive — it tells Vercel's edge cache to hold the
    // response for 120 s.  It has NO effect on the browser.  Every page mount
    // therefore fired a fresh HTTP request to this route even though hints change
    // at most once a day.  Adding `public, max-age=120` lets the browser also
    // cache the response for 120 s, eliminating the redundant round-trips.
    // Mirrors the same fix already applied to /api/v1/cart-settings.
    return NextResponse.json({ hints }, {
      headers: { 'Cache-Control': 'public, max-age=120, s-maxage=120, stale-while-revalidate=240' },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    if (fallback) {
      logger.warn('coupon_hints_served_stale', {
        action: 'coupon_hints.stale',
        error:  message,
        ageSec: Math.round(fallback.ageMs / 1000),
      })
      return NextResponse.json({ hints: fallback.value }, {
        // short browser cache so the next page mount retries the live read soon
        headers: { 'Cache-Control': 'no-store', 'X-Data-Stale': '1' },
      })
    }
    logger.error('coupon-hints fetch error', { action: 'coupon_hints.fetch', error: message })
    // BUG FIX 10: previously returned HTTP 200 on all errors.
    // A 200 with empty hints is indistinguishable from "no active coupons"
    // to any monitoring tool — a broken DB connection would look identical to
    // a store with no coupons. Return 500 so uptime monitors can detect it.
    // The checkout page already handles empty hints gracefully.
    return NextResponse.json({ hints: [] }, { status: 500 })
  }
}
