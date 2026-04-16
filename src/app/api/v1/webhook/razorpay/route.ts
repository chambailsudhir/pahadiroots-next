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
  }).catch(e => console.error('[webhook] Log failed:', e))

  // Return 200 IMMEDIATELY — process async (Audit #6)
  // Using a background-style approach (Vercel doesn't support true async after response,
  // so we process synchronously but return 200 regardless of outcome)
  const responsePromise = NextResponse.json({ received: true })

  try {
    const eventType = event.event

    if (eventType === 'payment.captured') {
      const payment    = event.payload.payment.entity
      const rzpOrderId = payment.order_id
      const paymentId  = payment.id

      // Find our order by razorpay_order_id
      const { data: order } = await db
        .from('orders')
        .select('id, status, order_number')
        .eq('razorpay_order_id', rzpOrderId)
        .single()

      if (order && order.status === 'pending_payment') {
        await db.from('orders').update({
          status:              'paid',
          payment_status:      'paid',
          razorpay_payment_id: paymentId,
          updated_at:          new Date().toISOString(),
        }).eq('id', order.id)

        await logOrderEvent(order.id, 'payment_captured_webhook', 'razorpay', {
          razorpay_payment_id: paymentId,
          amount: payment.amount / 100,
        })
      }
    }

    if (eventType === 'payment.failed') {
      const payment    = event.payload.payment.entity
      const rzpOrderId = payment.order_id

      const { data: order } = await db
        .from('orders')
        .select('id, status')
        .eq('razorpay_order_id', rzpOrderId)
        .single()

      if (order && order.status === 'pending_payment') {
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
