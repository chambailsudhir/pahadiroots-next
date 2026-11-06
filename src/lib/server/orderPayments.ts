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
import { redeemLoyaltyPoints } from '@/lib/server/loyalty'
import { coinsForOrderValue } from '@/lib/loyaltyCoins'
import { buildOrderEmail, orderEmailSubject } from '@/lib/server/orderEmail'
import { adminNotifyAddress } from '@/lib/server/adminNotify'
import { loadAdminOrderEmail } from '@/lib/server/adminOrderEmail'
import { esc } from '@/lib/server/htmlEscape'
import { computeOrderInvoice } from '@/lib/invoiceGst'
import { sendTransactionalEmail } from '@/lib/server/email'
import { logger, captureError } from '@/lib/logger'
import { DELIVERY_WINDOWS_TEXT, TRACKING_NOTIFICATION_TEXT } from '@/lib/shippingCopy'
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

/**
 * Persist the Razorpay order id on OUR order, and refuse to continue if that fails.
 *
 * BUG FIX (Oct 2026 audit): create_payment ran this UPDATE without looking at the result.
 * supabase-js never throws on a failed write, it resolves with `{ error }`, so a failure was
 * invisible. The customer was then handed a payable Razorpay order that our database did not
 * know about, and the whole safety design failed closed against them:
 *   • verify_payment rejects an order whose stored payment_id is not an `order_…` id,
 *   • the payment.captured webhook holds it as "unbound" for manual review,
 *   • and the expiry sweep treats a null payment_id as "nothing was ever paid" and RELEASES it.
 * Net effect: money taken, order dead. (verify_payment's comment claimed the webhook would
 * recover it; the webhook deliberately does not.)
 *
 * Fix the root cause instead: retry once, then fail BEFORE the customer can pay. The order
 * stays pending with its stock reserved; the customer's retry reuses the same idempotency key
 * (alreadyExists path) and a fresh Razorpay order is created and stored then. An orphan
 * Razorpay order that nobody pays costs nothing.
 */
export async function storeRazorpayOrderId(db: Db, orderId: string, razorpayOrderId: string): Promise<void> {
  let lastMessage = 'unknown error'
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { error } = await db.from('orders').update({ payment_id: razorpayOrderId }).eq('id', orderId)
      if (!error) return
      lastMessage = error.message
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : String(e)
    }
  }
  captureError(new Error('Could not store the Razorpay order id on the order: ' + lastMessage), {
    action: 'payments.create.store_payment_id', order_id: orderId, razorpay_order_id: razorpayOrderId, alert: true,
  })
  // Deliberately free of the keywords the route treats as customer facing (stock, coupon, …):
  // this is an internal fault, shown as the generic payment error in production.
  throw new Error('We could not start your payment. Please try again.')
}

/** Audit-trail row in `payments` (unique on provider+reference, so replays are harmless). */
export async function recordCapturedPayment(
  db: Db,
  args: { orderId: string; razorpayPaymentId: string; amountInr: number; alertAction: string },
): Promise<boolean> {
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
    // MONEY FIRST (Oct 2026 audit): callers record the captured payment BEFORE flipping the order
    // to paid, and stop when this returns false, so a paid order can never exist without its
    // payment row. A duplicate (same provider + reference) means it is already recorded: success.
    captureError(new Error('payments insert failed: ' + error.message), {
      action: args.alertAction, order_id: args.orderId, razorpay_payment_id: args.razorpayPaymentId, alert: true,
    })
    return false
  }
  return true
}

export interface PaidOrderRow {
  id:                       string
  order_number:             string | null
  total_amount:             number
  customer_id:              string | number | null
  loyalty_points_redeemed?: number | null
}

// ── Idempotent one-time e-mails ───────────────────────────────────────────────────────────────────────────────────────────────
// The e-mails run in the deferred (after()) phase, which can be killed after the order was flipped to paid. Each e-mail therefore has its OWN
// order event, written only AFTER it was handed to Resend (sent, or queued in failed_emails for the retry sweep). A re-drive (see the Razorpay
// webhook) re-runs only what has no marker, so nothing is lost when the function dies and nothing is sent twice.
export const PAID_EMAIL_CUSTOMER_SENT = 'paid_email_customer_sent'
export const PAID_EMAIL_ADMIN_SENT    = 'paid_email_admin_sent'

async function hasOrderEvent(db: Db, orderId: string, event: string): Promise<boolean> {
  try {
    const { data } = await db.from('order_events').select('id').eq('order_id', orderId).eq('event', event).limit(1)
    return Array.isArray(data) && data.length > 0
  } catch { return false }   // cannot tell -> treat as not sent (a duplicate is better than a lost confirmation)
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
        // F-06: the discount was already granted at order creation. createOrder now excludes points
        // held by other unpaid orders, so this only happens on a sub-second race — but when it does
        // it is money given away, so it is an ALERT with the order event as the audit trail.
        captureError(new Error('Loyalty redemption failed after payment — discount granted without deduction'), {
          action: 'orderPayments.loyalty_redeem_failed', order_id: order.id, points: pointsRedeemed, alert: true,
        })
        await logOrderEvent(order.id, 'loyalty_redeem_failed', 'system', { points: pointsRedeemed }).catch(() => null)
      }
    }
    // No coins at payment: they are paid when the order is DELIVERED (database trigger) and taken back on return / refund.
  }

  // Tell the shop owner about an ONLINE-paid order too (COD orders already notify from /api/v1/orders; paid ones sent nothing).
  const adminTo = adminNotifyAddress(settings)
  if (adminTo) {
    defer(async () => {
      try {
        if (await hasOrderEvent(db, order.id, PAID_EMAIL_ADMIN_SENT)) return
        const built = await loadAdminOrderEmail(db, order.id, { kind: 'paid' }).catch(() => null)
        const r = await sendTransactionalEmail({
          type:    'admin_order_notify',
          to:      adminTo,
          subject: built?.subject ?? `New PAID Order #${order.order_number} - Rs.${order.total_amount}`,
          html:    built?.html ?? `<p>Order: <b>#${esc(order.order_number ?? '')}</b><br>Total: Rs.${esc(order.total_amount)}<br>Payment: Razorpay (paid) ${esc(razorpayPaymentId)}</p>`,
          context: { order_id: order.id, order_number: order.order_number },
        })
        // Marker only once Resend has it (sent, or dead-lettered for the retry sweep) — never before.
        if (r?.sent || r?.deadLettered) await logOrderEvent(order.id, PAID_EMAIL_ADMIN_SENT, 'system', {}).catch(e => captureError(e, { action: 'payments.email.marker_write_failed', order_id: order.id, marker: PAID_EMAIL_ADMIN_SENT, alert: true }))
      } catch (e) {
        logger.error('payments: admin notification failed', { action: 'payments.email.admin', error: e instanceof Error ? e.message : String(e) })
      }
    })
  } else {
    // No owner address configured: nothing to send, so record it (a re-drive must not wait for an e-mail that will never exist) —
    // and ALERT (verification L-4): a blank setting plus a missing ADMIN_EMAIL env used to be silent, which is exactly how the owner
    // once went weeks without a single new-order mail.
    captureError(new Error('No owner notification address: set site_settings.admin_notify_email or the ADMIN_EMAIL env var'), {
      action: 'payments.email.admin.no_recipient', order_id: order.id, alert: true,
    })
    defer(async () => { if (!(await hasOrderEvent(db, order.id, PAID_EMAIL_ADMIN_SENT))) await logOrderEvent(order.id, PAID_EMAIL_ADMIN_SENT, 'system', { skipped: 'no_recipient' }).catch(() => null) })
  }

  // Marker for "loyalty done". `emails_tracked` says the per-e-mail markers above exist for this order, so a re-drive knows it can rely on them
  // (orders paid before that was introduced have no e-mail markers and must not be re-mailed). Written once, even on a re-drive.
  if (!(await hasOrderEvent(db, order.id, 'payment_verified'))) {
    await logOrderEvent(order.id, 'payment_verified', 'razorpay', {
      razorpay_payment_id: razorpayPaymentId, razorpay_order_id: razorpayOrderId, emails_tracked: true,
    }).catch(() => null)
  }

  // E-mail is deferred so it can never delay the response (see lib/server/email.ts).
  defer(async () => {
    try {
      if (await hasOrderEvent(db, order.id, PAID_EMAIL_CUSTOMER_SENT)) return
      // An account holder has auth_user_id (there is no is_guest column on customers).
      const { data: customer } = await db.from('customers').select('first_name, email, auth_user_id').eq('id', order.customer_id).single()
      const hasAccount = customer?.auth_user_id != null

      // The order's own record of where its e-mails go is read first-class below; customers.email can be NULL for a guest whose address
      // already belongs to an account.
      const { data: full0 } = await db.from('orders').select('shipping_address').eq('id', order.id).single()
      const sa0 = (typeof full0?.shipping_address === 'string' ? (() => { try { return JSON.parse(full0.shipping_address) } catch { return null } })() : full0?.shipping_address) as Record<string, string> | null
      // The address typed FOR THIS ORDER wins. A guest whose phone/e-mail collided with an existing account has the order attached to
      // that account's row, and mailing that row's stored address would send this order's items, name and address to someone else.
      const toEmail = (sa0?.email || customer?.email || '').trim()

      if (toEmail.includes('@')) {
        // The same itemised e-mail COD customers get (lib/server/orderEmail.ts), built from the stored order.
        const { data: full } = await db
          .from('orders')
          .select('order_number, created_at, subtotal, coupon_discount, shipping_charge, cod_surcharge, tax, cgst, sgst, igst, total_amount, loyalty_points_redeemed, shipping_address, order_items(quantity, price_at_time, product_name_snapshot, variant_value_snapshot, products(name, image_url, emoji, hsn_code))')
          .eq('id', order.id)
          .single()
        type Row = { quantity: number; price_at_time: number; product_name_snapshot: string | null; variant_value_snapshot: string | null; products?: { name?: string; image_url?: string | null; emoji?: string | null } | null }
        const rows = ((full?.order_items ?? []) as Row[])
        const sa = (typeof full?.shipping_address === 'string' ? (() => { try { return JSON.parse(full.shipping_address) } catch { return null } })() : full?.shipping_address) as Record<string, string> | null
        const inv = computeOrderInvoice({
          items: rows.map(r => ({ name: r.product_name_snapshot || r.products?.name || 'Product', qty: r.quantity, price: r.price_at_time })),
          total_amount: Number(full?.total_amount ?? order.total_amount) || 0,
          subtotal: full?.subtotal != null ? Number(full.subtotal) : null,
          coupon_discount: full?.coupon_discount != null ? Number(full.coupon_discount) : null,
          shipping_charge: full?.shipping_charge != null ? Number(full.shipping_charge) : null,
          cod_surcharge: full?.cod_surcharge != null ? Number(full.cod_surcharge) : null,
          tax: full?.tax != null ? Number(full.tax) : null,
          loyalty_points_redeemed: full?.loyalty_points_redeemed != null ? Number(full.loyalty_points_redeemed) : null,
          state: sa?.state ?? null,
        }, { loyaltyPointValue: parseFloat(settings.loyalty_points_value || '') || null })

        // Coins are for account holders only: mention them ONLY when we positively know this is not a guest row.
        const coinsEarned = hasAccount && settings.loyalty_enabled !== 'false'
          ? coinsForOrderValue(order.total_amount ?? 0, settings)   // announced as "up to", paid on delivery
          : 0

        // sendTransactionalEmail() checks the resolved Resend `error` explicitly and
        // dead-letters into `failed_emails` for the cron sweep to retry.
        const sentRes = await sendTransactionalEmail({
          type:    'payment_confirmation',
          to:      toEmail,
          subject: orderEmailSubject('paid', order.order_number ?? ''),
          html: buildOrderEmail({
            kind: 'paid',
            orderNumber: order.order_number ?? '',
            customerName: sa?.name || customer?.first_name || '',
            placedAt: full?.created_at ?? null,
            items: rows.map(r => ({ name: r.product_name_snapshot || r.products?.name || 'Product', variant: r.variant_value_snapshot, qty: r.quantity, price: r.price_at_time, image: r.products?.image_url ?? null, emoji: r.products?.emoji ?? null })),
            subtotal: inv.linesTotal + inv.roundOff,
            couponDiscount: inv.couponDiscount,
            prepaidDiscount: inv.discountSplitKnown ? inv.prepaidDiscount : inv.prepaidDiscount + inv.loyaltyDiscount,
            loyaltyDiscount: inv.discountSplitKnown ? inv.loyaltyDiscount : 0,
            shipping: inv.shipping,
            codSurcharge: inv.codSurcharge,
            gstIncluded: inv.tax,
            total: inv.total,
            address: { name: sa?.name, line1: sa?.address_line1, city: sa?.city, state: sa?.state, pincode: sa?.pincode, phone: sa?.phone },
            paymentId: razorpayPaymentId,
            deliveryText: DELIVERY_WINDOWS_TEXT,
            trackingText: TRACKING_NOTIFICATION_TEXT,
            coinsEarned,
            signedIn: hasAccount,
          }),
          context: { order_id: order.id, order_number: order.order_number },
        })
        // Verification L-5: a swallowed marker failure meant a later duplicate webhook would re-send this mail; now it is at least alerted.
        if (sentRes?.sent || sentRes?.deadLettered) await logOrderEvent(order.id, PAID_EMAIL_CUSTOMER_SENT, 'system', {}).catch(e => captureError(e, { action: 'payments.email.marker_write_failed', order_id: order.id, marker: PAID_EMAIL_CUSTOMER_SENT, alert: true }))
      } else {
        // Nobody to mail: record that, so a re-drive does not keep trying.
        await logOrderEvent(order.id, PAID_EMAIL_CUSTOMER_SENT, 'system', { skipped: 'no_recipient' }).catch(() => null)
      }
    } catch (e) {
      // Catches errors from BUILDING the e-mail; sendTransactionalEmail() itself never throws.
      logger.error('payments: email failed after payment confirmation', { action: 'payments.email', error: e instanceof Error ? e.message : String(e) })
    }
  })
}
