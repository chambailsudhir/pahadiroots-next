import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getServiceClient } from '@/lib/supabase'
import { updateOrderStatus, logOrderEvent } from '@/lib/services/orderService'

export async function POST(req: Request) {
  // Read raw body for HMAC verification
  const rawBody = await req.text()
  const signature = req.headers.get('x-razorpay-signature') || ''

  // Verify webhook signature (Audit #6)
  const expectedSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(rawBody)
    .digest('hex')

  if (expectedSig !== signature) {
    console.error('[webhook] Invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = getServiceClient()

  // Store raw webhook (Audit #6 — always store before processing)
  await db.from('webhook_logs').insert({
    provider:    'razorpay',
    event:       event.event,
    payload:     event,
    status:      'received',
    created_at:  new Date().toISOString(),
  }).then(res => { if (res.error) console.error('[webhook] Log failed:', res.error) })

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

      if (order && (order as any).order_status === 'pending') {
        await db.from('orders').update({
          order_status:   'confirmed',
          payment_status: 'paid',
          payment_id:     paymentId,
          updated_at:     new Date().toISOString(),
        }).eq('id', order.id)

        await logOrderEvent(order.id, 'payment_captured_webhook', 'razorpay', {
          razorpay_payment_id: paymentId,
          amount: payment.amount / 100,
        })
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

      if (order && (order as any).order_status === 'pending') {
        await db.from('orders').update({
          payment_status: 'failed',
          updated_at:     new Date().toISOString(),
        }).eq('id', order.id)

        await logOrderEvent(order.id, 'payment_failed_webhook', 'razorpay', {
          reason: payment.error_reason,
        })
      }
    }

    // Update webhook log to processed
    await db.from('webhook_logs')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('event', event.event)
      .order('created_at', { ascending: false })
      .limit(1)

  } catch (err) {
    console.error('[webhook] Processing error:', err)
    // Still return 200 — Razorpay will retry on non-2xx
  }

  return responsePromise
}
