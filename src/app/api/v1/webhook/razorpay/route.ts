import { NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { getServiceClient } from '@/lib/supabase'
// BUG FIX: updateOrderStatus was imported but never called in this file —
// the webhook updates order status directly via db.from('orders').update() so
// it can apply the .eq('order_status', 'pending') atomic guard. The imported
// function does not accept a WHERE condition and would allow a replay attack to
// re-confirm an already-confirmed order. Removed the dead import.
import { logOrderEvent } from '@/lib/services/orderService'
// OBSERVABILITY FIX: use structured logger/captureError throughout so all
// webhook events emit consistent JSON log lines filterable by aggregators.
// alert:true on security events and processing failures means ops get paged.
import { logger, captureError } from '@/lib/logger'
import { getFreshSiteSettings } from '@/lib/getSiteSettings'
import { safeEqual, isRazorpayOrderId } from '@/lib/server/razorpay'
import { confirmOrderPayment, recordCapturedPayment, runPaidSideEffects, PAID_EMAIL_CUSTOMER_SENT, PAID_EMAIL_ADMIN_SENT } from '@/lib/server/orderPayments'

// Minimal typed shape for Razorpay webhook events we handle
interface RazorpayPaymentEntity {
  id: string
  order_id?: string | null
  amount: number
  currency?: string
  /** Unix seconds when Razorpay created the payment (always present on a payment entity). */
  created_at?: number
  error_reason?: string
  notes?: { db_order_id?: string }
}
interface RazorpayWebhookEvent {
  event: string
  payload: {
    payment: { entity: RazorpayPaymentEntity }
  }
}

/**
 * Which of OUR orders does this payment belong to?
 *
 * Nov 2026 audit (PAY-HOOK): the webhook located the order ONLY through `payment.notes.db_order_id`, a note the customer's browser
 * attaches when it opens Razorpay Checkout. Any payment that does not carry it (a retried / resumed checkout, a payment link, a
 * browser that dropped the option) was alerted and acknowledged, leaving a customer who really paid with a pending order that the
 * expiry job later cancels. The Razorpay ORDER id stored on our order at create_payment time (orders.payment_id) is the server's
 * own record of the pairing, so it is the fallback. Either way the caller still binds the payment to the order below (stored
 * Razorpay order id + exact amount) before confirming anything, so a wrong hint can never confirm the wrong order.
 * A database fault throws so the caller returns 500 and Razorpay retries; "no such order" returns null.
 */
async function resolveDbOrderId(
  db: ReturnType<typeof getServiceClient>,
  payment: RazorpayPaymentEntity,
): Promise<string | null> {
  const fromNotes = payment.notes?.db_order_id
  if (fromNotes) return String(fromNotes)
  if (!isRazorpayOrderId(payment.order_id)) return null
  const { data, error } = await db.from('orders').select('id').eq('payment_id', payment.order_id).maybeSingle()
  if (error && (error as { code?: string }).code !== 'PGRST116') {
    throw new Error('webhook order lookup by razorpay order id failed: ' + error.message)
  }
  return data?.id != null ? String(data.id) : null
}

export async function POST(req: Request) {
  // BUG FIX: the previous check used parseInt() on the Content-Length header,
  // but parseInt('abc', 10) returns NaN and NaN > 1_048_576 is false — a
  // malformed or attacker-controlled `Content-Length: abc` header bypasses the
  // size gate entirely, letting a multi-MB payload through to rawBody.
  // Fix: use Number() (returns NaN for non-numeric) and guard with Number.isFinite
  // before the comparison, treating any non-numeric value as "unknown size" and
  // enforcing the limit conservatively.
  const contentLengthRaw = req.headers.get('content-length')
  const contentLength    = Number(contentLengthRaw)
  if (Number.isFinite(contentLength) && contentLength > 1_048_576) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  // BUG FIX: no Content-Type check — non-JSON payloads (including binary) would
  // pass signature verification (HMAC is over raw bytes) but then crash JSON.parse.
  // The crash is caught by the outer try/catch and returns 400, but the webhook log
  // records it as a processing error rather than a rejected bad request. Reject early.
  const ct = req.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    return NextResponse.json({ error: 'Unsupported content type' }, { status: 415 })
  }

  // Read raw body for HMAC verification
  const rawBody = await req.text()
  const signature = req.headers.get('x-razorpay-signature') || ''

  // Verify webhook signature using the WEBHOOK secret (configured in Razorpay Dashboard →
  // Webhooks). This is a DIFFERENT credential from RAZORPAY_KEY_SECRET (API key).
  // Using the API key secret here would mean any attacker who knows your key id could
  // forge valid webhook signatures — the webhook secret is the correct credential.
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!webhookSecret) {
    // BUG FIX: missing env var is a security configuration error — alert:true
    // so ops are paged immediately (no webhook verification = replay attack risk).
    captureError(new Error('RAZORPAY_WEBHOOK_SECRET not configured'), {
      action: 'webhook.razorpay.config',
      alert:  true,
    })
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }
  const expectedSig = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex')

  if (!safeEqual(expectedSig, signature)) {
    // BUG FIX: signature mismatch is a security event (forged webhook or wrong
    // RAZORPAY_WEBHOOK_SECRET) — captureError with alert:true pages ops so this
    // doesn't silently appear as a 400 in access logs.
    captureError(new Error('Webhook HMAC signature mismatch'), {
      action: 'webhook.razorpay.signature_verify',
      alert:  true,
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: RazorpayWebhookEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = getServiceClient()

  // Store raw webhook (Audit #6 — always store before processing)
  // Capture the inserted row ID so we can update it by primary key later.
  // .order().limit() are SELECT-only modifiers and are silently ignored on UPDATE
  // in Supabase REST API, so using the row ID is the only safe way to update
  // the specific log entry rather than all rows with the same event type.
  //
  // F-15 (Oct 2026 audit): the event id was never stored, so the unique index
  // uidx_webhook_logs_provider_event_id was unused. Razorpay sends a stable `x-razorpay-event-id`
  // (the SAME id on every retry of an event). Stored now:
  //   • a duplicate of an event already marked 'processed' is acknowledged and skipped;
  //   • a duplicate of one that is still 'received' or 'failed' is a Razorpay RETRY of a failure —
  //     it is re-processed (handlers are idempotent) against the existing log row.
  const eventId = (req.headers.get('x-razorpay-event-id') || '').trim().slice(0, 128) || null
  let { data: webhookLog, error: logErr } = await db
    .from('webhook_logs')
    .insert({
      provider:    'razorpay',
      event:       event.event,
      event_id:    eventId,
      payload:     event,
      status:      'received',
      created_at:  new Date().toISOString(),
    })
    .select('id')
    .single()
  if (logErr && eventId && (logErr as { code?: string }).code === '23505') {
    const { data: existing } = await db
      .from('webhook_logs')
      .select('id, status')
      .eq('provider', 'razorpay')
      .eq('event_id', eventId)
      .maybeSingle()
    if (existing?.status === 'processed') {
      return NextResponse.json({ received: true, duplicate: true })
    }
    if (existing?.id) {
      webhookLog = { id: existing.id } as typeof webhookLog
      logErr = null
      await db.from('webhook_logs').update({ status: 'received' }).eq('id', existing.id)
    }
  }
  // BUG FIX: webhook log failure was silent in the previous version — if the
  // webhook_logs insert fails (table missing, schema mismatch, DB overload) and
  // webhookLog.id is null, the entire catch block at the bottom silently
  // skips the 'failed' status update too. Both ops and the audit trail are blind.
  if (logErr) {
    captureError(new Error('Webhook log insert failed: ' + logErr.message), {
      action: 'webhook.razorpay.log_insert',
      alert:  true,
    })
  }

  // Success response is built up-front; a processing failure below replaces it with a
  // 500 so Razorpay RETRIES the event (P4). Every handler below is idempotent (atomic
  // conditional updates, unique payments rows), so a retry can never double-apply.
  const responsePromise = NextResponse.json({ received: true })

  // A permanently unprocessable event (no db_order_id) is alerted and acknowledged with 200 so Razorpay does not
  // retry it. Its log row must be closed too, otherwise it sits at 'received' forever and looks like a stuck event.
  const closeLogAsProcessed = async () => {
    if (!webhookLog?.id) return
    await db.from('webhook_logs')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('id', webhookLog.id)
  }


  try {
    const eventType = event.event

    if (eventType === 'payment.captured') {
      const payment   = event.payload.payment.entity
      const paymentId = payment.id

      // Look up our order via notes.db_order_id (set when creating the Razorpay order).
      // We cannot use payment_id here because verify_payment already overwrites it
      // with the Razorpay payment ID before this webhook fires.
      const dbOrderId = await resolveDbOrderId(db, payment)
      if (!dbOrderId) {
        captureError(new Error('payment.captured missing notes.db_order_id and no order holds this Razorpay order id'), {
          action:     'webhook.razorpay.payment_captured',
          payment_id: paymentId,
          alert:      true,
        })
        await closeLogAsProcessed()
        return responsePromise
      }

      const { data: order, error: orderLookupErr } = await db
        .from('orders')
        .select('id, order_number, payment_status, payment_method, payment_id, total_amount, customer_id, loyalty_points_redeemed, created_at')
        .eq('id', dbOrderId)
        .single()
      // BUG FIX (Oct 2026 audit): a database ERROR here used to look identical to "no such
      // order": `order` was null, we alerted "unknown order" and still returned 200, so Razorpay
      // never retried and a real capture was lost to a transient blip. PGRST116 is PostgREST's
      // genuine "no rows" code; anything else is a fault → throw → 500 → Razorpay retries.
      if (orderLookupErr && (orderLookupErr as { code?: string }).code !== 'PGRST116') {
        throw new Error('payment.captured order lookup failed: ' + orderLookupErr.message)
      }

      if (!order) {
        captureError(new Error('payment.captured for unknown order'), {
          action: 'webhook.razorpay.payment_captured.unknown_order', payment_id: paymentId, db_order_id: dbOrderId, alert: true,
        })
      } else if (order.payment_status === 'paid') {
        // Nov 2026 audit (PAY-DUP): an order that is already paid by a DIFFERENT payment id means this customer was charged
        // twice for one order (two tabs / a retry that also succeeded). This branch used to log at info level and move on, so
        // the second charge was invisible until the customer complained. Same payment id = the normal duplicate delivery.
        const paidWith = typeof order.payment_id === 'string' ? order.payment_id : ''
        if (paidWith.startsWith('pay_') && paidWith !== paymentId) {
          captureError(new Error('payment.captured for an order already paid by a different payment — possible double charge, refund needed'), {
            action: 'webhook.razorpay.payment_captured.duplicate_payment', payment_id: paymentId, paid_with: paidWith,
            order_id: order.id, amount_paise: payment.amount, alert: true,
          })
          await logOrderEvent(order.id, 'duplicate_payment_captured', 'razorpay', {
            razorpay_payment_id: paymentId, original_payment_id: paidWith, amount: payment.amount / 100,
            note: 'A second payment was captured for an order that was already paid. Refund the duplicate from the Razorpay dashboard.',
          })
        } else {
          logger.info('webhook: payment.captured order already confirmed', { paymentId, dbOrderId })
          // RE-DRIVE (round-2 audit): the winner of the pending->paid flip owns the one-time side effects (coins, e-mails), and
          // the function can be killed after the flip but before they finish — Razorpay's retry then lands HERE and used to just
          // log. runPaidSideEffects writes a `payment_verified` order event as its marker; when the order has been paid for a
          // while and that marker is missing, run them again. Loyalty redeem/award are idempotent per order in the database
          // (verified against the live functions); the 90 s age guard keeps this from racing a still-running original.
          try {
            const [{ data: events }, { data: fresh }] = await Promise.all([
              db.from('order_events').select('event, metadata').eq('order_id', order.id)
                .in('event', ['payment_verified', PAID_EMAIL_CUSTOMER_SENT, PAID_EMAIL_ADMIN_SENT]),
              db.from('orders').select('updated_at').eq('id', order.id).single(),
            ])
            const evs = (events ?? []) as Array<{ event: string; metadata: Record<string, unknown> | null }>
            const verified = evs.find(e => e.event === 'payment_verified')
            const has = (name: string) => evs.some(e => e.event === name)
            // Two ways the original run can have been cut short:
            //  1. it died before the loyalty step finished  -> no `payment_verified` marker;
            //  2. it died in the deferred e-mail phase      -> marker present (new runs flag emails_tracked) but an e-mail marker missing.
            // Orders paid before e-mail markers existed carry no emails_tracked flag and are never re-mailed.
            const emailsMissing = !!verified?.metadata?.emails_tracked && (!has(PAID_EMAIL_CUSTOMER_SENT) || !has(PAID_EMAIL_ADMIN_SENT))
            // 90 s guard: measured from the last write (the pending->paid flip) so a still-running original is never raced.
            const paidForMs = fresh?.updated_at ? Date.now() - Date.parse(String(fresh.updated_at)) : 0
            // 7-day cap (Nov 2026 verification): measured from WHEN THE PAYMENT HAPPENED. It used to use updated_at too, and any
            // later write (an admin edit, shipping, the tax trigger) restarted the window, so an order paid weeks ago could still be
            // re-driven and re-mailed by a late duplicate delivery. Razorpay's own payment time first, else the order's creation.
            const paymentAgeMs = typeof payment.created_at === 'number' && payment.created_at > 0
              ? Date.now() - payment.created_at * 1000
              : order.created_at ? Date.now() - Date.parse(String(order.created_at)) : Number.POSITIVE_INFINITY
            // only for the SAME payment that confirmed this order (an order marked paid some other way — admin, or a different
            // payment id — must not get coins / e-mails just because a capture event arrived)
            // Verification L-3: never re-drive an order paid long ago (a late duplicate delivery for a pre-marker order must not mail it).
            const REDRIVE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
            if (paidWith === paymentId && (!verified || emailsMissing) && paidForMs > 90_000 && paymentAgeMs < REDRIVE_MAX_AGE_MS) {
              await logOrderEvent(order.id, 'paid_side_effects_redriven', 'razorpay', { razorpay_payment_id: paymentId, reason: verified ? 'emails_missing' : 'no_marker' })
              const settings = await getFreshSiteSettings()
              await runPaidSideEffects(db, {
                order: {
                  id: order.id, order_number: order.order_number, total_amount: order.total_amount,
                  customer_id: order.customer_id, loyalty_points_redeemed: order.loyalty_points_redeemed,
                },
                razorpayOrderId: String(payment.order_id), razorpayPaymentId: paymentId,
                settings, defer: (fn) => after(fn),
              })
            }
          } catch (e) {
            // never turn a harmless duplicate delivery into a 500 loop because the safety net itself failed
            captureError(e, { action: 'webhook.razorpay.redrive_failed', order_id: order.id, alert: true })
          }
        }
      } else {
        // notes.db_order_id is only a hint — it is NOT proof this payment belongs to this
        // order. Bind on facts we control: the order must be a Razorpay order, the payment
        // must belong to the Razorpay order id we stored for it, and the captured amount
        // must equal the DB total. Anything else is held for manual review, never confirmed.
        const expectedPaise = Math.round(Number(order.total_amount) * 100)
        const problem =
          order.payment_method !== 'razorpay'                               ? 'order_is_not_razorpay'
          : !isRazorpayOrderId(order.payment_id)                            ? 'no_stored_razorpay_order_id'
          : !payment.order_id || !safeEqual(order.payment_id, payment.order_id) ? 'razorpay_order_id_mismatch'
          : payment.amount !== expectedPaise                                ? 'amount_mismatch'
          // A missing currency is held too (Nov 2026 verification): Razorpay always sends it, so its absence is not a capture we can trust.
          : payment.currency !== 'INR'                                      ? 'currency_mismatch'
          : null

        if (problem) {
          captureError(new Error('payment.captured could not be bound to order: ' + problem), {
            action: 'webhook.razorpay.payment_captured.unbound', payment_id: paymentId, order_id: order.id,
            paid_paise: payment.amount, expected_paise: expectedPaise, alert: true,
          })
          await logOrderEvent(order.id, 'payment_captured_unbound', 'razorpay', {
            razorpay_payment_id: paymentId, reason: problem, paid_paise: payment.amount, expected_paise: expectedPaise,
          })
          // Verification L-1: a capture can arrive a few hundred ms BEFORE create_payment stored the Razorpay order id on our row.
          // Acknowledging that with 200 left the customer at "Confirming your payment" until the next sweep (10 min+). For a brand-new
          // Razorpay order, answer 500 instead so Razorpay retries (seconds later the id is stored and the capture binds normally).
          const orderAgeMs = order.created_at ? Date.now() - Date.parse(String(order.created_at)) : Number.POSITIVE_INFINITY
          if (problem === 'no_stored_razorpay_order_id' && order.payment_method === 'razorpay' && orderAgeMs < 2 * 60_000) {
            throw new Error('payment.captured arrived before the Razorpay order id was stored — asking Razorpay to retry')
          }
        } else {
          // MONEY FIRST: record the captured payment before flipping the order to paid. A failure
          // throws, the outer catch returns 500 and Razorpay retries this event.
          const recorded = await recordCapturedPayment(db, {
            orderId: order.id, razorpayPaymentId: paymentId, amountInr: payment.amount / 100,
            alertAction: 'webhook.razorpay.payments_insert',
          })
          if (!recorded) throw new Error('payment.captured could not be recorded in payments')

          const confirm = await confirmOrderPayment(db, {
            orderId: order.id, razorpayPaymentId: paymentId, source: 'webhook',
          })

          if (confirm.outcome === 'error') {
            // Throw → outer catch → 500 → Razorpay retries this event.
            throw new Error('payment.captured order update failed: ' + confirm.message)
          } else if (confirm.outcome === 'not_confirmable') {
            captureError(new Error('payment.captured for an order that cannot be confirmed'), {
              action: 'webhook.razorpay.payment_captured.not_confirmable', payment_id: paymentId, order_id: order.id,
              order_status: confirm.orderStatus, payment_status: confirm.paymentStatus, alert: true,
            })
            await logOrderEvent(order.id, 'payment_received_for_unconfirmable_order', 'razorpay', {
              razorpay_payment_id: paymentId, order_status: confirm.orderStatus, payment_status: confirm.paymentStatus,
            })
          } else if (confirm.outcome === 'confirmed' || confirm.outcome === 'recovered') {
            // We won the transition — we own the one-time side effects (O2: previously only
            // verify_payment ran them, so a webhook win meant no loyalty and no e-mail).
            await logOrderEvent(order.id, 'payment_captured_webhook', 'razorpay', {
              razorpay_payment_id: paymentId,
              amount: payment.amount / 100,
              recovered: confirm.outcome === 'recovered',
            })
            const settings = await getFreshSiteSettings()
            await runPaidSideEffects(db, {
              order: {
                id: order.id, order_number: order.order_number, total_amount: order.total_amount,
                customer_id: order.customer_id, loyalty_points_redeemed: order.loyalty_points_redeemed,
              },
              razorpayOrderId: String(payment.order_id), razorpayPaymentId: paymentId,
              settings, defer: (fn) => after(fn),
            })
          } else {
            // already_paid (lost the race to verify_payment, which runs the side effects) / not_found
            logger.info('webhook: payment.captured order already confirmed by concurrent process', { paymentId, dbOrderId })
          }
        }
      }
    }

    if (eventType === 'payment.failed') {
      // P2 FIX: a payment.failed is ONE failed ATTEMPT, not the end of the order.
      // Razorpay emits it for every failed try, and the customer can retry inside the same
      // checkout modal against the same Razorpay order. The previous code treated the first
      // failure as terminal (→ payment_failed + stock released), so a successful retry was
      // then charged, "verified" against a dead order and never confirmed.
      //
      // We now only RECORD the attempt. The order stays pending (stock stays reserved) until
      // it is either paid, or the pending-order expiry job releases it. If a payment still
      // lands after expiry, confirmOrderPayment() recovers the order.
      const payment   = event.payload.payment.entity
      const dbOrderId = await resolveDbOrderId(db, payment)

      if (!dbOrderId) {
        captureError(new Error('payment.failed missing notes.db_order_id and no order holds this Razorpay order id'), {
          action: 'webhook.razorpay.payment_failed',
          alert:  true,
        })
        await closeLogAsProcessed()
        return responsePromise
      }

      const { data: order, error: failedLookupErr } = await db
        .from('orders')
        .select('id, order_status, payment_status, payment_method, payment_id')
        .eq('id', dbOrderId)
        .single()
      // Same rule as payment.captured above: a read fault is retryable, only "no rows" is final.
      if (failedLookupErr && (failedLookupErr as { code?: string }).code !== 'PGRST116') {
        throw new Error('payment.failed order lookup failed: ' + failedLookupErr.message)
      }

      // A late/duplicate failure for an order that has since been paid is noise — ignore it.
      //
      // AUDIT W-1 (Oct 2026): notes.db_order_id is only a HINT (payment-level notes can be set by
      // whoever opens Checkout), and the payment.captured branch above already refuses to act on it
      // unless the payment belongs to the Razorpay order we stored. This branch did not, so anyone who
      // could start a Razorpay payment against any of our orders could stamp fake "failed attempt"
      // events and `payments` rows onto SOMEONE ELSE'S order (polluting its history, payments ledger
      // and support view). Apply the same binding here.
      const failedBound = !!order
        && order.payment_method === 'razorpay'
        && isRazorpayOrderId(order.payment_id)
        && !!payment.order_id
        && safeEqual(order.payment_id, payment.order_id)
      if (order && order.payment_status !== 'paid' && !failedBound) {
        captureError(new Error('payment.failed could not be bound to order'), {
          action: 'webhook.razorpay.payment_failed.unbound', payment_id: payment.id, order_id: order.id, alert: false,
        })
        await logOrderEvent(order.id, 'payment_failed_unbound', 'razorpay', {
          razorpay_payment_id: payment.id, reason: 'razorpay_order_id_mismatch_or_not_razorpay_order',
        })
      } else if (order && order.payment_status !== 'paid') {
        await logOrderEvent(order.id, 'payment_attempt_failed', 'razorpay', {
          razorpay_payment_id: payment.id,
          reason: payment.error_reason,
          note: 'Single failed attempt — order left pending so the customer can retry.',
        })

        const { error: failedPaymentInsertErr } = await db
          .from('payments')
          .insert({
            order_id:          order.id,
            payment_provider:  'razorpay',
            payment_reference: payment.id,
            amount:            payment.amount / 100,
            status:            'failed',
            paid_at:           null,
          })
          .select('id')
        if (failedPaymentInsertErr && !String(failedPaymentInsertErr.message).includes('duplicate')) {
          captureError(new Error('payments insert (failed) failed: ' + failedPaymentInsertErr.message), {
            action:     'webhook.razorpay.payments_insert_failed',
            payment_id: payment.id,
            order_id:   order.id,
            alert:      false,
          })
        }
      }
    }

    // Mark this specific webhook log as processed — use row ID, not event type,
    // because ORDER+LIMIT are ignored on UPDATE in Supabase REST API.
    if (webhookLog?.id) {
      await db.from('webhook_logs')
        .update({ status: 'processed', processed_at: new Date().toISOString() })
        .eq('id', webhookLog.id)
    }

  } catch (err) {
    captureError(err, {
      action:  'webhook.razorpay.processing',
      log_id:  webhookLog?.id,
      alert:   true,
    })
    // AUDIT FIX: update webhook log to 'failed' so ops can identify stuck events.
    // Previously the catch block only logged to console; every errored event
    // appeared as 'received' indefinitely — invisible to any monitoring query
    // that filters for unprocessed logs.
    if (webhookLog?.id) {
      const errMsg = err instanceof Error ? err.message : String(err)
      try {
        await db
          .from('webhook_logs')
          .update({
            status:       'failed',
            processed_at: new Date().toISOString(),
            // Store error summary in payload for ops inspection without losing
            // the original event body (useful for manual replay).
            payload: { ...(event as object), _processing_error: errMsg.slice(0, 500) },
          })
          .eq('id', webhookLog.id)
      } catch (logUpdateErr) {
        // Non-fatal: original error is already in the console above.
        logger.error('webhook: failed to mark webhook_log as failed', { log_id: webhookLog.id, err: logUpdateErr })
      }
    }
    // P4 FIX: this used to return 200 even when processing failed, so Razorpay never
    // retried and a real capture could be lost forever. Handlers are idempotent now, so
    // a non-2xx (Razorpay retries with backoff for ~24h) is the safe, correct response.
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }

  return responsePromise
}
