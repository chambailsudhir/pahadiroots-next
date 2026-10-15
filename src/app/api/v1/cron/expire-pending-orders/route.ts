// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/cron/expire-pending-orders
//
// I1: releases stock held by abandoned online payments. See lib/server/pendingOrders.ts
// for the full safety rules (asks Razorpay first, never releases on uncertainty,
// single-winner release, late payments still honoured).
//
// Scheduled by vercel.json `crons`. AUTH: Bearer ${CRON_SECRET} (fails closed).
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { rejectUnlessCron } from '@/lib/server/cronAuth'
import { expireStalePendingOrders } from '@/lib/server/pendingOrders'
import { captureError } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const denied = rejectUnlessCron(req, 'cron.expire_pending_orders')
  if (denied) return denied

  try {
    const db = getServiceClient()
    const stats = await expireStalePendingOrders(db)

    // F-07: release coupon claims orphaned by a process that died between claim and order commit.
    // Non-fatal — a failure here must not mask the stock sweep's result.
    let staleCouponClaimsReleased = 0
    try {
      const { data, error } = await db.rpc('release_stale_coupon_claims', { p_older_than_minutes: 30 })
      if (error) throw new Error(error.message)
      staleCouponClaimsReleased = Number(data ?? 0)
    } catch (e) {
      captureError(e, { action: 'cron.release_stale_coupon_claims', alert: true })
    }

    // 500 when anything errored so the failure is visible in Vercel's cron history.
    return NextResponse.json({ ok: stats.errors === 0, ...stats, staleCouponClaimsReleased }, { status: stats.errors > 0 ? 500 : 200 })
  } catch (e) {
    captureError(e, { action: 'cron.expire_pending_orders', alert: true })
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
