// ─────────────────────────────────────────────────────────────────────────────
// lib/server/orderPayments.ts
//
// Single implementation of "a verified Razorpay capture happened → make the
// order paid", shared by:
//   • POST /api/v1/payments  (verify_payment — the customer's browser callback)
//   • POST /api/v1/webhook/razorpay  (payment.captured — Razorpay's server push)
//
// WHY SHARED (P2 + O2):
//   Both entry points can fire for the same payment, in either order. Before this
//   module only verify_payment ran the loyalty/e-mail side effects, so when the
//   webhook won the race the customer silently never got points or an e-mail (O2).
//   And a `payment.failed` webhook for an earlier failed attempt could kill an
//   order the customer then successfully paid for on retry (P2).
//
// RULES IMPLEMENTED HERE
//   1. The pending → paid transition is a single conditional UPDATE. Exactly one
//      caller wins; only the winner runs side effects (no double loyalty/email).
//   2. A previously-failed order (payment_failed, e.g. released by the expiry job)
//      is RECOVERABLE: a verified capture moves it to paid and re-reserves stock.
//      If the stock is gone the customer has still paid, so the order is kept
//      confirmed and ops are alerted loudly (never silently dropped).
//   3. An order in any other state (e.g. cancelled by an admin) is never silently
//      flipped to paid — ops are alerted with the payment id.
// ─────────────────────────────────────────────────────────────────────────────
import 'server-only'
import { logOrderEvent } from '@/lib/services/orderService'
import { reserveStockAtomicForOrder, orderItemsToStockItems } from '@/lib/services/inventoryService'
import { awardLoyaltyPoints, redeemLoyaltyPoints } from '@/lib/server/loyalty'
import { esc } from '@/lib/server/htmlEscape'
import { sendTransactionalEmail } from '@/lib/server/email'
import { logger, captureError } from '@/lib/logger'
import type { getServiceClient } from '@/lib/supabase'

type Db = ReturnType<typeof getServiceClient>

export type ConfirmOutcome =
  | { outcome: 'confirmed' }
  | { outcome: 'recovered'; stockReReserved: boolean }
  | { outcome: 'already_paid' }
  | { outcome: 'not_found' }
  | { outcome: 'not_confirmable'; orderStatus: string; paymentStatus: string }
  | { outcome: 'error'; message: string }

/** True when a PostgREST update().select() result matched at least one row. */
function updatedAny(rows: unknown): boolean {
  return Array.isArray(rows) ? rows.length > 0 : !!rows
}

/**
 * Atomically move an order to confirmed/paid for a verified capture.
 * Caller MUST have already verified signature/amount/binding — this function only
 * owns the state transition and (for recovered orders) the stock re-reservation.
 */
export async function confirmOrderPayment(
  db: Db,
  args: { orderId: string; razorpayPaymentId: string; source: 'verify_payment' | 'webhook' | 'expiry_sweep' },
): Promise<ConfirmOutcome> {
  const { orderId, razorpayPaymentId, source } = args

  const { data: cur, error: curErr } = await db
    .from('orders')
    .select('id, order_status, payment_status')
    .eq('id', orderId)
    .single()
  if (curErr || !cur) return { outcome: 'not_found' }

  if (cur.payment_status === 'paid') return { outcome: 'already_paid' }

  const isPending = cur.payment_status === 'pending' && cur.order_status === 'pending'
  const isFailed  = cur.payment_status === 'failed'  && cur.order_status === 'payment_failed'
  if (!isPending && !isFailed) {
    return { outcome: 'not_confirmable', orderStatus: String(cur.order_status), paymentStatus: String(cur.payment_status) }
  }

  // Conditional update keyed on the EXACT state we just read: two concurrent
  // callers can both read it, but only one UPDATE matches a row.
  const { data: rows, error: updErr } = await db
    .from('orders')
    .update({
      order_status:   'confirmed',
      payment_status: 'paid',
      payment_id:     razorpayPaymentId,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('payment_status', cur.payment_status)
    .eq('order_status',   cur.order_status)
    .select('id')

  if (updErr) return { outcome: 'error', message: updErr.message }
  if (!updatedAny(rows)) return { outcome: 'already_paid' } // lost the race — winner does the side effects

  if (!isFailed) return { outcome: 'confirmed' }

  // ── Recovery: the order had been failed/released, so its stock went back to the
  // shelf. The customer has now genuinely paid → take the units again. ──────────
  let stockReReserved = false
  try {
    const { data: items } = await db
      .from('order_items')
      .select('product_id, variant_id, quantity')
      .eq('order_id', orderId)
    const reservation = await reserveStockAtomicForOrder(orderItemsToStockItems(items))
    stockReReserved = reservation.ok
  } catch (e) {
    captureError(e, { action: 'orderPayments.recover.reserve_threw', order_id: orderId, alert: true })
  }

  await logOrderEvent(orderId, 'payment_recovered_after_failure', source === 'webhook' ? 'razorpay' : 'system', {
    razorpay_payment_id: razorpayPaymentId, source, stock_re_reserved: stockReReserved,
  })
  if (!stockReReserved) {
    // Money is taken; the order stays confirmed. Ops must fulfil from new stock or refund.
    captureError(new Error('Order paid after stock release and stock could not be re-reserved'), {
      action: 'orderPayments.recover.oversold', order_id: orderId, razorpay_payment_id: razorpayPaymentId, alert: true,
    })
    await logOrderEvent(orderId, 'paid_after_release_stock_unavailable', 'system', {
      razorpay_payment_id: razorpayPaymentId, note: 'Customer paid after the pending order expired and stock was released; stock could not be re-reserved. Fulfil from new stock or refund.',
    })
  }
  return { outcome: 'recovered', stockReReserved }
}

/** Audit-trail row in `payments` (unique on provider+reference, so replays are harmless). */
export async function recordCapturedPayment(
  db: Db,
  args: { orderId: string; razorpayPaymentId: string; amountInr: number; alertAction: string },
): Promise<void> {
  const { error } = await db
    .from('payments')
    .insert({
      order_id:          args.orderId,
      payment_provider:  'razorpay',
      payment_reference: args.razorpayPaymentId,
      amount:            args.amountInr,
      status:            'captured',
      paid_at:           new Date().toISOString(),
    })
    .select('id')
  if (error && !String(error.message).includes('duplicate')) {
    // Non-fatal: the order is already confirmed; surface so ops can backfill.
    captureError(new Error('payments insert failed: ' + error.message), {
      action: args.alertAction, order_id: args.orderId, razorpay_payment_id: args.razorpayPaymentId, alert: true,
    })
  }
}

export interface PaidOrderRow {
  id:                       string
  order_number:             string | null
  total_amount:             number
  customer_id:              string | number | null
  loyalty_points_redeemed?: number | null
}

/**
 * Side effects of a paid order: loyalty redeem/award, audit event, e-mail.
 * Call ONLY from the caller that won confirmOrderPayment (outcome confirmed/recovered).
 * `defer` runs the e-mail after the response is sent (Next's after()).
 */
export async function runPaidSideEffects(
  db: Db,
  args: {
    order:             PaidOrderRow
    razorpayOrderId:   string
    razorpayPaymentId: string
    settings:          Record<string, string>
    defer:             (fn: () => Promise<void>) => void
  },
): Promise<void> {
  const { order, razorpayOrderId, razorpayPaymentId, settings, defer } = args

  // Loyalty — points redeemed come from the DB row, never the client.
  const pointsRedeemed = Number(order.loyalty_points_redeemed ?? 0)
  const custId = order.customer_id
  if (custId) {
    if (pointsRedeemed > 0) {
      const redeemed = await redeemLoyaltyPoints(custId, order.id, pointsRedeemed)
      if (!redeemed) {
        logger.warn('loyalty: redemption skipped — insufficient balance', { order_id: order.id })
      }
    }
    await awardLoyaltyPoints(custId, order.id, order.total_amount ?? 0, settings, 'Earned from online payment')
  }

  await logOrderEvent(order.id, 'payment_verified', 'razorpay', {
    razorpay_payment_id: razorpayPaymentId, razorpay_order_id: razorpayOrderId,
  }).catch(() => null)

  // E-mail is deferred so it can never delay the response (see lib/server/email.ts).
  defer(async () => {
    try {
      const { data: customer } = await db
        .from('customers').select('first_name, email').eq('id', order.customer_id).single()

      if (customer?.email) {
        const coinsEarned = Math.floor(order.total_amount * parseFloat(settings.loyalty_points_per_rupee || '1'))
        const coinsHtml   = settings.loyalty_enabled !== 'false' && coinsEarned > 0
          ? `<div style="background:#fffbe8;border:1.5px solid #e8c940;border-radius:12px;padding:14px 20px;margin:16px 0;text-align:center">
               <span style="font-size:18px">🪙</span>
               <strong style="color:#7a5800;margin-left:6px">You earned ${coinsEarned} Pahadi Coins!</strong>
               <p style="margin:4px 0 0;color:#a08020;font-size:12px">Use them on your next order.</p>
             </div>`
          : ''

        // sendTransactionalEmail() checks the resolved Resend `error` explicitly and
        // dead-letters into `failed_emails` for the cron sweep to retry.
        await sendTransactionalEmail({
          type:    'payment_confirmation',
          to:      customer.email,
          subject: `Payment Confirmed #${order.order_number} — HimVeda by Pahadi Roots 🌿`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
              <div style="background:#2C4A2E;padding:24px;text-align:center">
                <h1 style="color:#fff;margin:0;font-size:22px">🌿 HimVeda by Pahadi Roots</h1>
                <p style="color:#a8d5b5;margin:4px 0 0">Himalayan Natural Store</p>
              </div>
              <div style="padding:24px">
                <h2 style="color:#2C4A2E">Payment Confirmed! ✅</h2>
                <p>Hi <strong>${esc(customer.first_name)}</strong>, your payment was successful.</p>
                <p><strong>Order #:</strong> ${esc(order.order_number)}<br>
                   <strong>Payment ID:</strong> ${esc(razorpayPaymentId)}<br>
                   <strong>Amount Paid:</strong> ₹${order.total_amount}<br>
                   <strong>Delivery:</strong> 3–5 business days</p>
                ${coinsHtml}
                <p style="color:#666;font-size:14px">We&apos;ll WhatsApp you tracking details once shipped.</p>
                <a href="https://www.pahadiroots.com/account?tab=orders" style="display:inline-block;background:#2C4A2E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:8px">Track Order</a>
              </div>
              <div style="background:#f9f9f9;padding:16px;text-align:center;font-size:12px;color:#999">
                HimVeda by Pahadi Roots | pahadiroots.com | WhatsApp: +91 98999 84895
              </div>
            </div>`,
          context: { order_id: order.id, order_number: order.order_number },
        })
      }
    } catch (e) {
      // Catches errors from BUILDING the e-mail; sendTransactionalEmail() itself never throws.
      logger.error('payments: email failed after payment confirmation', { action: 'payments.email', error: e instanceof Error ? e.message : String(e) })
    }
  })
}
