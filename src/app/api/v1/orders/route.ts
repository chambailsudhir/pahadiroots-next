import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createOrder } from '@/lib/services/orderService'
import { getSiteSettings } from '@/lib/getSiteSettings'
import DOMPurify from 'isomorphic-dompurify'

// Input schema matching real checkout form
const orderSchema = z.object({
  // Customer + address fields
  name:            z.string().trim().min(2).max(100),
  phone:           z.string().trim().regex(/^[6-9]\d{9}$/, 'Invalid mobile number'),
  email:           z.string().email().optional().or(z.literal('')),
  flat:            z.string().trim().min(1).max(200),
  area:            z.string().trim().min(2).max(200),
  city:            z.string().trim().min(2).max(100),
  state:           z.string().trim().min(2).max(100),
  pincode:         z.string().trim().regex(/^\d{6}$/, 'Invalid pincode'),
  label:           z.enum(['Home', 'Office', 'Parents', 'Friends', 'Others']).optional(),
  // Order fields
  items:           z.array(z.object({ productId: z.string().uuid(), variantId: z.string().uuid(), qty: z.number().int().min(1).max(50) })).min(1).max(30),
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
    // Sanitize inputs
    const name  = DOMPurify.sanitize(d.name.trim())
    const flat  = DOMPurify.sanitize(d.flat.trim())
    const area  = DOMPurify.sanitize(d.area.trim())

    const settings = await getSiteSettings()

    const { order, alreadyExists } = await createOrder({
      customerName:   name,
      customerPhone:  d.phone,
      customerEmail:  d.email || undefined,
      flat, area,
      city:    d.city,
      state:   d.state,
      pincode: d.pincode,
      label:   d.label,
      items:          d.items,
      paymentMethod:  d.payment_method,
      couponCode:     d.coupon_code,
      idempotencyKey: d.idempotency_key,
    }, settings)

    // Send confirmation email for COD orders
    if (d.payment_method === 'cod' && settings.order_email_enabled !== 'false' && d.email && !alreadyExists) {
      try {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        await withTimeout(resend.emails.send({
          from:    'Pahadi Roots <noreply@pahadiroots.com>',
          to:      [d.email],
          subject: `Order Confirmed — #${order.order_number}`,
          html:    `<p>Hi ${name}, your COD order <strong>#${order.order_number}</strong> is confirmed. Total: Rs.${order.total_amount}. Delivery in 3-5 days.</p>`,
        }), 5000)
      } catch (e) { console.error('[orders] Email failed:', e) }
    }

    // Notify admin
    if (settings.admin_notify_email && !alreadyExists) {
      try {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        await withTimeout(resend.emails.send({
          from:    'Pahadi Roots <noreply@pahadiroots.com>',
          to:      [settings.admin_notify_email],
          subject: `New ${d.payment_method.toUpperCase()} Order #${order.order_number} — Rs.${order.total_amount}`,
          html:    `<p>Order: <b>#${order.order_number}</b><br>Customer: ${name} (+91${d.phone})<br>City: ${d.city}, ${d.state}<br>Total: Rs.${order.total_amount}<br>Payment: ${d.payment_method}</p>`,
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
