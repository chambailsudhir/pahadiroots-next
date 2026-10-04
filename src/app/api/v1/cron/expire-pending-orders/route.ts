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
    const stats = await expireStalePendingOrders(getServiceClient())
    // 500 when anything errored so the failure is visible in Vercel's cron history.
    return NextResponse.json({ ok: stats.errors === 0, ...stats }, { status: stats.errors > 0 ? 500 : 200 })
  } catch (e) {
    captureError(e, { action: 'cron.expire_pending_orders', alert: true })
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
