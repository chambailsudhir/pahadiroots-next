// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/pincode/[pin] — cached pincode → district/state lookup (account audit, Nov 2026 — ACC-021)
//
// The checkout / address forms used to call the free third-party api.postalpincode.in straight from every customer's
// browser: each typed pincode left our origin (privacy), the host had to be allowed in the CSP, and a slow/blocked
// third party was a per-customer failure. This route is a thin, validated, cached pass-through:
//   • the browser only ever talks to us (CSP no longer needs the third-party host);
//   • a validated answer for a given pincode is cached for 30 days (CDN; never the Next data cache, which would also keep error bodies) (pincodes almost never change), so the upstream is hit
//     once per pincode instead of once per customer;
//   • only the four fields the forms use are forwarded — never arbitrary upstream content;
//   • an upstream failure is a 502 that is NOT cached, so the form falls back to manual entry and the next try retries.
// The response keeps the upstream's array shape so the existing form parsing is unchanged.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/api/serverUtils'
import { PIN_REGEX } from '@/lib/pincodeZones'

const UPSTREAM_TIMEOUT_MS = 4_000
const THIRTY_DAYS = 30 * 24 * 60 * 60
const NEGATIVE_CACHE = 60 * 60        // a confirmed "no such pincode" is cached for an hour only

interface UpstreamOffice { Name?: unknown; District?: unknown; Block?: unknown; State?: unknown }
const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 80) : '')

export async function GET(req: NextRequest, { params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params
  if (!PIN_REGEX.test(pin ?? '')) return NextResponse.json({ error: 'Invalid pincode' }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(`pincode:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many lookups — please wait a moment' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      // NOT the 30-day Next data cache: it stores whatever the upstream answered, including a 200 whose body is an error
      // under load, which then showed "not found" for a valid PIN to everyone. Only validated answers are cached below,
      // through our own Cache-Control (CDN).
      cache:  'no-store',
    })
    if (!res.ok) return NextResponse.json({ error: 'Pincode service unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })

    const data = await res.json() as Array<{ Status?: unknown; Message?: unknown; PostOffice?: UpstreamOffice[] | null }>
    const first = Array.isArray(data) ? data[0] : undefined
    const offices = first?.Status === 'Success' && Array.isArray(first.PostOffice) ? first.PostOffice : []
    if (offices.length === 0) {
      // Only an explicit "No records found" is a genuine "no such pincode". Any other non-success body (Status "Error"
      // with a different/absent message, PostOffice null, an empty array…) is the upstream misbehaving under load —
      // never cache it.
      const msg = typeof first?.Message === 'string' ? first.Message : ''
      if (!/no records found/i.test(msg)) {
        return NextResponse.json({ error: 'Pincode service unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
      }
      return NextResponse.json([{ Status: 'Error', PostOffice: null }], { headers: { 'Cache-Control': `public, s-maxage=${NEGATIVE_CACHE}, stale-while-revalidate=600` } })
    }

    const body = [{
      Status: 'Success',
      PostOffice: offices.slice(0, 5).map(o => ({ Name: str(o.Name), District: str(o.District), Block: str(o.Block), State: str(o.State) })),
    }]
    return NextResponse.json(body, { headers: { 'Cache-Control': `public, s-maxage=${THIRTY_DAYS}, stale-while-revalidate=86400` } })
  } catch {
    return NextResponse.json({ error: 'Pincode service unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
