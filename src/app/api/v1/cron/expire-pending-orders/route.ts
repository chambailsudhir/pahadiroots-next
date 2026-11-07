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

  const startedAt = Date.now()
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

    // Safety net for the delivery-coins trigger (db_migration_v30): orders delivered in the last 14 days whose award failed silently.
    let missingCoinsAwarded = 0
    try {
      const { data, error } = await db.rpc('award_missing_delivery_coins', { p_limit: 50 })
      if (error) throw new Error(error.message)
      missingCoinsAwarded = Number(data ?? 0)
    } catch (e) {
      captureError(e, { action: 'cron.award_missing_delivery_coins', alert: true })
    }

    // Pahadi Coins left unused for loyalty_expiry_days (now 120) expire, oldest first, aged from loyalty_expiry_start (db_migration_v37 + v38 review-round-5 fixes).
    let coinsExpiredCustomers = 0
    try {
      const { data, error } = await db.rpc('expire_old_loyalty_points', { p_limit: 200 })
      if (error) throw new Error(error.message)
      coinsExpiredCustomers = Number(data ?? 0)
    } catch (e) {
      captureError(e, { action: 'cron.expire_old_loyalty_points', alert: true })
    }

    // "How was your order?" e-mails for orders delivered a few days ago (db_migration_v23, setting review_request_enabled).
    // Non-fatal and self-limiting (batch of 20, time-budgeted); sendReviewRequests never throws, the guard is belt and braces.
    // The function has a 30 s ceiling (vercel.json) shared by every step above, and a send is claimed BEFORE it happens: a kill in the
    // middle of this step would leave a claim with no e-mail and that customer would never be asked. So give it only what is left
    // (minus a safety margin), and skip it when too little remains - the next run picks the same orders up.
    let reviewRequests = 0
    const remainingMs = 30_000 - (Date.now() - startedAt) - 4_000
    try {
      if (remainingMs >= 8_000) reviewRequests = (await sendReviewRequests(db, { timeBudgetMs: remainingMs })).sent
    } catch (e) {
      captureError(e, { action: 'cron.review_requests', alert: true })
    }

    // Released stock can turn a "sold out" card buyable again — refresh the cached cards.
    // (One regeneration per sweep that actually released something, never per visitor.)
    if (stats.expired > 0) {
      try { refreshCatalogPages() } catch { /* best-effort */ }
    }

    // 500 when anything errored so the failure is visible in Vercel's cron history.
    return NextResponse.json({ ok: stats.errors === 0, ...stats, staleCouponClaimsReleased, referralRewards, missingCoinsAwarded, coinsExpiredCustomers, reviewRequests }, { status: stats.errors > 0 ? 500 : 200 })
  } catch (e) {
    captureError(e, { action: 'cron.expire_pending_orders', alert: true })
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
