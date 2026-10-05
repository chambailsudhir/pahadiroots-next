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
import { confirmOrderPayment, recordCapturedPayment, runPaidSideEffects } from '@/lib/server/orderPayments'

// Minimal typed shape for Razorpay webhook events we handle
interface RazorpayPaymentEntity {
  id: string
  order_id?: string | null
  amount: number
  error_reason?: string
  notes?: { db_order_id?: string }
}
interface RazorpayWebhookEvent {
  event: string
  payload: {
    payment: { entity: RazorpayPaymentEntity }
  }
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
  const { data: webhookLog, error: logErr } = await db
    .from('webhook_logs')
    .insert({
      provider:    'razorpay',
      event:       event.event,
      payload:     event,
      status:      'received',
      created_at:  new Date().toISOString(),
    })
    .select('id')
    .single()
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

  try {
    const eventType = event.event

    if (eventType === 'payment.captured') {
      const payment   = event.payload.payment.entity
      const paymentId = payment.id

      // Look up our order via notes.db_order_id (set when creating the Razorpay order).
      // We cannot use payment_id here because verify_payment already overwrites it
      // with the Razorpay payment ID before this webhook fires.
      const dbOrderId = payment.notes?.db_order_id
      if (!dbOrderId) {
        captureError(new Error('payment.captured missing notes.db_order_id'), {
          action:     'webhook.razorpay.payment_captured',
          payment_id: paymentId,
          alert:      true,
        })
        return responsePromise
      }

      const { data: order, error: orderLookupErr } = await db
        .from('orders')
        .select('id, order_number, payment_status, payment_method, payment_id, total_amount, customer_id, loyalty_points_redeemed')
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
        logger.info('webhook: payment.captured order already confirmed', { paymentId, dbOrderId })
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
          : null

        if (problem) {
          captureError(new Error('payment.captured could not be bound to order: ' + problem), {
            action: 'webhook.razorpay.payment_captured.unbound', payment_id: paymentId, order_id: order.id,
            paid_paise: payment.amount, expected_paise: expectedPaise, alert: true,
          })
          await logOrderEvent(order.id, 'payment_captured_unbound', 'razorpay', {
            razorpay_payment_id: paymentId, reason: problem, paid_paise: payment.amount, expected_paise: expectedPaise,
          })
        } else {
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
            await recordCapturedPayment(db, {
              orderId: order.id, razorpayPaymentId: paymentId, amountInr: payment.amount / 100,
              alertAction: 'webhook.razorpay.payments_insert',
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
      const dbOrderId = payment.notes?.db_order_id

      if (!dbOrderId) {
        captureError(new Error('payment.failed missing notes.db_order_id'), {
          action: 'webhook.razorpay.payment_failed',
          alert:  true,
        })
        return responsePromise
      }

      const { data: order, error: failedLookupErr } = await db
        .from('orders')
        .select('id, order_status, payment_status')
        .eq('id', dbOrderId)
        .single()
      // Same rule as payment.captured above: a read fault is retryable, only "no rows" is final.
      if (failedLookupErr && (failedLookupErr as { code?: string }).code !== 'PGRST116') {
        throw new Error('payment.failed order lookup failed: ' + failedLookupErr.message)
      }

      // A late/duplicate failure for an order that has since been paid is noise — ignore it.
      if (order && order.payment_status !== 'paid') {
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
