import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createOrderSchema } from '@/lib/schemas'
import { createOrder, logOrderEvent } from '@/lib/services/orderService'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { getServiceClient } from '@/lib/supabase'
import { checkCsrf } from '@/lib/api/serverUtils'
// ── Security: server-only imports (build-time guard against client-bundle leaks) ──
import { awardLoyaltyPoints, redeemLoyaltyPoints } from '@/lib/server/loyalty'
import { esc } from '@/lib/server/htmlEscape'

// ── Distributed rate limiter (Upstash KV) ────────────────────────────────────
// SEC-1 FIX: the previous checkRateLimit() call used an in-process Map that is
// NOT shared across Vercel instances. On a multi-replica deployment an attacker
// could make 10 payment attempts per instance per minute (10 × N replicas).
// This function uses the same Upstash KV pipeline as middleware.ts and
// coupons/route.ts — the counter is global and consistent across all replicas.
//
// Falls back to allowing the request (fail-open) if Upstash is unreachable so
// legitimate users aren't blocked by an infra outage.
async function checkPaymentRateLimit(ip: string): Promise<boolean> {
  const kvUrl   = process.env.UPSTASH_REDIS_REST_URL
  const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!kvUrl || !kvToken) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[payments] Upstash KV not configured — route-level rate limit disabled. ' +
        'Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for cross-replica enforcement.'
      )
    }
    return true // fail-open: middleware general API limit still applies
  }

  try {
    const rlKey = `mw:rl:payments_ip:${ip}`
    const res = await fetch(`${kvUrl}/pipeline`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR',   rlKey],
        ['EXPIRE', rlKey, 60, 'NX'], // 60-second window; NX = only set expiry on first write
      ]),
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return true // KV unhealthy — fail-open
    const result = await res.json() as [[string, number], [string, number]]
    const count  = result[0][1]
    return count <= 10 // allow up to 10 payment attempts per IP per minute
  } catch {
    return true // network error / timeout — fail-open
  }
}

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

// ─── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // ── CSRF check ─────────────────────────────────────────────────────────────
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  // ── IP-level rate limit — covers both actions (distributed via Upstash KV) ──
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!await checkPaymentRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests — please wait a moment' }, { status: 429 })
  }

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

      const db = getServiceClient()

      // Bug-fix: when alreadyExists=true (idempotency retry), we must NOT create a
      // new Razorpay order. The original call already created one and stored its ID in
      // orders.payment_id. Creating a second Razorpay order for the same DB order means:
      //   1. Two separate Razorpay charge flows exist for one DB order.
      //   2. If the user completes the first payment before the retry fires, the second
      //      Razorpay order is a duplicate charge opportunity.
      //   3. The update `payment_id = rzpOrder.id` overwrites the first Razorpay order ID,
      //      breaking the webhook's `notes.db_order_id` lookup for the original order.
      //
      // Fix: for retried requests, fetch the existing Razorpay order ID from the DB and
      // return it directly. Razorpay orders are single-use — the client resumes the same
      // checkout session rather than opening a new one.
      if (alreadyExists) {
        const { data: existingRow } = await db
          .from('orders')
          .select('payment_id, total_amount')
          .eq('id', order.id)
          .single()

        if (!existingRow?.payment_id) {
          // No prior Razorpay order exists for this DB order — this can happen if the
          // original create_payment call failed after createOrder() but before the
          // Razorpay API call. Fall through to create a fresh Razorpay order below.
          // (Same code path as a new order — intentional fall-through via goto-equivalent)
        } else {
          // Reuse the existing Razorpay order ID so the client can resume payment.
          return NextResponse.json({
            success:           true,
            order_id:          String(order.id),
            razorpay_order_id: existingRow.payment_id,
            // Razorpay orders store amount in paise — return the DB total converted.
            // We don't re-fetch from Razorpay because the DB total IS authoritative
            // (it was set server-side by the original createOrder() call).
            amount:            Math.round((existingRow.total_amount ?? order.total_amount) * 100),
            currency:          'INR',
            customer_id:       null,
            loyalty_points_redeemed: pd.loyalty_points_redeemed ?? 0,
          })
        }
      }

      // ── Amount integrity: use the DB-computed total, never the client value ──
      // createOrder() computed total_amount server-side from live DB prices.
      // We convert that authoritative value to paise for Razorpay.
      const amountPaise = Math.round(order.total_amount * 100)

      const receiptId = order.order_number || `ORD-${order.id}`
      const rzpOrder  = await createRazorpayOrder(amountPaise, receiptId, order.id)

      await db.from('orders').update({ payment_id: rzpOrder.id }).eq('id', order.id)

      return NextResponse.json({
        success:           true,
        order_id:          String(order.id),
        razorpay_order_id: rzpOrder.id,
        amount:            rzpOrder.amount,   // authoritative paise value from Razorpay
        currency:          rzpOrder.currency,
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
      } = body

      // P2 SECURITY FIX: loyalty_points_redeemed is now read from the DB orders row,
      // not from the client body. createOrder() stores the validated amount at order
      // creation time (after balance check), so by verify_payment time the correct
      // value is authoritative in the DB — no client manipulation is possible.
      // The client-supplied value is ignored entirely here.

      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !order_id) {
        return NextResponse.json({ error: 'Missing required payment verification fields' }, { status: 400 })
      }

      // 1. Verify HMAC signature — this is the primary integrity check.
      //    If this passes, we know Razorpay generated the callback and the
      //    payment genuinely succeeded for the razorpay_order_id we created.
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
      // loyalty_points_redeemed is now read from the DB (stored by createOrder),
      // not from the client body — this is the P2 security fix.
      const { data: fullOrder } = await db
        .from('orders')
        .select('id, order_number, total_amount, customer_id, loyalty_points_redeemed')
        .eq('id', order_id)
        .single()

      // Read the DB-authoritative loyalty redemption value
      const loyalty_points_redeemed = Number(fullOrder?.loyalty_points_redeemed ?? 0)

      // 4. Site settings — fetched ONCE and reused for loyalty award + email.
      //    Previously called twice (once in loyalty block, once in email block).
      const settings = await getSiteSettings()

      // 5. ── Loyalty: redeem then award ────────────────────────────────────
      const custId = fullOrder?.customer_id
      if (custId) {
        if (loyalty_points_redeemed > 0) {
          const redeemed = await redeemLoyaltyPoints(custId, order_id, loyalty_points_redeemed)
          if (!redeemed) {
            console.warn(`[loyalty] Redemption skipped for order ${order_id} — insufficient balance`)
          }
        }
        await awardLoyaltyPoints(custId, order_id, fullOrder?.total_amount ?? 0, settings, 'Earned from online payment')
      }

      // 6. Fetch updated order number for redirect
      const { data: updatedOrder } = await db
        .from('orders').select('order_number').eq('id', order_id).single()

      await logOrderEvent(order_id, 'payment_verified', 'razorpay', {
        razorpay_payment_id, razorpay_order_id,
      }).catch(() => null)

      // 7. Confirmation email
      try {
        const { data: customer } = await db
          .from('customers').select('first_name, email').eq('id', fullOrder?.customer_id).single()

        if (customer?.email && fullOrder) {
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
                  <p>Hi <strong>${esc(customer.first_name)}</strong>, your payment was successful.</p>
                  <p><strong>Order #:</strong> ${esc(fullOrder.order_number)}<br>
                     <strong>Payment ID:</strong> ${esc(razorpay_payment_id)}<br>
                     <strong>Amount Paid:</strong> ₹${fullOrder.total_amount}<br>
                     <strong>Delivery:</strong> 3–5 business days</p>
                  ${coinsHtml}
                  <p style="color:#666;font-size:14px">We&apos;ll WhatsApp you tracking details once shipped.</p>
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
    const internalMessage = err instanceof Error ? err.message : 'Payment error'
    console.error('[payments POST] Error:', internalMessage)
    // Never leak Razorpay / Supabase internals to the client in production
    const clientMessage = process.env.NODE_ENV === 'production'
      ? 'Payment processing failed. Please try again or contact support.'
      : internalMessage
    return NextResponse.json({ error: clientMessage }, { status: 500 })
  }
}
