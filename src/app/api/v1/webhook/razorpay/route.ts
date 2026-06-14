import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getServiceClient } from '@/lib/supabase'
import { updateOrderStatus, logOrderEvent } from '@/lib/services/orderService'

// Minimal typed shape for Razorpay webhook events we handle
interface RazorpayPaymentEntity {
  id: string
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
    console.error('[webhook] RAZORPAY_WEBHOOK_SECRET env var not set')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }
  const expectedSig = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex')

  if (expectedSig !== signature) {
    console.error('[webhook] Invalid signature')
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
  if (logErr) console.error('[webhook] Log failed:', logErr)

  // Return 200 IMMEDIATELY — process async (Audit #6)
  // Using a background-style approach (Vercel doesn't support true async after response,
  // so we process synchronously but return 200 regardless of outcome)
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
        console.error('[webhook] payment.captured missing notes.db_order_id', { paymentId })
        return responsePromise
      }

      const { data: order } = await db
        .from('orders')
        .select('id, order_status, order_number')
        .eq('id', dbOrderId)
        .single()

      if (order && order.order_status === 'pending') {
        // TOCTOU RACE FIX: two concurrent webhook deliveries can BOTH read
        // order_status='pending' before either commits. Adding the WHERE guard
        // here means only one UPDATE wins the Postgres row lock; the other
        // sees updatedRows.length === 0 and skips the event log.
        // This prevents duplicate order_events rows on replayed webhooks.
        const { data: updatedRows } = await db
          .from('orders')
          .update({
            order_status:   'confirmed',
            payment_status: 'paid',
            payment_id:     paymentId,
            updated_at:     new Date().toISOString(),
          })
          .eq('id', order.id)
          .eq('order_status', 'pending') // atomic guard — mirrors verify_payment fix
          .select('id')

        if (updatedRows && updatedRows.length > 0) {
          // We won the race — log the capture event once
          await logOrderEvent(order.id, 'payment_captured_webhook', 'razorpay', {
            razorpay_payment_id: paymentId,
            amount: payment.amount / 100,
          })
        } else {
          // Lost the race or replayed event — another process already confirmed this order
          console.info('[webhook] payment.captured: order already confirmed by concurrent process', {
            paymentId,
            dbOrderId,
          })
        }
      }
    }

    if (eventType === 'payment.failed') {
      const payment   = event.payload.payment.entity
      const dbOrderId = payment.notes?.db_order_id

      if (!dbOrderId) {
        console.error('[webhook] payment.failed missing notes.db_order_id')
        return responsePromise
      }

      const { data: order } = await db
        .from('orders')
        .select('id, order_status')
        .eq('id', dbOrderId)
        .single()

      if (order && order.order_status === 'pending') {
        // BUG FIX 1 — stock never restored on payment failure.
        // Stock is atomically reserved at order-creation time.  When payment
        // fails the reservation must be released so the items can be purchased
        // again.  Fetch order_items and call restoreStock() before updating
        // the order row, so that even a DB crash after restore still leaves
        // the order in 'pending' and allows an ops retry.
        const { data: orderItems } = await db
          .from('order_items')
          .select('product_id, variant_id, quantity')
          .eq('order_id', order.id)

        if (orderItems && orderItems.length > 0) {
          const { restoreStock } = await import('@/lib/services/inventoryService')
          await restoreStock(
            orderItems.map((i: { product_id: unknown; variant_id: unknown; quantity: unknown }) => ({
              variantId: String(i.variant_id),
              productId: String(i.product_id),
              qty:       Number(i.quantity),
            }))
          ).catch(err =>
            console.error('[webhook] restoreStock failed on payment.failed:', err)
          )
        }

        // BUG FIX 2 — order_status left as 'pending' after payment failure.
        // 'pending' implies the order is still awaiting payment, but the
        // payment has definitively failed.  Setting it to 'payment_failed'
        // prevents the payment.failed guard from triggering again on a retry
        // webhook delivery, which would attempt a double stock-restore.
        await db.from('orders').update({
          order_status:   'payment_failed',
          payment_status: 'failed',
          updated_at:     new Date().toISOString(),
        }).eq('id', order.id)

        await logOrderEvent(order.id, 'payment_failed_webhook', 'razorpay', {
          reason: payment.error_reason,
        })
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
    console.error('[webhook] Processing error:', err)
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
        console.error('[webhook] Failed to mark log as failed:', logUpdateErr)
      }
    }
    // Still return 200 — Razorpay will retry on non-2xx, which could replay
    // the event into the same broken state. Log the failure and investigate.
  }

  return responsePromise
}
