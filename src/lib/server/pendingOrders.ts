// ─────────────────────────────────────────────────────────────────────────────
// lib/server/pendingOrders.ts
//
// I1 — abandoned online payments used to hold stock FOREVER.
//
// Stock is decremented when the pending Razorpay order is created. Before this
// sweep it was only released by a `payment.failed` webhook (which fires only if the
// customer actually attempts and fails a payment) or by a create failure. Closing the
// modal, closing the tab, or losing signal released nothing, and nothing else ever did.
//
// This sweep finds online orders still pending after the expiry window and either
//   (a) discovers the customer DID pay (webhook / callback lost) → confirms the order, or
//   (b) is certain nothing was paid → releases the order and restores its stock.
//
// SAFETY RULES (a missed sale is cheap; a released-then-paid order is not):
//   • Never release when Razorpay cannot be asked — skip and retry next run.
//   • Never release while a payment is `authorized` (in flight), unless the order is
//     older than AUTHORIZED_GRACE_HOURS (manual-capture accounts / stuck authorizations).
//   • The release is a single conditional UPDATE; stock is restored ONLY by the winner,
//     so overlapping runs can never restore twice.
//   • A payment that lands AFTER release is still honoured — confirmOrderPayment()
//     recovers payment_failed orders and re-reserves stock.
//   • The coupon the order consumed is released with it (release_coupon_for_order, migration
//     053) so the customer can retry; the sweep pages through every stale order within a
//     time budget instead of one page of 50.
// ─────────────────────────────────────────────────────────────────────────────
import 'server-only'
import { logOrderEvent } from '@/lib/services/orderService'
import { restoreStockReporting, orderItemsToStockItems } from '@/lib/services/inventoryService'
import { fetchRazorpayOrderPayments, isRazorpayOrderId, checkPaymentAgainstOrder } from '@/lib/server/razorpay'
import { confirmOrderPayment, recordCapturedPayment, runPaidSideEffects } from '@/lib/server/orderPayments'
import { getFreshSiteSettings } from '@/lib/getSiteSettings'
import { logger, captureError } from '@/lib/logger'
import type { getServiceClient } from '@/lib/supabase'

type Db = ReturnType<typeof getServiceClient>

/** Default time an unpaid online order may hold stock. */
export const DEFAULT_EXPIRY_MINUTES = 30
/** Floor: never expire an order a customer could still be paying (UPI collect, 3DS, slow OTP). */
export const MIN_EXPIRY_MINUTES = 20
export const MAX_EXPIRY_MINUTES = 24 * 60
/** An order whose payment sits `authorized` this long is released anyway. */
export const AUTHORIZED_GRACE_HOURS = 24
export const DEFAULT_BATCH = 50
/**
 * Wall clock budget for one run. The cron route is allowed 30 s (vercel.json); every order costs
 * a Razorpay round trip, so stop starting new orders at 22 s and let the next run continue
 * (oldest first, so nothing is starved).
 */
export const DEFAULT_TIME_BUDGET_MS = 22_000

/** admin setting `pending_order_expiry_minutes`, clamped to a safe range. */
export function resolveExpiryMinutes(raw: string | undefined | null): number {
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n)) return DEFAULT_EXPIRY_MINUTES
  return Math.min(MAX_EXPIRY_MINUTES, Math.max(MIN_EXPIRY_MINUTES, n))
}

export interface ExpiryStats {
  scanned:   number
  expired:   number   // released + stock restored
  recovered: number   // found paid at Razorpay → confirmed
  skipped:   number   // could not be verified / payment in flight → left for next run
  errors:    number
  /** True when the time budget ran out before every stale order was looked at (next run continues). */
  timeBudgetHit?: boolean
}

interface PendingRow {
  id:                      string
  order_number:            string | null
  payment_id:              string | null
  total_amount:            number
  customer_id:             string | number | null
  loyalty_points_redeemed: number | null
  created_at:              string
}

export async function expireStalePendingOrders(
  db: Db,
  opts: { now?: Date; olderThanMinutes?: number; batch?: number; timeBudgetMs?: number } = {},
): Promise<ExpiryStats> {
  const now      = opts.now ?? new Date()
  const batch    = opts.batch ?? DEFAULT_BATCH
  const budget   = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS
  const startedAt = Date.now()
  const settings = await getFreshSiteSettings().catch(() => ({} as Record<string, string>))
  const minutes  = opts.olderThanMinutes ?? resolveExpiryMinutes(settings.pending_order_expiry_minutes)
  const cutoff   = new Date(now.getTime() - minutes * 60_000).toISOString()

  const stats: ExpiryStats = { scanned: 0, expired: 0, recovered: 0, skipped: 0, errors: 0 }

  // BUG FIX (Oct 2026 audit): a run used to look at ONE page of 50 orders. With the cron on a
  // daily schedule (Vercel Hobby) that was a hard cap of 50 releases a day: any backlog beyond
  // it never cleared and stock stayed locked. Now it pages through ALL stale orders until the
  // time budget is spent. Paging is by created_at (oldest first) so an order that was skipped
  // (payment in flight / Razorpay unreachable) is not fetched again within the same run.
  let after: string | null = null
  paging: for (;;) {
    let query = db
      .from('orders')
      .select('id, order_number, payment_id, total_amount, customer_id, loyalty_points_redeemed, created_at')
      .eq('payment_method', 'razorpay')
      .eq('payment_status', 'pending')
      .eq('order_status',   'pending')
      .lt('created_at', cutoff)
    if (after) query = query.gt('created_at', after)
    const { data: candidates, error: fetchErr } = await query
      .order('created_at', { ascending: true })
      .limit(batch)

    if (fetchErr) {
      captureError(new Error('pending-order sweep fetch failed: ' + fetchErr.message), {
        action: 'cron.expire_pending_orders.fetch', alert: true,
      })
      stats.errors++
      break
    }

    const page = (candidates ?? []) as PendingRow[]
    if (page.length === 0) break

    for (const order of page) {
      if (Date.now() - startedAt > budget) { stats.timeBudgetHit = true; break paging }
      stats.scanned++
      after = order.created_at
      try {
        const outcome = await processOne(db, order, now, settings)
        stats[outcome]++
      } catch (e) {
        stats.errors++
        captureError(e, { action: 'cron.expire_pending_orders.order', order_id: order.id, alert: true })
      }
    }

    if (page.length < batch) break   // that was the last page
  }

  logger.info('cron: pending-order sweep finished', { action: 'cron.expire_pending_orders', ...stats, minutes })
  return stats
}

async function processOne(
  db: Db,
  order: PendingRow,
  now: Date,
  settings: Record<string, string>,
): Promise<'expired' | 'recovered' | 'skipped'> {
  const ageHours = (now.getTime() - new Date(order.created_at).getTime()) / 3_600_000

  // ── Ask Razorpay whether this order was actually paid ────────────────────
  if (isRazorpayOrderId(order.payment_id)) {
    let payments
    try {
      payments = await fetchRazorpayOrderPayments(order.payment_id)
    } catch (e) {
      // Cannot verify → NEVER release. Try again next run.
      logger.warn('cron: could not query Razorpay for pending order — skipping', {
        action: 'cron.expire_pending_orders.rzp_unavailable', order_id: order.id,
        error: e instanceof Error ? e.message : String(e),
      })
      return 'skipped'
    }

    const paid = payments.find(p =>
      checkPaymentAgainstOrder(p, { razorpayOrderId: order.payment_id!, totalAmountInr: Number(order.total_amount) }).ok,
    )
    if (paid) {
      const confirm = await confirmOrderPayment(db, {
        orderId: order.id, razorpayPaymentId: paid.id, source: 'expiry_sweep',
      })
      if (confirm.outcome === 'confirmed' || confirm.outcome === 'recovered') {
        await logOrderEvent(order.id, 'payment_found_by_sweep', 'system', {
          razorpay_payment_id: paid.id, note: 'Webhook/callback was lost; payment found at Razorpay by the pending-order sweep.',
        }).catch(() => null)
        await recordCapturedPayment(db, {
          orderId: order.id, razorpayPaymentId: paid.id, amountInr: paid.amount / 100,
          alertAction: 'cron.expire_pending_orders.payments_insert',
        })
        await runPaidSideEffects(db, {
          order: {
            id: order.id, order_number: order.order_number, total_amount: order.total_amount,
            customer_id: order.customer_id, loyalty_points_redeemed: order.loyalty_points_redeemed,
          },
          razorpayOrderId: order.payment_id!, razorpayPaymentId: paid.id, settings,
          defer: (fn) => { void fn() },   // no request lifecycle in a cron — run inline
        })
        return 'recovered'
      }
      if (confirm.outcome === 'error') throw new Error('sweep confirm failed: ' + confirm.message)
      return 'skipped'   // already_paid / not_confirmable / not_found → another process owns it
    }

    // A payment is mid-flight (authorized, not yet captured): do not pull stock out from
    // under it — unless it has been stuck implausibly long.
    const inFlight = payments.some(p => p.status === 'authorized')
    if (inFlight && ageHours < AUTHORIZED_GRACE_HOURS) return 'skipped'
  }
  // (payment_id null / not an order_ id → create_payment never got as far as Razorpay:
  //  there is nothing to pay, safe to release.)

  // ── Nothing was paid: release. Single-winner transition FIRST, restore only if we won. ──
  const { data: rows, error: updErr } = await db
    .from('orders')
    .update({ order_status: 'payment_failed', payment_status: 'failed', updated_at: now.toISOString() })
    .eq('id', order.id)
    .eq('order_status',   'pending')
    .eq('payment_status', 'pending')
    .select('id')
  if (updErr) throw new Error('sweep release failed: ' + updErr.message)
  if (!rows || rows.length === 0) return 'skipped'   // paid / released by someone else meanwhile

  const { data: items } = await db
    .from('order_items')
    .select('product_id, variant_id, quantity')
    .eq('order_id', order.id)
  const { failed } = await restoreStockReporting(orderItemsToStockItems(items))

  // BUG FIX (Oct 2026 audit): the coupon this unpaid order consumed stayed consumed, so the
  // customer's retry was refused ("You have already used this coupon"). Release it, once (the
  // function is idempotent). What was released is recorded on the event so ops can reinstate it
  // in the rare case a payment still lands after expiry. Never fatal.
  let couponReleased: unknown = null
  try {
    const { data: rel, error: relErr } = await db.rpc('release_coupon_for_order', { p_order_id: order.id })
    if (relErr) throw relErr
    if (rel && (rel as { released?: boolean }).released) couponReleased = rel
  } catch (e) {
    captureError(e, { action: 'cron.expire_pending_orders.coupon_release', order_id: order.id, alert: false })
  }

  await logOrderEvent(order.id, 'pending_order_expired', 'system', {
    age_hours: Number(ageHours.toFixed(2)),
    stock_restore_failed_items: failed.length,
    ...(couponReleased ? { coupon_released: couponReleased } : {}),
    note: 'Unpaid online order released by the expiry sweep; stock (and any coupon) returned. A late payment is still honoured, but a released coupon is NOT automatically re-applied.',
  }).catch(() => null)
  return 'expired'
}
