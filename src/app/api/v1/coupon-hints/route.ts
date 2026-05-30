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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!

// Only select the columns needed to render a hint label.
// max_uses, uses_count, max_discount, first_order_only are excluded.
const HINT_SELECT = 'code,type,value,min_order,expires_at'

interface RawHint {
  code:       string
  type:       'flat' | 'percent'
  value:      number
  min_order:  number | null
  expires_at: string | null
}

export async function GET() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/coupons?is_active=eq.true&select=${HINT_SELECT}&order=value.desc&limit=5`
    const res = await fetch(url, {
      headers: {
        apikey:        SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 120 }, // cache 2 min — hints don't need to be real-time
    })

    if (!res.ok) throw new Error(`Supabase coupons: ${res.status}`)

    const raw: RawHint[] = await res.json()
    const now = new Date()

    const hints = raw
      .filter(c => !c.expires_at || new Date(c.expires_at) > now)
      .slice(0, 3)
      .map(c => ({
        code:  c.code,
        label: c.type === 'percent'
          ? `${c.value}% off${c.min_order ? ` on ₹${c.min_order}+` : ''}`
          : `₹${c.value} off${c.min_order ? ` on ₹${c.min_order}+` : ''}`,
      }))

    return NextResponse.json({ hints }, {
      headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=240' },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[coupon-hints] error:', message)
    // Return empty hints on error — checkout still works without them
    return NextResponse.json({ hints: [] })
  }
}
