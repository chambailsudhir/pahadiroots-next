import { NextResponse } from 'next/server'
import { createOrderSchema } from '@/lib/schemas'
import { createOrder } from '@/lib/services/orderService'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { getServiceClient } from '@/lib/supabase'
import DOMPurify from 'isomorphic-dompurify'
import { Resend } from 'resend'

// Timeout wrapper for third-party calls (Audit #B10)
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ])
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    // 1. Zod validation (Audit #B8)
    const parsed = createOrderSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    // 2. Sanitize text inputs (Audit #G26)
    const data = parsed.data
    data.address.name   = DOMPurify.sanitize(data.address.name.trim())
    data.address.flat   = DOMPurify.sanitize(data.address.flat.trim())
    data.address.area   = DOMPurify.sanitize(data.address.area.trim())
    data.address.city   = DOMPurify.sanitize(data.address.city.trim())
    if (data.coupon_code) data.coupon_code = data.coupon_code.toUpperCase().trim()

    const settings = await getSiteSettings()

    // 3. Create order (includes: idempotency, stock check, price recalc, COD fraud checks)
    const { order, alreadyExists } = await createOrder(data, settings)

    // 4. Send confirmation email (Audit #B10 — with timeout)
    if (settings.order_email_enabled !== 'false' && !alreadyExists) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY)
        await withTimeout(
          resend.emails.send({
            from:    'Pahadi Roots <noreply@pahadiroots.com>',
            to:      data.customer_email ? [data.customer_email] : [],
            subject: `Order Confirmed — #${order.order_number}`,
            html:    buildOrderEmail(order),
          }),
          5000 // 5s timeout for Resend
        )
      } catch (emailErr) {
        // Non-fatal — order is already placed
        console.error('[orders] Email failed:', emailErr)
      }

      // Also notify admin
      if (settings.admin_notify_email) {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY)
          await withTimeout(
            resend.emails.send({
              from:    'Pahadi Roots Orders <noreply@pahadiroots.com>',
              to:      [settings.admin_notify_email],
              subject: `New Order #${order.order_number} — ${data.payment_method.toUpperCase()} — ₹${order.total}`,
              html:    `<p>New order received: <strong>#${order.order_number}</strong><br>Customer: ${data.address.name} (${data.address.phone})<br>Total: ₹${order.total}<br>Payment: ${data.payment_method.toUpperCase()}</p>`,
            }),
            5000
          )
        } catch { /* non-fatal */ }
      }
    }

    return NextResponse.json(
      { success: true, order_number: order.order_number, order_id: order.id },
      { status: alreadyExists ? 200 : 201 }
    )

  } catch (err: any) {
    console.error('[orders POST]', err)
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: err.message?.includes('stock') ? 409 : 500 }
    )
  }
}

function buildOrderEmail(order: any): string {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h1 style="color:#1a5c38;font-size:22px">Order Confirmed! 🎉</h1>
      <p style="color:#555">Hi ${order.customer_name}, your order <strong>#${order.order_number}</strong> has been placed successfully.</p>
      <div style="background:#f5f5f5;border-radius:12px;padding:16px;margin:16px 0">
        <div style="font-size:13px;color:#333">
          <div style="margin-bottom:8px"><strong>Total:</strong> ₹${order.total}</div>
          <div style="margin-bottom:8px"><strong>Payment:</strong> ${order.payment_method === 'cod' ? 'Cash on Delivery' : 'Online Payment'}</div>
          <div><strong>Address:</strong> ${order.address?.flat}, ${order.address?.area}, ${order.address?.city} — ${order.address?.pincode}</div>
        </div>
      </div>
      <p style="color:#555;font-size:13px">Estimated delivery: 3–5 business days. We'll WhatsApp you tracking details once shipped.</p>
      <p style="color:#888;font-size:12px;margin-top:24px">Pahadi Roots · Natural Himalayan Products</p>
    </div>
  `
}
