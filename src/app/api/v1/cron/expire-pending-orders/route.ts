// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/cron/expire-pending-orders
//
// I1: releases stock held by abandoned online payments. See lib/server/pendingOrders.ts
// for the full safety rules (asks Razorpay first, never releases on uncertainty,
// single-winner release, late payments still honoured).
//
// Also releases earned referral coins (process_referral_rewards) and sends post-delivery review-request e-mails
// (lib/server/reviewRequests.ts) as non-fatal extra steps.
//
// Scheduled by vercel.json `crons`. AUTH: Bearer ${CRON_SECRET} (fails closed).
// ─────────────────────────────────────────────────────────────────────────────
import { refreshCatalogPages } from '@/lib/server/catalogFreshness'
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { rejectUnlessCron } from '@/lib/server/cronAuth'
import { expireStalePendingOrders } from '@/lib/server/pendingOrders'
import { captureError } from '@/lib/logger'
import { sendReviewRequests } from '@/lib/server/reviewRequests'

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

    // Referral coins whose friend's order is now delivered and past the return window (db_migration_v17_referral_controls.sql).
    // Piggy-backs on this sweep because vercel.json is limited to two crons on the Hobby plan. Idempotent, single-winner and
    // non-fatal: a failure here must not mask the stock sweep's result.
    let referralRewards: { rewarded?: number; rejected?: number; waiting?: number } | null = null
    try {
      const { data, error } = await db.rpc('process_referral_rewards', { p_limit: 50 })
      if (error) throw new Error(error.message)
      referralRewards = (data ?? null) as typeof referralRewards
    } catch (e) {
      captureError(e, { action: 'cron.process_referral_rewards', alert: true })
    }

    // "How was your order?" e-mails for orders delivered a few days ago (db_migration_v23, setting review_request_enabled).
    // Non-fatal and self-limiting (batch of 20, time-budgeted); sendReviewRequests never throws, the guard is belt and braces.
    let reviewRequests = 0
    try {
      reviewRequests = (await sendReviewRequests(db)).sent
    } catch (e) {
      captureError(e, { action: 'cron.review_requests', alert: true })
    }

    // Released stock can turn a "sold out" card buyable again — refresh the cached cards.
    // (One regeneration per sweep that actually released something, never per visitor.)
    if (stats.expired > 0) {
      try { refreshCatalogPages() } catch { /* best-effort */ }
    }

    // 500 when anything errored so the failure is visible in Vercel's cron history.
    return NextResponse.json({ ok: stats.errors === 0, ...stats, staleCouponClaimsReleased, referralRewards, reviewRequests }, { status: stats.errors > 0 ? 500 : 200 })
  } catch (e) {
    captureError(e, { action: 'cron.expire_pending_orders', alert: true })
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
