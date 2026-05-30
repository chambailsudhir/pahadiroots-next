import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createOrderSchema } from '@/lib/schemas'
import { createOrder, logOrderEvent } from '@/lib/services/orderService'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { getServiceClient } from '@/lib/supabase'

// ─── Razorpay helper ───────────────────────────────────────────────────────────
async function createRazorpayOrder(amountPaise: number, receiptId: string, dbOrderId: string) {
  const keyId     = process.env.RAZORPAY_KEY_ID?.trim()
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim()
  if (!keyId || !keySecret) {
    throw new Error('Razorpay keys not configured — add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Vercel env vars')
  }
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64')
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${credentials}` },
    body: JSON.stringify({
      amount:   amountPaise,
      currency: 'INR',
      receipt:  receiptId.slice(0, 40),
      notes:    { db_order_id: String(dbOrderId) },
    }),
  })
  if (!res.ok) {
    const err  = await res.json().catch(() => ({ error: { description: res.statusText } }))
    const desc = err?.error?.description || JSON.stringify(err)
    throw new Error(`Razorpay order creation failed: ${desc}`)
  }
  return res.json()
}

// ─── Loyalty helpers ──────────────────────────────────────────────────────────
async function callLoyaltyRpc(rpc: string, params: Record<string, unknown>) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: {
      apikey:         SERVICE_KEY,
      Authorization:  `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })
}

async function redeemLoyaltyPoints(customerId: string | number, orderId: string | number, points: number): Promise<boolean> {
  if (!points || points <= 0) return true
  try {
    const res    = await callLoyaltyRpc('redeem_loyalty_points', {
      p_customer_id: String(customerId), p_order_id: String(orderId), p_points: points,
      p_note: 'Redeemed at checkout',
    })
    const result = await res.json()
    return res.ok && (result === true || result?.result === true)
  } catch { return false }
}

async function awardLoyaltyPoints(
  customerId: string | number, orderId: string | number,
  orderTotal: number, settings: Record<string, string>,
): Promise<void> {
  if (settings.loyalty_enabled === 'false') return
  const rate    = parseFloat(settings.loyalty_points_per_rupee || '1')
  const pts     = Math.floor(orderTotal * rate)
  if (pts <= 0) return
  try {
    await callLoyaltyRpc('award_loyalty_points', {
      p_customer_id: String(customerId), p_order_id: String(orderId),
      p_points: pts, p_note: 'Earned from online payment',
    })
  } catch (e) { console.error('[loyalty] award failed:', e) }
}

// ─── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body   = await req.json()
    const action = body.action as string

    // ── ACTION 1: Initiate payment ─────────────────────────────────────────
    if (action === 'create_payment') {
      const parsed = createOrderSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
      }

      const settings = await getSiteSettings()
      const pd       = parsed.data

      const { order, alreadyExists, customerId } = await createOrder({
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
        // ── Loyalty ──────────────────────────────────────────────────────
        loyaltyPointsRedeemed: pd.loyalty_points_redeemed ?? 0,
      }, settings)

      const amountPaise = Math.round(order.total_amount * 100)

      const receiptId = order.order_number || `ORD-${order.id}`
      const rzpOrder  = await createRazorpayOrder(amountPaise, receiptId, order.id)

      const db = getServiceClient()
      await db.from('orders').update({ payment_id: rzpOrder.id }).eq('id', order.id)

      return NextResponse.json({
        success:           true,
        order_id:          String(order.id),
        razorpay_order_id: rzpOrder.id,
        amount:            rzpOrder.amount,
        currency:          rzpOrder.currency,
        // Pass back for use in verify_payment step
        customer_id:       customerId ?? null,
        loyalty_points_redeemed: pd.loyalty_points_redeemed ?? 0,
      })
    }

    // ── ACTION 2: Verify payment after Razorpay success callback ─────────
    if (action === 'verify_payment') {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        order_id,
        // ── Loyalty — passed back from checkout (originally from create_payment) ──
        loyalty_points_redeemed = 0,
      } = body

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !order_id) {
        return NextResponse.json({ error: 'Missing required payment verification fields' }, { status: 400 })
      }

      // 1. Verify HMAC signature
      const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim()
      if (!keySecret) throw new Error('RAZORPAY_KEY_SECRET not configured')

      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex')

      if (expectedSignature !== razorpay_signature) {
        console.error('[payments] HMAC signature mismatch', { order_id, razorpay_payment_id })
        await logOrderEvent(order_id, 'payment_signature_mismatch', 'system', {
          razorpay_order_id, razorpay_payment_id,
        }).catch(() => null)
        return NextResponse.json({ error: 'Payment verification failed — signature mismatch' }, { status: 400 })
      }

      // 2. Mark order as paid
      const db = getServiceClient()
      const { error: updateErr } = await db.from('orders').update({
        order_status:   'confirmed',
        payment_status: 'paid',
        payment_id:     razorpay_payment_id,
      }).eq('id', order_id)

      if (updateErr) console.error('[payments] order update failed after verified payment:', updateErr.message)

      // 3. Fetch order + customer for loyalty & email
      const { data: fullOrder } = await db
        .from('orders')
        .select('id, order_number, total_amount, customer_id')
        .eq('id', order_id)
        .single()

      // 4. ── Loyalty: redeem then award ────────────────────────────────────
      const custId = fullOrder?.customer_id
      if (custId) {
        // Deduct redeemed points (validate atomically — if insufficient, silently skip)
        if (loyalty_points_redeemed > 0) {
          const redeemed = await redeemLoyaltyPoints(custId, order_id, loyalty_points_redeemed)
          if (!redeemed) {
            console.warn(`[loyalty] Redemption skipped for order ${order_id} — insufficient balance`)
          }
        }
        // Award new points for completing a paid order
        const settings = await getSiteSettings()
        await awardLoyaltyPoints(custId, order_id, fullOrder?.total_amount ?? 0, settings)
      }

      // 5. Fetch updated order number for redirect
      const { data: updatedOrder } = await db
        .from('orders').select('order_number').eq('id', order_id).single()

      await logOrderEvent(order_id, 'payment_verified', 'razorpay', {
        razorpay_payment_id, razorpay_order_id,
      }).catch(() => null)

      // 6. Confirmation email
      try {
        const { data: customer } = await db
          .from('customers').select('first_name, email').eq('id', fullOrder?.customer_id).single()

        if (customer?.email && fullOrder) {
          const settings = await getSiteSettings()
          const coinsEarned = Math.floor(fullOrder.total_amount * parseFloat(settings.loyalty_points_per_rupee || '1'))
          const coinsHtml   = settings.loyalty_enabled !== 'false' && coinsEarned > 0
            ? `<div style="background:#fffbe8;border:1.5px solid #e8c940;border-radius:12px;padding:14px 20px;margin:16px 0;text-align:center">
                 <span style="font-size:18px">🪙</span>
                 <strong style="color:#7a5800;margin-left:6px">You earned ${coinsEarned} Pahadi Coins!</strong>
                 <p style="margin:4px 0 0;color:#a08020;font-size:12px">Use them on your next order.</p>
               </div>`
            : ''

          const { Resend } = await import('resend')
          const resend = new Resend(process.env.RESEND_API_KEY)
          await resend.emails.send({
            from:    'Pahadi Roots <noreply@pahadiroots.com>',
            to:      [customer.email],
            subject: `Payment Confirmed #${fullOrder.order_number} — Pahadi Roots 🌿`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
                <div style="background:#2C4A2E;padding:24px;text-align:center">
                  <h1 style="color:#fff;margin:0;font-size:22px">🌿 Pahadi Roots</h1>
                  <p style="color:#a8d5b5;margin:4px 0 0">Himalayan Natural Store</p>
                </div>
                <div style="padding:24px">
                  <h2 style="color:#2C4A2E">Payment Confirmed! ✅</h2>
                  <p>Hi <strong>${customer.first_name}</strong>, your payment was successful.</p>
                  <p><strong>Order #:</strong> ${fullOrder.order_number}<br>
                     <strong>Payment ID:</strong> ${razorpay_payment_id}<br>
                     <strong>Amount Paid:</strong> ₹${fullOrder.total_amount}<br>
                     <strong>Delivery:</strong> 3–5 business days</p>
                  ${coinsHtml}
                  <p style="color:#666;font-size:14px">We'll WhatsApp you tracking details once shipped.</p>
                  <a href="https://pahadiroots.com/account?tab=orders" style="display:inline-block;background:#2C4A2E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:8px">Track Order</a>
                </div>
                <div style="background:#f9f9f9;padding:16px;text-align:center;font-size:12px;color:#999">
                  Pahadi Roots | pahadiroots.com | WhatsApp: +91 98999 84895
                </div>
              </div>`,
          }).catch(() => null)
        }
      } catch (e) { console.error('[payments] Email failed:', e) }

      return NextResponse.json({
        success:      true,
        order_number: updatedOrder?.order_number || order_id,
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Payment error'
    console.error('[payments POST] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
