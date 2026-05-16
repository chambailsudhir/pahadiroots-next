import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createOrder } from '@/lib/services/orderService'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { Resend } from 'resend'

// Lightweight server-side sanitizer — no ESM issues unlike isomorphic-dompurify
// Input is already Zod-validated (type, length, regex) — this strips residual HTML tags
function sanitize(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim()
}

// Input schema — address nested under 'address' key to match checkout payload
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
  customer_email:  z.string().email().optional().or(z.literal('')),
  items:           z.array(z.object({ productId: z.string().min(1), variantId: z.string().min(1), qty: z.number().int().min(1).max(50) })).min(1).max(30),
  payment_method:  z.enum(['razorpay', 'cod']),
  coupon_code:     z.string().trim().max(50).optional(),
  idempotency_key: z.string().uuid(),
})

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms))])
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = orderSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const d = parsed.data
    const a = d.address

    // Sanitize free-text fields (HTML tag stripping)
    const name = sanitize(a.name)
    const flat = sanitize(a.flat)
    const area = sanitize(a.area || '')

    const settings = await getSiteSettings()

    const { order, alreadyExists } = await createOrder({
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
    }, settings)

    // Send confirmation email for COD orders
    if (d.payment_method === 'cod' && settings.order_email_enabled !== 'false' && d.customer_email && !alreadyExists) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY)
        await withTimeout(resend.emails.send({
          from:    'Pahadi Roots <noreply@pahadiroots.com>',
          to:      [d.customer_email],
          subject: `Order Confirmed — #${order.order_number}`,
          html:    `<p>Hi ${name}, your COD order <strong>#${order.order_number}</strong> is confirmed. Total: Rs.${order.total_amount}. Delivery in 3-5 days.</p>`,
        }), 5000)
      } catch (e) { console.error('[orders] Email failed:', e) }
    }

    // Notify admin
    if (settings.admin_notify_email && !alreadyExists) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY)
        await withTimeout(resend.emails.send({
          from:    'Pahadi Roots <noreply@pahadiroots.com>',
          to:      [settings.admin_notify_email],
          subject: `New ${d.payment_method.toUpperCase()} Order #${order.order_number} — Rs.${order.total_amount}`,
          html:    `<p>Order: <b>#${order.order_number}</b><br>Customer: ${name} (+91${a.phone})<br>City: ${a.city}, ${a.state}<br>Total: Rs.${order.total_amount}<br>Payment: ${d.payment_method}</p>`,
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
