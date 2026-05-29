import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createOrder } from '@/lib/services/orderService'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { getServiceClient } from '@/lib/supabase'
import { Resend } from 'resend'

// Lightweight server-side sanitizer
function sanitize(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim()
}

// Input schema — loyalty_points_redeemed added
const orderSchema = z.object({
  address: z.object({
    name:    z.string().trim().min(2).max(100),
    phone:   z.string().trim().regex(/^[6-9]\d{9}$/, 'Invalid mobile number'),
    flat:    z.string().trim().min(1).max(200),
    area:    z.string().trim().max(200).optional().default(''),
    city:    z.string().trim().min(2).max(100),
    state:   z.string().trim().min(2).max(100),
    pincode: z.string().trim().regex(/^\d{6}$/, 'Invalid pincode'),
    label:   z.enum(['Home', 'Office', 'Parents', 'Friends', 'Others']).optional(),
  }),
  customer_email:          z.string().email().optional().or(z.literal('')),
  items:                   z.array(z.object({ productId: z.string().min(1), variantId: z.string().min(1), qty: z.number().int().min(1).max(50) })).min(1).max(30),
  payment_method:          z.enum(['razorpay', 'cod']),
  coupon_code:             z.string().trim().max(50).optional(),
  idempotency_key:         z.string().uuid(),
  // ── Loyalty ─────────────────────────────────────────────────────────────
  loyalty_points_redeemed: z.number().int().min(0).max(100_000).optional().default(0),
})

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms))])
}

function getDeliveryEstimate(): string {
  const d = new Date()
  let added = 0
  while (added < 5) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) added++
  }
  const from = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
  d.setDate(d.getDate() + 2)
  const to = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
  return `${from} - ${to}`
}

// ─── Award loyalty points after confirmed COD order ───────────────────────────
async function awardLoyaltyPoints(
  customerId: string | number,
  orderId:    string | number,
  orderTotal: number,
  settings:   Record<string, string>,
): Promise<void> {
  if (settings.loyalty_enabled === 'false') return
  const rate         = parseFloat(settings.loyalty_points_per_rupee || '1')
  const pointsEarned = Math.floor(orderTotal * rate)
  if (pointsEarned <= 0) return

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/award_loyalty_points`, {
      method: 'POST',
      headers: {
        apikey:         SERVICE_KEY,
        Authorization:  `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_customer_id: String(customerId),   // UUID — must be string, not Number()
        p_order_id:    String(orderId),       // UUID — must be string, not Number()
        p_points:      pointsEarned,
        p_note:        'Earned from COD order',
      }),
    })
  } catch (e) {
    console.error('[loyalty] award points failed:', e)
  }
}

// ─── Redeem loyalty points atomically (BEFORE order is confirmed) ─────────────
async function redeemLoyaltyPoints(
  customerId: string | number,
  orderId:    string | number,
  points:     number,
): Promise<boolean> {
  if (!points || points <= 0) return true

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/redeem_loyalty_points`, {
    method: 'POST',
    headers: {
      apikey:         SERVICE_KEY,
      Authorization:  `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_customer_id: String(customerId),   // UUID — must be string, not Number()
      p_order_id:    String(orderId),       // UUID — must be string, not Number()
      p_points:      points,
      p_note:        'Redeemed at checkout',
    }),
  })

  if (!res.ok) return false
  const result = await res.json()
  return result === true || result?.result === true
}

export async function POST(req: Request) {
  try {
    const body   = await req.json()
    const parsed = orderSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const d = parsed.data
    const a = d.address

    const name = sanitize(a.name)
    const flat = sanitize(a.flat)
    const area = sanitize(a.area || '')

    const settings = await getSiteSettings()

    const { order, alreadyExists, customerId } = await createOrder({
      customerName:   name,
      customerPhone:  a.phone,
      customerEmail:  d.customer_email || undefined,
      flat, area,
      city:    a.city,
      state:   a.state,
      pincode: a.pincode,
      label:   a.label,
      items:          d.items,
      paymentMethod:  d.payment_method,
      couponCode:     d.coupon_code,
      idempotencyKey: d.idempotency_key,
      // ── Loyalty ─────────────────────────────────────────────────────────
      loyaltyPointsRedeemed: d.loyalty_points_redeemed ?? 0,
    }, settings)

    // ── Loyalty redemption (COD only — Razorpay handled at verify_payment) ──
    // For COD orders, the order is immediately confirmed so we:
    //  1. Atomically deduct redeemed points from the customer's balance
    //  2. Award new points for completing the order
    if (!alreadyExists && d.payment_method === 'cod') {
      const cid = customerId ?? (order as any).customer_id
      if (cid) {
        // 1. Deduct redeemed points
        if ((d.loyalty_points_redeemed ?? 0) > 0) {
          await redeemLoyaltyPoints(cid, order.id, d.loyalty_points_redeemed!)
        }
        // 2. Award earned points
        await awardLoyaltyPoints(cid, order.id, order.total_amount, settings)
      }
    }

    // ── Confirmation email ─────────────────────────────────────────────────
    const customerEmail = d.customer_email?.trim()
    if (settings.order_email_enabled !== 'false' && customerEmail && !alreadyExists) {
      try {
        const resend     = new Resend(process.env.RESEND_API_KEY)
        const emailItems = order.cartItems ?? []
        const payLabel   = d.payment_method === 'cod' ? '💵 Cash on Delivery' : '💳 Paid Online'
        const estDate    = getDeliveryEstimate()
        const coinsEarned = Math.floor(order.total_amount * parseFloat(settings.loyalty_points_per_rupee || '1'))

        const itemsHtml = emailItems.map(i =>
          `<tr>
            <td style="padding:10px 0;border-bottom:1px solid #f0f0f0">
              <span style="font-size:16px">${i.emoji || '🌿'}</span>
              <strong style="color:#1a1a1a;margin-left:8px">${i.name}</strong>
              <span style="color:#888;font-size:13px"> × ${i.qty}</span>
            </td>
            <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:#1a3a1e">
              ₹${(i.price * i.qty).toLocaleString('en-IN')}
            </td>
          </tr>`
        ).join('')

        const coinsHtml = settings.loyalty_enabled !== 'false' && coinsEarned > 0
          ? `<div style="background:#fffbe8;border:1.5px solid #e8c940;border-radius:12px;padding:14px 20px;margin:16px 0;text-align:center">
               <span style="font-size:18px">🪙</span>
               <strong style="color:#7a5800;margin-left:6px">You earned ${coinsEarned} Pahadi Coins on this order!</strong>
               <p style="margin:4px 0 0;color:#a08020;font-size:12px">Use them for discounts on your next order.</p>
             </div>`
          : ''

        const emailHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f3ee;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:24px 16px">
  <div style="background:linear-gradient(135deg,#1a3a1e,#2d5233);border-radius:16px 16px 0 0;padding:28px 32px;text-align:center">
    <div style="font-size:32px;margin-bottom:6px">🌿</div>
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#fff;margin-bottom:3px">5 Pahadi Roots</div>
    <div style="font-size:11px;color:rgba(255,255,255,.6);letter-spacing:2px;text-transform:uppercase">Himalayan Natural Store</div>
  </div>
  <div style="background:#fff;padding:28px 32px;text-align:center;border-left:1px solid #eee;border-right:1px solid #eee">
    <div style="font-size:44px;margin-bottom:10px">✅</div>
    <h1 style="font-family:Georgia,serif;font-size:24px;color:#1a3a1e;margin:0 0 8px">Order Confirmed!</h1>
    <p style="color:#666;font-size:14px;margin:0 0 16px">Thank you ${name}! Your mountain goodness is on its way 🌿</p>
    <div style="display:inline-block;background:#f0f7f4;border:1.5px solid #c8e6c9;border-radius:20px;padding:8px 20px">
      <span style="font-size:13px;font-weight:700;color:#1a3a1e">📋 ${order.order_number}</span>
    </div>
    ${coinsHtml}
  </div>
  <div style="background:#fff9e6;border-left:4px solid #c8920a;padding:16px 32px;border-right:1px solid #eee">
    <strong style="color:#1a3a1e">🚚 Estimated Delivery: ${estDate}</strong><br>
    <span style="color:#888;font-size:12px">Pan India · We'll notify you when shipped</span>
  </div>
  <div style="background:#fff;padding:24px 32px;border-left:1px solid #eee;border-right:1px solid #eee">
    <p style="font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px">YOUR ITEMS</p>
    <table style="width:100%;border-collapse:collapse">${itemsHtml}</table>
    <table style="width:100%;border-collapse:collapse;margin-top:12px">
      <tr><td style="padding:6px 0;color:#555">Payment</td><td style="text-align:right;color:#555">${payLabel}</td></tr>
      <tr>
        <td style="padding:6px 0;font-size:17px;font-weight:900;color:#1a3a1e">Total</td>
        <td style="text-align:right;font-size:17px;font-weight:900;color:#1a3a1e">₹${order.total_amount.toLocaleString('en-IN')}</td>
      </tr>
    </table>
  </div>
  <div style="background:#f0f7f4;padding:16px 32px;border-left:1px solid #eee;border-right:1px solid #eee">
    <p style="margin:0;font-size:13px;color:#2d6a4f">
      📍 <strong>Delivering to:</strong> ${flat}${area ? ', ' + area : ''}, ${a.city}, ${a.state} - ${a.pincode}
    </p>
  </div>
  <div style="background:#1a3a1e;border-radius:0 0 16px 16px;padding:18px 32px;text-align:center">
    <div style="color:rgba(255,255,255,.5);font-size:12px;line-height:1.8">
      🌿 5 Pahadi Roots — Pure Himalayan Goodness<br>
      <a href="https://pahadiroots.com" style="color:#e8b84b;text-decoration:none">pahadiroots.com</a>
      &nbsp;·&nbsp;
      <a href="https://wa.me/919899984895" style="color:#e8b84b;text-decoration:none">WhatsApp Us</a>
    </div>
  </div>
</div>
</body></html>`

        await withTimeout(resend.emails.send({
          from:    'Pahadi Roots <noreply@pahadiroots.com>',
          to:      [customerEmail],
          subject: `Order Confirmed - ${order.order_number}`,
          html:    emailHtml,
        }), 5000)
      } catch (e) { console.error('[orders] Customer email failed:', e) }
    }

    // Notify admin
    if (settings.admin_notify_email && !alreadyExists) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY)
        const coinsLine = (d.loyalty_points_redeemed ?? 0) > 0
          ? ` | Coins redeemed: ${d.loyalty_points_redeemed}` : ''
        await withTimeout(resend.emails.send({
          from:    'Pahadi Roots <noreply@pahadiroots.com>',
          to:      [settings.admin_notify_email],
          subject: `New ${d.payment_method.toUpperCase()} Order #${order.order_number} - Rs.${order.total_amount}`,
          html:    `<p>Order: <b>#${order.order_number}</b><br>Customer: ${name} (+91${a.phone})<br>City: ${a.city}, ${a.state}<br>Total: Rs.${order.total_amount}<br>Payment: ${d.payment_method}${coinsLine}</p>`,
        }), 5000)
      } catch { /* non-fatal */ }
    }

    return NextResponse.json(
      { success: true, order_number: order.order_number, order_id: order.id },
      { status: alreadyExists ? 200 : 201 }
    )
  } catch (err: any) {
    console.error('[orders POST]', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: err.message?.includes('stock') || err.message?.includes('COD') ? 409 : 500 })
  }
}
