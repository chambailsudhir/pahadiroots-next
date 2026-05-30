import { NextRequest, NextResponse } from 'next/server'
import { validateCouponSchema } from '@/lib/schemas'
import { validateCouponServer } from '@/lib/services/pricingService'
import { checkCsrf, checkRateLimit } from '@/lib/api/serverUtils'

export async function POST(req: NextRequest) {
  // ── CSRF check ─────────────────────────────────────────────────────────────
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  // ── Rate limit: max 5 coupon attempts per IP per minute ───────────────────
  // This prevents brute-forcing of coupon codes. The existing CSRF check stops
  // cross-origin requests, but an attacker from the same origin (e.g. a browser
  // extension or headless script) could still iterate thousands of codes.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!checkRateLimit(`coupons:${ip}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts — please wait a moment' }, { status: 429 })
  }

  try {
    const body   = await req.json()
    const parsed = validateCouponSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const result = await validateCouponServer(parsed.data.code, parsed.data.subtotal)
    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ success: true, coupon: result.coupon })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
