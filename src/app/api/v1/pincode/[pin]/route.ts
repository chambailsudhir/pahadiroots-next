// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/pincode/[pin] — cached pincode → district/state lookup (account audit, Nov 2026 — ACC-021)
//
// The checkout / address forms used to call the free third-party api.postalpincode.in straight from every customer's
// browser: each typed pincode left our origin (privacy), the host had to be allowed in the CSP, and a slow/blocked
// third party was a per-customer failure. This route is a thin, validated, cached pass-through:
//   • the browser only ever talks to us (CSP no longer needs the third-party host);
//   • an answer for a given pincode is cached for 30 days (pincodes almost never change), so the upstream is hit
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
      next:   { revalidate: THIRTY_DAYS },
    })
    if (!res.ok) return NextResponse.json({ error: 'Pincode service unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })

    const data = await res.json() as Array<{ Status?: unknown; PostOffice?: UpstreamOffice[] | null }>
    const offices = Array.isArray(data) && Array.isArray(data[0]?.PostOffice) ? data[0]!.PostOffice! : []
    if (offices.length === 0) {
      // A genuine "no such pincode" — safe to cache (for a day, in case it is a new one).
      return NextResponse.json([{ Status: 'Error', PostOffice: null }], { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600' } })
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
