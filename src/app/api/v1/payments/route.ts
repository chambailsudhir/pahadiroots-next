import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createOrderSchema, verifyPaymentSchema } from '@/lib/schemas'
import { createOrder, logOrderEvent } from '@/lib/services/orderService'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { getServiceClient } from '@/lib/supabase'
import { checkCsrf } from '@/lib/api/serverUtils'
// ── Security: server-only imports (build-time guard against client-bundle leaks) ──
import { awardLoyaltyPoints, redeemLoyaltyPoints } from '@/lib/server/loyalty'
import { esc } from '@/lib/server/htmlEscape'
import { sendTransactionalEmail } from '@/lib/server/email'
// REFACTOR: replaced inline checkPaymentRateLimit() (~40 lines of duplicated
// Upstash boilerplate) with the shared helper. Key is unchanged.
import { checkRateLimitKv } from '@/lib/api/rateLimitKv'
import { logger, captureError } from '@/lib/logger'

// BUG FIX: address fields passed directly to createOrder() without sanitization.
// The orders/route.ts path correctly strips HTML tags via sanitize(), but
// create_payment was missing the same step — raw user input including <script>
// or HTML fragments would reach the DB and confirmation email templates.
// Using the same strip-tags logic applied in orders/route.ts for consistency.
function sanitize(str: string | undefined | null): string {
  if (!str) return ''
  // Strip all HTML tags and trim surrounding whitespace
  return str.replace(/<[^>]*>/g, '').trim()
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
    // BUG FIX: no timeout — a slow or unresponsive Razorpay API would hang the
    // lambda until Vercel's hard 15-second limit, blocking the entire checkout.
    // 10 s is generous for a simple order-creation call to a financial API.
    signal: AbortSignal.timeout(10_000),
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
  if (!await checkRateLimitKv(`mw:rl:payments_ip:${ip}`, 10)) {
    // BUG FIX 13a: missing Retry-After header on 429.
    return NextResponse.json(
      { error: 'Too many requests — please wait a moment' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

  try {
    const body   = await req.json()

    // BUG FIX: `body.action as string` is an unsafe cast — if the client sends
    // action: null, action: 42, or omits the field entirely, TypeScript's type
    // assertion doesn't throw; the === checks below just silently fall through
    // and return the generic 400 "Unknown action" response. That's safe from a
    // security standpoint, but it also masks badly-formed requests in logs.
    // Validate explicitly so malformed payloads are logged with a clear message.
    const action = typeof body.action === 'string' ? body.action : null
    if (!action) {
      return NextResponse.json({ error: 'Missing or invalid action field' }, { status: 400 })
    }

    // ── ACTION 1: Initiate payment ─────────────────────────────────────────
    if (action === 'create_payment') {
      const parsed = createOrderSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
      }

      const settings = await getSiteSettings()
      const pd       = parsed.data

      const { order, alreadyExists, customerId } = await createOrder({
        customerName:   sanitize(pd.address.name),
        customerPhone:  sanitize(pd.address.phone),
        customerEmail:  pd.customer_email ? sanitize(pd.customer_email) : undefined,
        flat:           sanitize(pd.address.flat),
        area:           sanitize(pd.address.area) || '',
        city:           sanitize(pd.address.city),
        state:          sanitize(pd.address.state),
        pincode:        pd.address.pincode,   // numeric string — sanitize not needed
        label:          sanitize(pd.address.label),
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
          .select('payment_id, payment_status, total_amount, order_number')
          .eq('id', order.id)
          .single()

        // BUG C FIX: if the order is already paid (webhook or a prior verify_payment
        // beat this retry), tell the client to skip Razorpay and go to order-success.
        // Before this fix, we returned existingRow.payment_id as razorpay_order_id —
        // but after confirmation payment_id holds the Razorpay PAYMENT ID ("pay_xxx"),
        // not an ORDER ID ("order_xxx"). Passing a payment ID as Razorpay's order_id
        // crashes the SDK silently on the client.
        if (existingRow?.payment_status === 'paid') {
          return NextResponse.json({
            success:           true,
            order_id:          String(order.id),
            already_confirmed: true,
            order_number:      existingRow.order_number,
          })
        }

        if (!existingRow?.payment_id) {
          // No prior Razorpay order stored yet — fall through to create one below.
        } else if (!existingRow.payment_id.startsWith('order_')) {
          // Defensive: payment_id holds a non-order_ value (partial webhook update).
          // Fall through to create a fresh Razorpay order rather than crash the SDK.
        } else {
          // Valid "order_xxx" — reuse so the client resumes the same checkout session.
          return NextResponse.json({
            success:           true,
            order_id:          String(order.id),
            razorpay_order_id: existingRow.payment_id,
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
      // BUG FIX: previously used hand-rolled type/length checks duplicated from
      // verifyPaymentSchema. Now uses the canonical schema (which also has the
      // regex constraint on razorpay_signature). Single source of truth.
      const vParsed = verifyPaymentSchema.safeParse(body)
      if (!vParsed.success) {
        return NextResponse.json({ error: 'Invalid payment verification fields' }, { status: 400 })
      }
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        order_id,
      } = vParsed.data

      // P2 SECURITY FIX: loyalty_points_redeemed is read from the DB, not the client body.

      // 1. Verify HMAC — proves Razorpay generated this callback and the payment is real.
      const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim()
      if (!keySecret) throw new Error('RAZORPAY_KEY_SECRET not configured')

      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex')

      if (expectedSignature !== razorpay_signature) {
        // BUG FIX 13b: HMAC mismatch is a security event (tampered payment response).
        // Use captureError with alert:true so ops are paged — this is not just a
        // user error, it may indicate a man-in-the-middle attack or integration breach.
        captureError(new Error('Payment HMAC signature mismatch'), {
          action:             'payments.verify.hmac_mismatch',
          order_id,
          razorpay_payment_id,
          alert:              true,
        })
        await logOrderEvent(order_id, 'payment_signature_mismatch', 'system', {
          razorpay_order_id, razorpay_payment_id,
        }).catch(() => null)
        return NextResponse.json({ error: 'Payment verification failed — signature mismatch' }, { status: 400 })
      }

      // 2. Fetch order upfront — used for idempotency check AND razorpay_order_id
      //    cross-verification below. Single fetch replaces the two that existed before.
      const db = getServiceClient()
      const { data: currentOrder, error: fetchErr } = await db
        .from('orders')
        .select('id, payment_id, payment_status, order_number, total_amount, customer_id, loyalty_points_redeemed')
        .eq('id', order_id)
        .single()

      if (fetchErr || !currentOrder) {
        // BUG FIX 13d: order lookup failure logged with raw console.error —
        // not parseable by log aggregators. Use structured logger.error.
        logger.error('payments: order not found for verify_payment', { action: 'payments.verify.order_not_found', order_id, error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) })
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }

      // 2a. Idempotency: order already confirmed — no side-effects, just return success.
      //     Covers: webhook fired first, or a duplicate verify_payment call on retry.
      if (currentOrder.payment_status === 'paid') {
        await logOrderEvent(order_id, 'payment_verify_duplicate', 'razorpay', {
          razorpay_payment_id, razorpay_order_id,
          note: 'Order already confirmed — idempotency guard (pre-update check)',
        }).catch(() => null)
        return NextResponse.json({
          success:      true,
          order_number: currentOrder.order_number || order_id,
        })
      }

      // 2b. Cross-verify: razorpay_order_id from the callback MUST match the Razorpay
      //     order ID we stored on this DB order at create_payment time.
      //
      // BUG A FIX — SECURITY: the HMAC only proves a real Razorpay payment happened;
      // it does NOT bind that payment to a specific DB order. Without this check, an
      // attacker who paid for a cheap order A (has valid razorpay_order_id_A,
      // razorpay_payment_id_A, valid HMAC_A) could submit those credentials with
      // order_id = B (an expensive order they haven't paid for) and confirm order B
      // for free. The cross-check closes this by binding the Razorpay order ID to the
      // exact DB order it was created for.
      //
      // Skip when payment_id is null: create_payment failed to persist the Razorpay
      // order ID (rare infra fault). HMAC is sufficient in that edge case.
      if (currentOrder.payment_id && currentOrder.payment_id !== razorpay_order_id) {
        captureError(new Error('razorpay_order_id mismatch in verify_payment'), { action: 'payments.verify.order_id_mismatch', alert: true })
        await logOrderEvent(order_id, 'payment_order_id_mismatch', 'system', {
          razorpay_order_id, razorpay_payment_id,
          stored_payment_id: currentOrder.payment_id,
        }).catch(() => null)
        return NextResponse.json({ error: 'Payment verification failed' }, { status: 400 })
      }

      // 3. Atomic conditional update — only update if order is still 'pending'.
      //    TOCTOU guard for concurrent verify_payment calls: both pass step 2a, both
      //    reach here, but only one wins the Postgres row lock.
      const { data: updatedRows, error: updateErr } = await db
        .from('orders')
        .update({
          order_status:   'confirmed',
          payment_status: 'paid',
          payment_id:     razorpay_payment_id,
        })
        .eq('id', order_id)
        .eq('payment_status', 'pending')
        .select('id')

      // BUG B FIX: distinguish a genuine DB error from a 0-row idempotency hit.
      // Previously both paths were handled by `if (!updatedRows || ...)`, which
      // returned { success: true } even when updateErr was set (updatedRows is null
      // on error) — silently confirming nothing while telling the client it succeeded.
      if (updateErr) {
        // BUG FIX 13c: money taken, DB update failed — critical financial gap.
        // Use captureError with alert:true so ops are paged immediately.
        // We still throw so the outer catch returns 500; the client sees a
        // support-contact message; the webhook will retry confirmation independently.
        captureError(new Error('Order update failed after verified payment: ' + updateErr.message), { action: 'payments.verify.order_update_failed', order_id, razorpay_payment_id, razorpay_order_id, alert: true })
        throw new Error('Order confirmation failed — please contact support with payment ID: ' + razorpay_payment_id)
      }

      // 3a. 0 rows updated: a concurrent process confirmed the order between steps 2a and 3.
      if (!updatedRows || updatedRows.length === 0) {
        await logOrderEvent(order_id, 'payment_verify_duplicate', 'razorpay', {
          razorpay_payment_id, razorpay_order_id,
          note: 'Concurrent race — order confirmed by another process between read and update',
        }).catch(() => null)
        return NextResponse.json({
          success:      true,
          order_number: currentOrder.order_number || order_id,
        })
      }

      // 4. Site settings (single fetch, reused for loyalty + email)
      const settings = await getSiteSettings()

      // 5. Loyalty — read from DB-authoritative field, never from client body
      const loyalty_points_redeemed = Number(currentOrder.loyalty_points_redeemed ?? 0)
      const custId = currentOrder.customer_id
      if (custId) {
        if (loyalty_points_redeemed > 0) {
          const redeemed = await redeemLoyaltyPoints(custId, order_id, loyalty_points_redeemed)
          if (!redeemed) {
            logger.warn('loyalty: redemption skipped — insufficient balance', { order_id })
          }
        }
        await awardLoyaltyPoints(custId, order_id, currentOrder.total_amount ?? 0, settings, 'Earned from online payment')
      }

      // 6. Log verified event
      await logOrderEvent(order_id, 'payment_verified', 'razorpay', {
        razorpay_payment_id, razorpay_order_id,
      }).catch(() => null)

      // 7. Confirmation email
      try {
        const { data: customer } = await db
          .from('customers').select('first_name, email').eq('id', currentOrder.customer_id).single()

        if (customer?.email && currentOrder) {
          const coinsEarned = Math.floor(currentOrder.total_amount * parseFloat(settings.loyalty_points_per_rupee || '1'))
          const coinsHtml   = settings.loyalty_enabled !== 'false' && coinsEarned > 0
            ? `<div style="background:#fffbe8;border:1.5px solid #e8c940;border-radius:12px;padding:14px 20px;margin:16px 0;text-align:center">
                 <span style="font-size:18px">🪙</span>
                 <strong style="color:#7a5800;margin-left:6px">You earned ${coinsEarned} Pahadi Coins!</strong>
                 <p style="margin:4px 0 0;color:#a08020;font-size:12px">Use them on your next order.</p>
               </div>`
            : ''

          // AUDIT FIX [ERROR HANDLING]: previously imported Resend directly
          // and called resend.emails.send() here. The Resend SDK resolves
          // (never rejects) on API-level failures — neither this nor the
          // surrounding try/catch ever caught a real send failure (bad API
          // key, unverified domain, bounce, quota/rate-limit). See
          // lib/server/email.ts for the full explanation. sendTransactionalEmail()
          // checks the resolved `error` explicitly and dead-letters into
          // `failed_emails` for retry via the cron sweep instead of the
          // payment-confirmation email simply vanishing.
          await sendTransactionalEmail({
            type:    'payment_confirmation',
            to:      customer.email,
            subject: `Payment Confirmed #${currentOrder.order_number} — Pahadi Roots 🌿`,
            html: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
                <div style="background:#2C4A2E;padding:24px;text-align:center">
                  <h1 style="color:#fff;margin:0;font-size:22px">🌿 Pahadi Roots</h1>
                  <p style="color:#a8d5b5;margin:4px 0 0">Himalayan Natural Store</p>
                </div>
                <div style="padding:24px">
                  <h2 style="color:#2C4A2E">Payment Confirmed! ✅</h2>
                  <p>Hi <strong>${esc(customer.first_name)}</strong>, your payment was successful.</p>
                  <p><strong>Order #:</strong> ${esc(currentOrder.order_number)}<br>
                     <strong>Payment ID:</strong> ${esc(razorpay_payment_id)}<br>
                     <strong>Amount Paid:</strong> ₹${currentOrder.total_amount}<br>
                     <strong>Delivery:</strong> 3–5 business days</p>
                  ${coinsHtml}
                  <p style="color:#666;font-size:14px">We&apos;ll WhatsApp you tracking details once shipped.</p>
                  <a href="https://pahadiroots.com/account?tab=orders" style="display:inline-block;background:#2C4A2E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:8px">Track Order</a>
                </div>
                <div style="background:#f9f9f9;padding:16px;text-align:center;font-size:12px;color:#999">
                  Pahadi Roots | pahadiroots.com | WhatsApp: +91 98999 84895
                </div>
              </div>`,
            context: { order_id: currentOrder.id, order_number: currentOrder.order_number },
          })
        }
      } catch (e) {
        // Catches errors from BUILDING the email (the customer lookup
        // query, template interpolation) — sendTransactionalEmail() itself
        // never throws.
        logger.error('payments: email failed after payment confirmation', { action: 'payments.email', error: e instanceof Error ? e.message : String(e) })
      }

      return NextResponse.json({
        success:      true,
        order_number: currentOrder.order_number || order_id,
      })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  } catch (err: unknown) {
    const internalMessage = err instanceof Error ? err.message : 'Payment error'
    logger.error('payments POST error', { action: 'payments.post', error: internalMessage })
    // BUG FIX [ERROR HANDLING]: this previously had NO user-facing carve-out at
    // all in production — every error, including the exact same user-actionable
    // messages createOrder() throws in the COD path (insufficient stock, expired/
    // capped coupon, below-minimum-order coupon, unavailable product, insufficient
    // loyalty balance), was flattened to a single generic "Payment processing
    // failed. Please try again or contact support." A Razorpay customer had zero
    // way to know their coupon expired or an item went out of stock, while a COD
    // customer hitting the identical createOrder() failure saw the real reason —
    // an inconsistency between the two checkout paths for the same underlying
    // errors. Genuine internal failures (Razorpay API/config errors, DB/RPC
    // errors) still stay hidden behind the generic message in production.
    const lowerMessage = internalMessage.toLowerCase()
    const isUserFacing = lowerMessage.includes('stock')
      || lowerMessage.includes('cod is not available')
      || lowerMessage.includes('coupon')
      || lowerMessage.includes('no longer available')
      || lowerMessage.includes('insufficient loyalty balance')
    // Never leak Razorpay / Supabase internals to the client in production
    const status = isUserFacing ? 409 : 500
    const clientMessage = isUserFacing || process.env.NODE_ENV !== 'production'
      ? internalMessage
      : 'Payment processing failed. Please try again or contact support.'
    return NextResponse.json({ error: clientMessage }, { status })
  }
}
