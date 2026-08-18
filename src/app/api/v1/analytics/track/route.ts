// ─────────────────────────────────────────────────────────────
// POST /api/v1/analytics/track — receives one visitor event from
// the browser (page view, search, product view, add-to-cart,
// checkout start, purchase) and writes it to Supabase.
//
// Design notes:
//  • Uses the service-role key (sbAdmin) — analytics_sessions and
//    analytics_events have RLS enabled with NO policies, so this
//    route is the ONLY way data gets in.
//  • Fire-and-forget on the client (sendBeacon / fetch keepalive) —
//    this route must never be slow or throw in a way that breaks
//    the page, so all failures are swallowed after logging.
//  • Basic bot filtering via User-Agent — keeps the dashboard numbers
//    meaningful; not meant to be a hardened bot wall.
//  • Rate limited per IP (in-memory, same pattern as other v1 routes)
//    — soft abuse protection, not a security boundary.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { sbAdmin, checkRateLimit } from '@/lib/api/serverUtils'
import { captureError } from '@/lib/logger'

const BOT_UA_PATTERN = /bot|crawl|spider|slurp|headless|curl|wget|python-requests|scrapy|facebookexternalhit|pingdom|uptimerobot|ahrefs|semrush|bytespider/i

const EVENT_TYPES = new Set([
  'page_view', 'search', 'product_view',
  'add_to_cart', 'checkout_start', 'purchase',
])

function ok()                          { return NextResponse.json({ ok: true }) }
function fail(status: number, msg = 'invalid') { return NextResponse.json({ ok: false, error: msg }, { status }) }

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown'
}

function classifyDevice(ua: string): string {
  if (/mobile/i.test(ua))                     return 'mobile'
  if (/tablet|ipad/i.test(ua))                 return 'tablet'
  return 'desktop'
}

export async function POST(req: NextRequest) {
  const ua = req.headers.get('user-agent') || ''

  // Bot traffic never gets written — keeps the dashboard honest.
  if (BOT_UA_PATTERN.test(ua)) return ok()

  const ip = clientIp(req)
  if (!checkRateLimit(`analytics:${ip}`, 240, 60_000)) return fail(429, 'rate limited')

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail(400, 'bad json')
  }

  const {
    session_id, visitor_id, event_type,
    path, page_type, product_id, variant_id,
    search_query, results_count, source, metadata,
    // session-only fields, only meaningfully sent on the first event of a session
    landing_page, referrer, utm_source, utm_medium, utm_campaign,
  } = body as Record<string, string | number | undefined>

  if (typeof session_id !== 'string' || !session_id || session_id.length > 100) return fail(400, 'session_id')
  if (typeof visitor_id !== 'string' || !visitor_id || visitor_id.length > 100) return fail(400, 'visitor_id')
  if (typeof event_type !== 'string' || !EVENT_TYPES.has(event_type))           return fail(400, 'event_type')

  const device_type = classifyDevice(ua)

  try {
    // Upsert the session — insert on first event, otherwise just bump last_seen.
    // on_conflict + merge-duplicates keeps landing_page/referrer/utm from the
    // FIRST event of the session (Postgres upsert with ignore-duplicates would
    // drop the update entirely, so we do a light two-step instead).
    await sbAdmin(
      'POST',
      '/rest/v1/analytics_sessions?on_conflict=session_id',
      {
        session_id,
        visitor_id,
        landing_page: typeof landing_page === 'string' ? landing_page.slice(0, 500) : undefined,
        referrer:     typeof referrer === 'string' ? referrer.slice(0, 500) : undefined,
        utm_source:   typeof utm_source === 'string' ? utm_source.slice(0, 200) : undefined,
        utm_medium:   typeof utm_medium === 'string' ? utm_medium.slice(0, 200) : undefined,
        utm_campaign: typeof utm_campaign === 'string' ? utm_campaign.slice(0, 200) : undefined,
        device_type,
        last_seen: new Date().toISOString(),
      },
      'resolution=merge-duplicates,return=minimal',
    )

    await sbAdmin(
      'POST',
      '/rest/v1/analytics_events',
      {
        session_id,
        visitor_id,
        event_type,
        path:          typeof path === 'string' ? path.slice(0, 500) : null,
        page_type:     typeof page_type === 'string' ? page_type.slice(0, 50) : null,
        product_id:    typeof product_id === 'number' ? product_id : null,
        variant_id:    typeof variant_id === 'number' ? variant_id : null,
        search_query:  typeof search_query === 'string' ? search_query.slice(0, 200) : null,
        results_count: typeof results_count === 'number' ? results_count : null,
        source:        typeof source === 'string' ? source.slice(0, 100) : null,
        metadata:      metadata && typeof metadata === 'object' ? metadata : {},
      },
      'return=minimal',
    )
  } catch (err) {
    // Never let a broken analytics insert surface to the visitor.
    captureError(err, { action: 'analytics_track_failed' })
  }

  return ok()
}
