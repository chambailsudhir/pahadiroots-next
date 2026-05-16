import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createOrderSchema, verifyPaymentSchema } from '@/lib/schemas'
import { createOrder, updateOrderStatus, logOrderEvent } from '@/lib/services/orderService'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { getServiceClient } from '@/lib/supabase'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Razorpay timeout after ${ms}ms`)), ms)
    ),
  ])
}

export async function POST(req: Request) {
  try {
    const body   = await req.json()
    const action = body.action as string

    // ─── Create Razorpay order ─────────────────────────────────────────────
    if (action === 'create_payment') {
      const parsed = createOrderSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
      }

      const settings = await getSiteSettings()

      // Create order in our DB first (idempotency, stock check, price recalc)
      const pd = parsed.data
      const { order } = await createOrder({
        customerName:   pd.address.name,
        customerPhone:  pd.address.phone,
        customerEmail:  pd.customer_email || undefined,
        flat:           pd.address.flat,
        area:           pd.address.area || '',
        city:           pd.address.city,
        state:          pd.address.state,
        pincode:        pd.address.pincode,
        label:          pd.address.label,
        items:          pd.items.map(i => ({ ...i, productId: String(i.productId), variantId: String(i.variantId) })),
        paymentMethod:  'razorpay',
        couponCode:     pd.coupon_code,
        idempotencyKey: pd.idempotency_key,
      }, settings)

      // Create Razorpay order
      const rzpRes = await withTimeout(
        fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${Buffer.from(
              `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
            ).toString('base64')}`,
          },
          body: JSON.stringify({
            amount:   order.total * 100,   // paise
            currency: 'INR',
            receipt:  order.order_number,
            notes:    { order_id: order.id },
          }),
        }),
        8000  // 8s timeout (Audit #B10)
      )

      if (!rzpRes.ok) {
        const err = await rzpRes.json()
        throw new Error('Razorpay order creation failed: ' + JSON.stringify(err))
      }

      const rzpOrder = await rzpRes.json()

      // Save razorpay_order_id to our DB
      const db = getServiceClient()
      await db
        .from('orders')
        .update({ payment_id: rzpOrder.id, order_status: 'pending_payment' })
        .eq('id', order.id)

      return NextResponse.json({
        success:          true,
        order_id:         order.id,
        razorpay_order_id: rzpOrder.id,
        amount:           rzpOrder.amount,
      })
    }

    // ─── Verify payment ───────────────────────────────────────────────────
    if (action === 'verify_payment') {
      const parsed = verifyPaymentSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
      }

      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = parsed.data

      // Verify HMAC signature (Audit #6)
      const expectedSig = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex')

      if (expectedSig !== razorpay_signature) {
        await logOrderEvent(order_id, 'payment_signature_mismatch', 'system', {
          razorpay_order_id,
          razorpay_payment_id,
        })
        return NextResponse.json({ error: 'Payment verification failed' }, { status: 400 })
      }

      // Update order to paid
      const db = getServiceClient()
      await db.from('orders').update({
        order_status:        'paid',
        payment_status:      'paid',
        payment_id:          razorpay_payment_id,
        updated_at:          new Date().toISOString(),
      }).eq('id', order_id)

      const { data: order } = await db
        .from('orders')
        .select('order_number')
        .eq('id', order_id)
        .single()

      await logOrderEvent(order_id, 'payment_verified', 'razorpay', {
        razorpay_payment_id,
        razorpay_order_id,
      })

      return NextResponse.json({
        success:      true,
        order_number: order?.order_number,
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  } catch (err: any) {
    console.error('[payments POST]', err)
    return NextResponse.json({ error: err.message || 'Payment error' }, { status: 500 })
  }
}

