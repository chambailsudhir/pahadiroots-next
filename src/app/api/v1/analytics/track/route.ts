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

  // DISK-IO FIX (Oct 2026): the browser now sends `{ events: [...] }` (a batch). A bare single event is still
  // accepted so pages cached before the deploy keep working.
  const MAX_BATCH = 20
  const raw: unknown[] = Array.isArray((body as { events?: unknown }).events)
    ? ((body as { events: unknown[] }).events).slice(0, MAX_BATCH)
    : [body]

  const device_type = classifyDevice(ua)
  type Row = Record<string, unknown>
  const eventRows: Row[] = []
  const sessions = new Map<string, Row>()

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const {
      session_id, visitor_id, event_type,
      path, page_type, product_id, variant_id,
      search_query, results_count, source, metadata,
      // session-only fields, only meaningfully sent on the first event of a session
      landing_page, referrer, utm_source, utm_medium, utm_campaign,
    } = item as Record<string, string | number | undefined>

    if (typeof session_id !== 'string' || !session_id || session_id.length > 100) continue
    if (typeof visitor_id !== 'string' || !visitor_id || visitor_id.length > 100) continue
    if (typeof event_type !== 'string' || !EVENT_TYPES.has(event_type))           continue

    // One session row per session in the batch. landing_page/referrer/utm only come from the FIRST event of a
    // session; omitting the keys otherwise keeps merge-duplicates from overwriting them with NULL.
    const sess: Row = sessions.get(session_id) ?? { session_id, visitor_id, device_type }
    if (typeof landing_page === 'string') sess.landing_page = landing_page.slice(0, 500)
    if (typeof referrer === 'string')     sess.referrer     = referrer.slice(0, 500)
    if (typeof utm_source === 'string')   sess.utm_source   = utm_source.slice(0, 200)
    if (typeof utm_medium === 'string')   sess.utm_medium   = utm_medium.slice(0, 200)
    if (typeof utm_campaign === 'string') sess.utm_campaign = utm_campaign.slice(0, 200)
    sess.last_seen = new Date().toISOString()
    sessions.set(session_id, sess)

    // Overview audit OV-080: a purchase is idempotent per ORDER. The browser guard (localStorage) does not survive a second browser,
    // cleared storage or a retry, and 21 purchase events existed for 20 orders. The database now holds a UNIQUE dedupe_key
    // ('purchase:<order number>'); the insert below ignores a duplicate instead of failing the whole batch.
    const orderRef = event_type === 'purchase' && metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).order_id : undefined
    const dedupe_key = typeof orderRef === 'string' && orderRef.length > 0 && orderRef.length <= 60 ? `purchase:${orderRef}` : null

    eventRows.push({
      dedupe_key,
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
    })
  }

  if (!eventRows.length) return fail(400, 'no valid events')

  try {
    // Sessions first (events reference them). Rows in one bulk upsert must share the same keys, so each
    // session is its own request — a batch from one browser is one session, i.e. one request.
    for (const sess of sessions.values()) {
      await sbAdmin('POST', '/rest/v1/analytics_sessions?on_conflict=session_id', sess, 'resolution=merge-duplicates,return=minimal')
    }
    // ONE bulk insert for the whole batch. Every row has the same keys, as PostgREST requires.
    await sbAdmin('POST', '/rest/v1/analytics_events?on_conflict=dedupe_key', eventRows, 'resolution=ignore-duplicates,return=minimal')
  } catch (err) {
    // Never let a broken analytics insert surface to the visitor.
    captureError(err, { action: 'analytics_track_failed' })
  }

  return ok()
}
