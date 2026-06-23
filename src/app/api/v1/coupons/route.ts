import { NextRequest, NextResponse } from 'next/server'
import { validateCouponSchema } from '@/lib/schemas'
import { validateCouponServer } from '@/lib/services/pricingService'
import { checkCsrf } from '@/lib/api/serverUtils'
// REFACTOR: replaced the ~40-line inline checkCouponRateLimit() with the shared
// helper.  The key `mw:rl:coupon:${ip}` is unchanged so the shared counter with
// middleware.ts is preserved — a middleware hit still counts here.
import { checkRateLimitKv } from '@/lib/api/rateLimitKv'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  // ── CSRF check ─────────────────────────────────────────────────────────────
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  // ── Rate limit: max 5 coupon attempts per IP per minute (distributed) ─────
  // Bug-fix: the previous check used checkRateLimit() from serverUtils, which
  // is an in-process Map. That Map is per-Vercel-instance — on a multi-replica
  // deployment an attacker can hit 5 attempts per instance, giving them N×5
  // attempts per minute. Replaced with the same Upstash KV pipeline used by
  // middleware.ts so the counter is global and consistent across replicas.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!await checkRateLimitKv(`mw:rl:coupon:${ip}`, 5)) {
    // BUG FIX 11: missing Retry-After header on 429. RFC 6585 §4 requires it.
    // Without it, clients don't know how long to wait and may hammer immediately.
    return NextResponse.json(
      { error: 'Too many attempts — please wait a moment' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
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
    // BUG FIX [ERROR HANDLING]: previously exposed raw e.message in production
    // (Supabase internals, table names, constraint violations) with no logging.
    logger.error('coupons POST error', { action: 'coupons.post', error: err instanceof Error ? err.message : String(err) })
    const message = process.env.NODE_ENV === 'production'
      ? 'Coupon validation failed — please try again'
      : (err instanceof Error ? err.message : 'Server error')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
