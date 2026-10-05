import { NextRequest, NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { createOrderSchema, verifyPaymentSchema } from '@/lib/schemas'
import { createOrder, IdempotencyConflictError, logOrderEvent } from '@/lib/services/orderService'
import { getFreshSiteSettings } from '@/lib/getSiteSettings'
import { getServiceClient } from '@/lib/supabase'
import { checkCsrf } from '@/lib/api/serverUtils'
// ── Security: server-only imports (build-time guard against client-bundle leaks) ──
// REFACTOR: replaced inline checkPaymentRateLimit() (~40 lines of duplicated
// Upstash boilerplate) with the shared helper. Key is unchanged.
import { checkRateLimitKv } from '@/lib/api/rateLimitKv'
import { logger, captureError } from '@/lib/logger'
// REFACTOR: inline sanitize() extracted to shared lib/server/sanitize.ts.
// Was duplicated in orders/route.ts — single source of truth now.
import { sanitize } from '@/lib/server/sanitize'
// P1/P6: constant-time compare + server-to-server payment verification.
import { safeEqual, isRazorpayOrderId, fetchRazorpayPayment, checkPaymentAgainstOrder } from '@/lib/server/razorpay'
import { confirmOrderPayment, recordCapturedPayment, runPaidSideEffects, storeRazorpayOrderId } from '@/lib/server/orderPayments'

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
    // ── Body size cap — 64 KB is generous for a payment payload ─────────────
    // Mirrors the guard added to orders/route.ts — same class of risk.
    const rawContentLength = Number(req.headers.get('content-length'))
    if (Number.isFinite(rawContentLength) && rawContentLength > 65_536) {
      return NextResponse.json({ error: 'Request too large' }, { status: 413 })
    }

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

      const settings = await getFreshSiteSettings()
      const pd       = parsed.data

      // BUG FIX: same gap as /api/v1/orders/route.ts — this is a SEPARATE
      // order-creation entry point (the online-payment checkout flow calls
      // here; COD calls the other route) and had its own independent
      // instance of the same missing check. `settings` was already being
      // fetched on the line above for other purposes; store_open wasn't one
      // of them. Only gates NEW order creation — the verify_payment action
      // further down (confirming a payment already in flight) is
      // deliberately left ungated, since blocking that would leave a
      // customer's payment taken but their order unconfirmed, which is worse
      // than letting an already-initiated transaction finish.
      if (settings.store_open === 'false') {
        return NextResponse.json(
          { error: 'Sorry, we are temporarily not accepting orders. Please check back soon.' },
          { status: 503 },
        )
      }

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
          .select('payment_id, payment_status, total_amount, order_number, confirmation_token')
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
            confirmation_token: existingRow.confirmation_token ?? order.confirmationToken,
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

      // Never hand out a payable Razorpay order we failed to link to our order (see helper).
      await storeRazorpayOrderId(db, order.id, rzpOrder.id)

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

      if (!safeEqual(expectedSignature, razorpay_signature)) {
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
        .select('id, payment_id, payment_status, payment_method, order_number, total_amount, customer_id, loyalty_points_redeemed, confirmation_token')
        .eq('id', order_id)
        .single()

      if (fetchErr || !currentOrder) {
        // BUG FIX 13d: order lookup failure logged with raw console.error —
        // not parseable by log aggregators. Use structured logger.error.
        logger.error('payments: order not found for verify_payment', { action: 'payments.verify.order_not_found', order_id, error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) })
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }

      // 2a. P1 SECURITY: only Razorpay-method orders can ever be confirmed here.
      //     A COD order (or anything else) has no Razorpay order to bind to, so a
      //     valid signature from an unrelated payment must never flip it to "paid".
      if (currentOrder.payment_method !== 'razorpay') {
        captureError(new Error('verify_payment attempted on non-razorpay order'), {
          action: 'payments.verify.wrong_method', order_id, payment_method: currentOrder.payment_method, alert: true,
        })
        await logOrderEvent(order_id, 'payment_verify_rejected', 'system', {
          reason: 'not_a_razorpay_order', razorpay_order_id, razorpay_payment_id,
        }).catch(() => null)
        return NextResponse.json({ error: 'Payment verification failed' }, { status: 400 })
      }

      // 2b. Idempotency: order already confirmed — no side-effects, just return success.
      //     Covers: webhook fired first, or a duplicate verify_payment call on retry.
      //
      //     P1 SECURITY: once paid, payment_id holds the Razorpay PAYMENT id (pay_xxx).
      //     The previous version returned success (and the order's confirmation_token)
      //     to ANY caller holding a valid signature for ANY payment. Now the supplied
      //     payment id must be the one that actually paid this order.
      if (currentOrder.payment_status === 'paid') {
        if (currentOrder.payment_id !== razorpay_payment_id) {
          captureError(new Error('verify_payment on paid order with mismatched payment id'), {
            action: 'payments.verify.paid_mismatch', order_id, razorpay_payment_id, alert: true,
          })
          return NextResponse.json({ error: 'Payment verification failed' }, { status: 400 })
        }
        await logOrderEvent(order_id, 'payment_verify_duplicate', 'razorpay', {
          razorpay_payment_id, razorpay_order_id,
          note: 'Order already confirmed — idempotency guard (pre-update check)',
        }).catch(() => null)
        return NextResponse.json({
          success:      true,
          order_number: currentOrder.order_number || order_id,
          confirmation_token: currentOrder.confirmation_token ?? undefined,
        })
      }

      // 2c. Cross-verify: razorpay_order_id from the callback MUST exactly match the
      //     Razorpay order ID we stored on this DB order at create_payment time.
      //
      // P1 SECURITY FIX: the HMAC only proves a real Razorpay payment happened; it does
      // NOT bind that payment to a specific DB order. The previous code skipped this
      // check when the stored payment_id was NULL ("HMAC is sufficient") — and
      // /api/v1/orders could create exactly such an order (razorpay method, no
      // Razorpay order). An attacker paid ₹1 for their own order, then submitted that
      // valid signature against an unpaid ₹5,000 order and got it confirmed.
      //
      // Now: the stored value MUST be a real `order_…` id and MUST equal the callback's.
      // A NULL / non-order_ value is rejected (fail closed). The webhook ALSO refuses to
      // confirm such an order (it holds it for manual review), so the only safe way to never
      // reach this state is create_payment: storeRazorpayOrderId() retries the write and
      // refuses to return a payable Razorpay order if it cannot be saved.
      if (!isRazorpayOrderId(currentOrder.payment_id) || !safeEqual(currentOrder.payment_id, razorpay_order_id)) {
        captureError(new Error('razorpay_order_id mismatch in verify_payment'), { action: 'payments.verify.order_id_mismatch', order_id, alert: true })
        await logOrderEvent(order_id, 'payment_order_id_mismatch', 'system', {
          razorpay_order_id, razorpay_payment_id,
          stored_payment_id: currentOrder.payment_id,
        }).catch(() => null)
        return NextResponse.json({ error: 'Payment verification failed' }, { status: 400 })
      }

      // 2d. P1: independent server-to-server check with Razorpay — the HMAC says nothing
      //     about AMOUNT or CAPTURE state. Fail closed if we cannot verify.
      let verifiedPaymentAmountInr: number
      try {
        const rzpPayment = await fetchRazorpayPayment(razorpay_payment_id)
        const check = checkPaymentAgainstOrder(rzpPayment, {
          razorpayOrderId: razorpay_order_id,
          totalAmountInr:  Number(currentOrder.total_amount),
        })
        if (!check.ok) {
          const isNotYetCaptured = check.reason === 'not_captured' && rzpPayment.status === 'authorized'
          if (isNotYetCaptured) {
            // Authorized but not yet captured (auto-capture lag). Not fraud — the
            // payment.captured webhook confirms the order. Tell the client to wait.
            await logOrderEvent(order_id, 'payment_verify_pending_capture', 'razorpay', {
              razorpay_order_id, razorpay_payment_id, status: rzpPayment.status,
            }).catch(() => null)
            // order_number + token let the client land on the order-success page, which
            // polls until the webhook confirms (the HMAC + order binding already passed).
            return NextResponse.json(
              {
                error: 'Your payment is being confirmed. Please do not pay again — your order will be confirmed shortly.',
                pending: true,
                order_number: currentOrder.order_number || order_id,
                confirmation_token: currentOrder.confirmation_token ?? undefined,
              },
              { status: 202 },
            )
          }
          captureError(new Error(`verify_payment Razorpay check failed: ${check.reason}`), {
            action: 'payments.verify.rzp_check_failed', order_id, razorpay_payment_id, detail: check.detail, alert: true,
          })
          await logOrderEvent(order_id, 'payment_verify_rejected', 'system', {
            reason: check.reason, detail: check.detail, razorpay_order_id, razorpay_payment_id,
          }).catch(() => null)
          return NextResponse.json({ error: 'Payment verification failed' }, { status: 400 })
        }
        verifiedPaymentAmountInr = rzpPayment.amount / 100
      } catch (e) {
        // Network / Razorpay outage. Do NOT confirm unverified money; the customer's
        // payment (if real) is confirmed by the payment.captured webhook.
        logger.error('payments: could not verify payment with Razorpay', {
          action: 'payments.verify.rzp_fetch_failed', order_id, razorpay_payment_id,
          error: e instanceof Error ? e.message : String(e),
        })
        return NextResponse.json(
          {
            error: 'We could not confirm your payment right now. Please do not pay again — it will be confirmed automatically, or contact support with payment ID: ' + razorpay_payment_id,
            pending: true,
            order_number: currentOrder.order_number || order_id,
            confirmation_token: currentOrder.confirmation_token ?? undefined,
          },
          { status: 503, headers: { 'Retry-After': '5' } },
        )
      }

      // 3. Atomic pending|failed → paid transition (shared with the webhook).
      //    P2: a previously-failed order (payment.failed on an earlier attempt, or
      //    released by the expiry job) is recovered here instead of silently
      //    returning "success" while the order stays dead.
      const confirm = await confirmOrderPayment(db, {
        orderId: order_id, razorpayPaymentId: razorpay_payment_id, source: 'verify_payment',
      })

      if (confirm.outcome === 'error') {
        // Money taken, DB update failed — critical. Page ops; the webhook retries independently.
        captureError(new Error('Order update failed after verified payment: ' + confirm.message), { action: 'payments.verify.order_update_failed', order_id, razorpay_payment_id, razorpay_order_id, alert: true })
        throw new Error('Order confirmation failed — please contact support with payment ID: ' + razorpay_payment_id)
      }

      if (confirm.outcome === 'not_found') {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 })
      }

      if (confirm.outcome === 'not_confirmable') {
        // e.g. an admin cancelled the order while the customer was paying. Never flip it
        // silently — page ops with the payment id so they can refund / reinstate.
        captureError(new Error('Verified payment for an order that cannot be confirmed'), {
          action: 'payments.verify.not_confirmable', order_id, razorpay_payment_id,
          order_status: confirm.orderStatus, payment_status: confirm.paymentStatus, alert: true,
        })
        await logOrderEvent(order_id, 'payment_received_for_unconfirmable_order', 'razorpay', {
          razorpay_payment_id, order_status: confirm.orderStatus, payment_status: confirm.paymentStatus,
        }).catch(() => null)
        return NextResponse.json(
          { error: 'Your payment was received but this order could not be confirmed automatically. Please contact support with payment ID: ' + razorpay_payment_id },
          { status: 409 },
        )
      }

      // already_paid: a concurrent verify/webhook won the transition and ran the side
      // effects (loyalty, e-mail) — nothing more to do but report success.
      if (confirm.outcome === 'already_paid') {
        await logOrderEvent(order_id, 'payment_verify_duplicate', 'razorpay', {
          razorpay_payment_id, razorpay_order_id,
          note: 'Concurrent race — order confirmed by another process between read and update',
        }).catch(() => null)
        return NextResponse.json({
          success:      true,
          order_number: currentOrder.order_number || order_id,
          confirmation_token: currentOrder.confirmation_token ?? undefined,
        })
      }

      // We won (confirmed | recovered): audit row + loyalty + e-mail, exactly once.
      await recordCapturedPayment(db, {
        orderId: order_id, razorpayPaymentId: razorpay_payment_id,
        amountInr: verifiedPaymentAmountInr, alertAction: 'payments.verify.payments_insert',
      })
      const settings = await getFreshSiteSettings()
      await runPaidSideEffects(db, {
        order: {
          id: currentOrder.id, order_number: currentOrder.order_number,
          total_amount: currentOrder.total_amount, customer_id: currentOrder.customer_id,
          loyalty_points_redeemed: currentOrder.loyalty_points_redeemed,
        },
        razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id,
        settings, defer: (fn) => after(fn),
      })

      return NextResponse.json({
        success:      true,
        order_number: currentOrder.order_number || order_id,
        confirmation_token: currentOrder.confirmation_token ?? undefined,
      })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  } catch (err: unknown) {
    const internalMessage = err instanceof Error ? err.message : 'Payment error'
    logger.error('payments POST error', { action: 'payments.post', error: internalMessage })

    // P3: a reused idempotency key for a different request. 409 + a stable `code` lets the
    // client mint a fresh key and ask the customer to re-confirm, instead of looping.
    if (err instanceof IdempotencyConflictError) {
      logger.warn('idempotency key reused with a different request', { action: 'idempotency.conflict', reason: err.reason })
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 })
    }
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
      // BUG FIX [ERROR HANDLING] (kept in sync with orders/route.ts — see
      // that file for the full incident writeup): these are the same
      // createOrder() COD guardrails hitting the identical gap here.
      || lowerMessage.includes('cod is only available')
      || lowerMessage.includes('already in progress')
      || lowerMessage.includes('coupon')
      || lowerMessage.includes('no longer available')
      || lowerMessage.includes('multiple options')
      || lowerMessage.includes('invalid cart item')
      || lowerMessage.includes('insufficient loyalty balance')
    // Never leak Razorpay / Supabase internals to the client in production
    const status = isUserFacing ? 409 : 500
    const clientMessage = isUserFacing || process.env.NODE_ENV !== 'production'
      ? internalMessage
      : 'Payment processing failed. Please try again or contact support.'
    return NextResponse.json({ error: clientMessage }, { status })
  }
}
