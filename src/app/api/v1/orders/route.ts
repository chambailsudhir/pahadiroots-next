import { NextRequest, NextResponse } from 'next/server'
import { createOrder } from '@/lib/services/orderService'
import { StockReservationError } from '@/lib/services/inventoryService'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { sendTransactionalEmail } from '@/lib/server/email'
import { checkCsrf } from '@/lib/api/serverUtils'
import { createOrderSchema } from '@/lib/schemas'
// ── Security: server-only imports (build-time guard against client-bundle leaks) ──
import { awardLoyaltyPoints, redeemLoyaltyPoints } from '@/lib/server/loyalty'
import { esc } from '@/lib/server/htmlEscape'
// REFACTOR: replaced two inline checkOrderIpLimit / checkOrderPhoneLimit functions
// (~80 lines of duplicated Upstash boilerplate) with the shared helper.
// Keys are unchanged so all existing middleware counters are preserved.
import { checkRateLimitKv } from '@/lib/api/rateLimitKv'
import { logger, captureError } from '@/lib/logger'
// REFACTOR: inline sanitize() extracted to shared lib/server/sanitize.ts.
// Was duplicated in payments/route.ts — single source of truth now.
import { sanitize } from '@/lib/server/sanitize'

// NOTE: createOrderSchema (imported from @/lib/schemas) is the canonical validation
// schema for this route. coupon_code is accepted but the DISCOUNT is never trusted
// from the client — createOrder() re-validates and recomputes server-side.

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

export async function POST(req: NextRequest) {
  // ── CSRF check ─────────────────────────────────────────────────────────────
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  // ── Rate limit: IP-level pre-check (distributed via Upstash KV) ──────────
  // Applied before body parsing so bots are rejected cheaply without DB work.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!await checkRateLimitKv(`mw:rl:orders_ip:${ip}`, 10)) {
    return NextResponse.json({ error: 'Too many requests — please wait a moment' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  // ── Body size cap — 64 KB is generous for an order payload ───────────────
  // Without this guard, a client can POST a megabyte of junk, exhausting the
  // lambda's memory before body parsing even starts. The webhook already has
  // this guard (1 MB); order/payment payloads are far smaller in practice.
  const rawContentLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(rawContentLength) && rawContentLength > 65_536) {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }

  try {
    const body   = await req.json()
    const parsed = createOrderSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const d = parsed.data
    const a = d.address

    // ── Phone-level rate limit (after parse, so we have the phone number) ──
    if (!await checkRateLimitKv(`mw:rl:orders_phone:${a.phone}`, 3)) {
      return NextResponse.json({ error: 'Too many order attempts — please wait a moment' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const name  = sanitize(a.name)
    const flat  = sanitize(a.flat)
    const area  = sanitize(a.area || '')
    // BUG FIX: city and state were passed directly to createOrder() and into
    // email templates without going through sanitize(). The admin-email comment
    // even claimed "name/phone/city/state come through sanitize() above" — that
    // was wrong. Raw HTML tags (e.g. <script>) could reach the DB and, in the
    // admin notification email, bypass esc() because esc() only HTML-encodes
    // characters — it doesn't strip tags, so a value like
    // `<b onclick="…">Mumbai</b>` would render as bold in an email client.
    // Fix: run sanitize() (strips all HTML tags) on every free-text address field
    // before passing to createOrder() or building email HTML.
    const city  = sanitize(a.city)
    const state = sanitize(a.state)

    const settings = await getSiteSettings()

    const { order, alreadyExists, customerId } = await createOrder({
      customerName:   name,
      customerPhone:  a.phone,
      customerEmail:  d.customer_email || undefined,
      flat, area,
      city,
      state,
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
    if (!alreadyExists && d.payment_method === 'cod') {
      // customerId comes directly from createOrder() return value — no need for
      // the unsafe (order as any).customer_id fallback (order doesn't carry that field).
      const cid = customerId
      if (cid) {
        if ((d.loyalty_points_redeemed ?? 0) > 0) {
          const redeemed = await redeemLoyaltyPoints(cid, order.id, d.loyalty_points_redeemed!)
          if (!redeemed) {
            // Non-fatal: order is committed, but redemption was skipped (balance race).
            // Mirrors the same guard in verify_payment. Ops can review loyalty_transactions.
            // BUG FIX 14: use structured logger.warn (not raw console.warn) so this
            // appears as a filterable JSON line in log aggregators, not a plain string.
            logger.warn('loyalty: COD redemption skipped — insufficient balance', { order_id: order.id })
          }
        }
        await awardLoyaltyPoints(cid, order.id, order.total_amount, settings, 'Earned from COD order')
      }
    }

    // ── Confirmation email ─────────────────────────────────────────────────
    const customerEmail = d.customer_email?.trim()
    if (settings.order_email_enabled !== 'false' && customerEmail && !alreadyExists) {
      try {
        const emailItems = order.cartItems ?? []
        const payLabel   = d.payment_method === 'cod' ? '💵 Cash on Delivery' : '💳 Paid Online'
        const estDate    = getDeliveryEstimate()
        const coinsEarned = Math.floor(order.total_amount * parseFloat(settings.loyalty_points_per_rupee || '1'))

        // ── All user-supplied strings are HTML-escaped before interpolation ──
        const safeName    = esc(name)
        const safeFlat    = esc(flat)
        const safeArea    = esc(area)
        const safeCity    = esc(city)
        const safeState   = esc(state)
        const safePincode = esc(a.pincode)

        const itemsHtml = emailItems.map(i =>
          `<tr>
            <td style="padding:10px 0;border-bottom:1px solid #f0f0f0">
              <span style="font-size:16px">${esc(i.emoji) || '🌿'}</span>
              <strong style="color:#1a1a1a;margin-left:8px">${esc(i.name)}</strong>
              <span style="color:#888;font-size:13px"> × ${esc(i.qty)}</span>
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
    <p style="color:#666;font-size:14px;margin:0 0 16px">Thank you ${safeName}! Your mountain goodness is on its way 🌿</p>
    <div style="display:inline-block;background:#f0f7f4;border:1.5px solid #c8e6c9;border-radius:20px;padding:8px 20px">
      <span style="font-size:13px;font-weight:700;color:#1a3a1e">📋 ${esc(order.order_number)}</span>
    </div>
    ${coinsHtml}
  </div>
  <div style="background:#fff9e6;border-left:4px solid #c8920a;padding:16px 32px;border-right:1px solid #eee">
    <strong style="color:#1a3a1e">🚚 Estimated Delivery: ${esc(estDate)}</strong><br>
    <span style="color:#888;font-size:12px">Pan India · We&apos;ll notify you when shipped</span>
  </div>
  <div style="background:#fff;padding:24px 32px;border-left:1px solid #eee;border-right:1px solid #eee">
    <p style="font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px">YOUR ITEMS</p>
    <table style="width:100%;border-collapse:collapse">${itemsHtml}</table>
    <table style="width:100%;border-collapse:collapse;margin-top:12px">
      <tr><td style="padding:6px 0;color:#555">Payment</td><td style="text-align:right;color:#555">${esc(payLabel)}</td></tr>
      <tr>
        <td style="padding:6px 0;font-size:17px;font-weight:900;color:#1a3a1e">Total</td>
        <td style="text-align:right;font-size:17px;font-weight:900;color:#1a3a1e">₹${order.total_amount.toLocaleString('en-IN')}</td>
      </tr>
    </table>
  </div>
  <div style="background:#f0f7f4;padding:16px 32px;border-left:1px solid #eee;border-right:1px solid #eee">
    <p style="margin:0;font-size:13px;color:#2d6a4f">
      📍 <strong>Delivering to:</strong> ${safeFlat}${safeArea ? ', ' + safeArea : ''}, ${safeCity}, ${safeState} - ${safePincode}
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

        // AUDIT FIX [ERROR HANDLING]: previously called resend.emails.send()
        // directly inside this try/catch. The Resend SDK resolves (never
        // rejects) on API-level failures, so this catch never fired for the
        // most common failure mode — see lib/server/email.ts for the full
        // explanation. sendTransactionalEmail() checks the resolved `error`
        // field explicitly and dead-letters into `failed_emails` for retry
        // via the cron sweep instead of the email simply vanishing.
        await sendTransactionalEmail({
          type:    'order_confirmation',
          to:      customerEmail,
          subject: `Order Confirmed - ${order.order_number}`,
          html:    emailHtml,
          context: { order_id: order.id, order_number: order.order_number },
        })
      } catch (e) {
        // Catches errors from BUILDING the email (template interpolation,
        // etc.) — sendTransactionalEmail() itself never throws.
        logger.error('orders: customer confirmation email failed', { action: 'orders.email.customer', order_id: order.id, error: e instanceof Error ? e.message : String(e) })
      }
    }

    // Notify admin
    if (settings.admin_notify_email && !alreadyExists) {
      try {
        const coinsLine = (d.loyalty_points_redeemed ?? 0) > 0
          ? ` | Coins redeemed: ${d.loyalty_points_redeemed}` : ''
        await sendTransactionalEmail({
          type:    'admin_order_notify',
          to:      settings.admin_notify_email,
          subject: `New ${d.payment_method.toUpperCase()} Order #${order.order_number} - Rs.${order.total_amount}`,
          // Admin email — all user-supplied fields go through sanitize() above
          // (name, flat, area, city, state) then esc() for HTML encoding.
          html:    `<p>Order: <b>#${esc(order.order_number)}</b><br>Customer: ${esc(name)} (+91${esc(a.phone)})<br>City: ${esc(city)}, ${esc(state)}<br>Total: Rs.${order.total_amount}<br>Payment: ${esc(d.payment_method)}${esc(coinsLine)}</p>`,
          context: { order_id: order.id, order_number: order.order_number },
        })
      } catch (e) {
        // BUG FIX [ERROR HANDLING]: previously a bare `catch { /* non-fatal */ }`
        // with zero logging — if the admin notification email failed (bad
        // RESEND_API_KEY, rate limit, admin_notify_email misconfigured), there
        // was NO trace anywhere that admin was never notified of a new order.
        // The customer-email catch two blocks above already logs correctly;
        // this one silently ate the same class of failure. Now logged for
        // ops visibility, matching the customer-email path.
        logger.error('orders: admin notification email failed', { action: 'orders.email.admin', order_id: order.id, error: e instanceof Error ? e.message : String(e) })
      }
    }

    return NextResponse.json(
      { success: true, order_number: order.order_number, order_id: order.id },
      { status: alreadyExists ? 200 : 201 }
    )
  } catch (err: unknown) {
    logger.error('orders POST error', { action: 'orders.post', error: err instanceof Error ? err.message : String(err) })
    const internalMessage = err instanceof Error ? err.message : 'Internal server error'
    // SEC-4 FIX: expose stock/COD errors to the user (they need to act on them)
    // but never expose raw DB error messages in production — they leak table names,
    // constraint names, and Supabase internals to attackers.
    //
    // BUG FIX [ERROR HANDLING]: the original check only matched 'stock' and 'COD',
    // so every other user-actionable error thrown by createOrder() — an expired
    // or usage-capped coupon, a below-minimum-order coupon, a product that became
    // unavailable between add-to-cart and checkout, or a loyalty-balance race —
    // fell through to the generic "Order placement failed. Please try again or
    // contact support." message in production. The user had no way to know they
    // needed to remove their coupon or an unavailable item; clicking "try again"
    // would fail identically every time, and "contact support" for something they
    // could have fixed themselves in five seconds. Widened to a case-insensitive
    // check covering every user-actionable message createOrder() can throw, while
    // still hiding genuinely internal failures (DB/RPC errors, "could not create
    // customer record", etc.) behind the generic message.
    // TYPE-SAFE CHECK FIRST: infra/DB failures (bad RPC types, connection drop,
    // permission errors) must always be 500s — never shown to the customer as
    // an actionable stock message, even though the word "stock" appears in
    // both the error and the message-sniffing checks below.
    const isInfraFailure = err instanceof StockReservationError
    const lowerMessage = internalMessage.toLowerCase()
    const isUserFacing = !isInfraFailure && (
      lowerMessage.includes('stock')
      || lowerMessage.includes('cod is not available')
      || lowerMessage.includes('coupon')
      || lowerMessage.includes('no longer available')
      || lowerMessage.includes('insufficient loyalty balance')
    )
    const status  = isUserFacing ? 409 : 500
    const clientMessage = isUserFacing || process.env.NODE_ENV !== 'production'
      ? internalMessage
      : 'Order placement failed. Please try again or contact support.'
    return NextResponse.json({ error: clientMessage }, { status })
  }
}
