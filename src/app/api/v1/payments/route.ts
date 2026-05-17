import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createOrderSchema } from '@/lib/schemas'
import { createOrder, logOrderEvent } from '@/lib/services/orderService'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { getServiceClient } from '@/lib/supabase'

// ─── Razorpay helper ─────────────────────────────────────────────────────────
// Proper server-side Razorpay order creation as recommended by Razorpay docs
// https://razorpay.com/docs/payments/server-integration/nodejs/payment-gateway/build-integration/
async function createRazorpayOrder(amountPaise: number, receiptId: string, dbOrderId: string) {
  const keyId     = process.env.RAZORPAY_KEY_ID?.trim()
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim()

  if (!keyId || !keySecret) {
    throw new Error('Razorpay keys not configured — add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel env vars')
  }

  // Razorpay requires Basic Auth: base64(key_id:key_secret)
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64')

  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Basic ${credentials}`,
    },
    body: JSON.stringify({
      amount:   amountPaise,          // must be integer paise (e.g. 39800 for ₹398)
      currency: 'INR',
      receipt:  receiptId.slice(0, 40), // max 40 chars
      notes:    { db_order_id: String(dbOrderId) },
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { description: res.statusText } }))
    const desc = err?.error?.description || JSON.stringify(err)
    console.error('[payments] Razorpay order creation failed:', desc, '| key prefix:', keyId.slice(0, 14))
    throw new Error(`Razorpay order creation failed: ${desc}`)
  }

  return res.json() // { id, amount, currency, receipt, ... }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body   = await req.json()
    const action = body.action as string

    // ── ACTION 1: Initiate payment ──────────────────────────────────────────
    // Flow: validate → create DB order → create Razorpay order → return to client
    if (action === 'create_payment') {
      const parsed = createOrderSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
      }

      const settings = await getSiteSettings()
      const pd = parsed.data

      // 1. Create order in our DB (stock check, price recalculation, idempotency)
      const { order, alreadyExists } = await createOrder({
        customerName:   pd.address.name,
        customerPhone:  pd.address.phone,
        customerEmail:  pd.customer_email || undefined,
        flat:           pd.address.flat,
        area:           pd.address.area || '',
        city:           pd.address.city,
        state:          pd.address.state,
        pincode:        pd.address.pincode,
        label:          pd.address.label,
        items:          pd.items.map(i => ({
          ...i,
          productId: String(i.productId),
          variantId: String(i.variantId),
        })),
        paymentMethod:  'razorpay',
        couponCode:     pd.coupon_code,
        idempotencyKey: pd.idempotency_key,
      }, settings)

      // Amount in paise — must be a whole number (Razorpay requirement)
      const amountPaise = Math.round(order.total_amount * 100)
      console.log(`[payments] DB order ${order.id} created, amount=₹${order.total_amount} (${amountPaise} paise), alreadyExists=${alreadyExists}`)

      // 2. Create Razorpay order server-side (tamper-proof amount, enables HMAC verification)
      const receiptId   = order.order_number || `ORD-${order.id}`
      const rzpOrder    = await createRazorpayOrder(amountPaise, receiptId, order.id)

      // 3. Save Razorpay order ID to our DB (needed for webhook reconciliation)
      const db = getServiceClient()
      await db.from('orders').update({ payment_id: rzpOrder.id }).eq('id', order.id)

      console.log(`[payments] Razorpay order created: ${rzpOrder.id} for DB order ${order.id}`)

      // 4. Return to client — client will open Razorpay checkout with these values
      return NextResponse.json({
        success:           true,
        order_id:          String(order.id),       // our DB order id
        razorpay_order_id: rzpOrder.id,            // rzp_live_xxx — goes into Razorpay options.order_id
        amount:            rzpOrder.amount,         // paise (from Razorpay, authoritative)
        currency:          rzpOrder.currency,
      })
    }

    // ── ACTION 2: Verify payment after Razorpay success callback ────────────
    // Flow: HMAC verify → update DB order → return order_number to client
    if (action === 'verify_payment') {
      const {
        razorpay_order_id,    // from Razorpay response
        razorpay_payment_id,  // from Razorpay response
        razorpay_signature,   // from Razorpay response
        order_id,             // our DB order id
      } = body

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !order_id) {
        return NextResponse.json({ error: 'Missing required payment verification fields' }, { status: 400 })
      }

      // 1. Verify HMAC signature — Razorpay standard: sha256(order_id + "|" + payment_id)
      const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim()
      if (!keySecret) {
        throw new Error('RAZORPAY_KEY_SECRET not configured')
      }

      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex')

      if (expectedSignature !== razorpay_signature) {
        console.error('[payments] HMAC signature mismatch — possible tampered request', { order_id, razorpay_payment_id })
        await logOrderEvent(order_id, 'payment_signature_mismatch', 'system', {
          razorpay_order_id,
          razorpay_payment_id,
        }).catch(() => null)
        return NextResponse.json({ error: 'Payment verification failed — signature mismatch' }, { status: 400 })
      }

      // 2. Mark order as paid in DB
      const db = getServiceClient()
      const { error: updateErr } = await db.from('orders').update({
        order_status:   'confirmed',
        payment_status: 'paid',
        payment_id:     razorpay_payment_id,
      }).eq('id', order_id)

      if (updateErr) {
        console.error('[payments] order update failed after verified payment:', updateErr.message)
        // Don't throw — payment IS verified, just log and continue
      }

      // 3. Fetch order number for redirect
      const { data: updatedOrder } = await db
        .from('orders')
        .select('order_number')
        .eq('id', order_id)
        .single()

      await logOrderEvent(order_id, 'payment_verified', 'razorpay', {
        razorpay_payment_id,
        razorpay_order_id,
      }).catch(() => null)

      console.log(`[payments] payment verified ✓ order=${order_id} payment=${razorpay_payment_id}`)

      return NextResponse.json({
        success:      true,
        order_number: updatedOrder?.order_number || order_id,
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  } catch (err: any) {
    console.error('[payments POST] Error:', err.message)
    return NextResponse.json({ error: err.message || 'Payment error' }, { status: 500 })
  }
}
