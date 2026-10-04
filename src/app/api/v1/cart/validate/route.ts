// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/cart/validate — C1
//
// Read-only. Returns the current price / availability / stock for each cart line so
// the client can refresh a stale localStorage cart on load and again right before
// payment. createOrder() remains the authority at charge time; this exists so the
// customer sees (and confirms) the amount that will actually be charged.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '@/lib/supabase'
import { orderItemSchema } from '@/lib/schemas'
import { checkRateLimitKv } from '@/lib/api/rateLimitKv'
import { validateCartLines } from '@/lib/server/cartValidation'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ items: z.array(orderItemSchema).min(1).max(30) })

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!await checkRateLimitKv(`mw:rl:cart_validate_ip:${ip}`, 60)) {
    return NextResponse.json({ error: 'Too many requests — please wait a moment' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  try {
    const lines = await validateCartLines(getServiceClient(), parsed.data.items)
    return NextResponse.json({ lines }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    logger.error('cart validate failed', { action: 'cart.validate', error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'Could not validate cart' }, { status: 500 })
  }
}
