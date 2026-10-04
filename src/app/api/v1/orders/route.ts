import { NextRequest, NextResponse, after } from 'next/server'
import { createOrder, IdempotencyConflictError } from '@/lib/services/orderService'
import { StockReservationError } from '@/lib/services/inventoryService'
import { getFreshSiteSettings } from '@/lib/getSiteSettings'
import { sendTransactionalEmail } from '@/lib/server/email'
import { checkCsrf, sbAuth, syncCustomerProfile, getToken, tryRefresh, applyNewCookies } from '@/lib/api/serverUtils'
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

// BUG FIX (live 504 "Order save failed" — Vercel Runtime Timeout Error:
// "Task timed out after 15 seconds"): confirmed via Supabase logs that this
// specific order's entire 15-second execution window overlapped exactly with
// a recurring PostgREST "Thread killed by timeout manager" incident (a known,
// ongoing resource-tier characteristic of this project's Supabase compute —
// see project notes). createOrder() and the loyalty award/redeem calls below
// it are all awaited directly with no per-step timeout, so a single hung
// Postgres/PostgREST call during one of these periodic hiccups silently
// consumes the entire request with no feedback, until Vercel's own hard
// 15-second limit kills the function — the customer sees a bare, unexplained
// 504 after a long silent wait, with no indication of what happened or that
// retrying is likely to work.
//
// This wraps the single biggest, most DB-heavy step (createOrder) in an
// explicit timeout, leaving a ~5s buffer under Vercel's 15s hard limit for
// CSRF/rate-limit checks and response serialization already spent by this
// point. On timeout, the customer gets a fast (~10s, not 15s), clear,
// specifically-worded "temporarily slow, please retry" message instead of a
// silent hang ending in a generic error — and because the idempotency key is
// unchanged, a prompt retry is safe even if the original createOrder() call
// is still finishing in the background (Node doesn't truly cancel the
// underlying network call just because this function stopped awaiting it).
//
// This does not fix the underlying PostgREST resource-tier issue itself —
// that requires a Supabase compute upgrade, a decision explicitly deferred
// by the user for now — it only stops that issue from producing a silent,
// unexplained 15-second hang on the customer-facing order-creation path.
class OrderCreateTimeoutError extends Error {
  constructor() { super('ORDER_CREATE_TIMEOUT') }
}
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new OrderCreateTimeoutError()), ms)
    }),
  ])
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
      // BUG FIX (observability): this branch previously returned the field
      // errors to the client but never logged them server-side. Every rejected
      // order silently vanished from Vercel logs with zero trace — impossible
      // to diagnose from the dashboard, only from the client's console. Now
      // logged as a structured warning so real failures are visible in
      // Vercel function logs going forward.
      const fieldErrors = parsed.error.flatten().fieldErrors
      logger.warn('orders: schema validation failed', { action: 'orders.post.validate', fieldErrors })
      return NextResponse.json({ error: 'Invalid request', details: fieldErrors }, { status: 400 })
    }

    const d = parsed.data
    const a = d.address

    // P1 SECURITY FIX: this endpoint is the COD path. Online payments go through
    // /api/v1/payments (create_payment), which creates the Razorpay order and binds
    // it to the DB order. The shared schema also accepts 'razorpay', and honouring
    // it here created a pending order with payment_id = NULL and NO Razorpay order —
    // exactly the unbound order an attacker needs to confirm with someone else's
    // (cheap) payment signature, and a free way to lock stock with pending orders.
    if (d.payment_method !== 'cod') {
      logger.warn('orders: non-COD payment_method rejected on /api/v1/orders', {
        action: 'orders.post.non_cod', payment_method: d.payment_method,
      })
      return NextResponse.json(
        { error: 'Online payments must be started from the payment flow. Please use Pay Online at checkout.' },
        { status: 400 },
      )
    }

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

    const settings = await getFreshSiteSettings()

    // BUG FIX: the storefront's maintenance gate (src/proxy.ts) redirects GET
    // page requests to /maintenance when store_open === 'false', but that
    // only stops NEW page loads. A tab already open before "Close Store" was
    // toggled — or a direct POST here (curl, a bot, a stale cached page) —
    // hit this route with zero enforcement of the same flag, letting a real
    // order (and payment) go through while the storefront visibly shows as
    // closed. `settings` was already being fetched on this line for other
    // fields; store_open just wasn't one of the things checked.
    if (settings.store_open === 'false') {
      return NextResponse.json(
        { error: 'Sorry, we are temporarily not accepting orders. Please check back soon.' },
        { status: 503 },
      )
    }

    // BUG FIX (root cause of orders silently splitting across duplicate
    // customer records — see the doc comment on
    // CreateOrderInput.authenticatedCustomerId for the full story): resolve
    // the logged-in customer via the SAME mechanism /api/orders (My Orders)
    // already uses, so checkout and order-listing can never disagree on
    // who the customer is. Best-effort — any failure here (no session,
    // expired token, etc.) just leaves this null and checkout proceeds as
    // a guest, exactly as before this fix.
    let authenticatedCustomerId: string | number | null = null
    let refreshedAuth: { token: string; refresh: string } | null = null
    try {
      let token = getToken(req)
      const refreshed = !token ? await tryRefresh(req) : null
      if (refreshed) { token = refreshed.token; refreshedAuth = refreshed }
      if (token) {
        const user = await sbAuth('/user', null, token)
        const profile = await syncCustomerProfile(user)
        if (profile?.id) authenticatedCustomerId = profile.id
      }
    } catch {
      // Not logged in, or session expired — guest checkout, unaffected.
    }

    const { order, alreadyExists, customerId } = await withTimeout(createOrder({
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
      authenticatedCustomerId,
    }, settings), 10_000)

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

    // BUG FIX (live 504 on checkout): both email sends below used to be awaited
    // directly in the request path. Each has its own internal timeout+retry
    // (up to ~10.4s worst case per email, see lib/server/email.ts), and there
    // are two of them sequentially here (customer confirmation + admin notify)
    // -- worst case ~20s, well past Vercel's default function timeout (this
    // route has no maxDuration override). The order (and loyalty points) are
    // already fully committed by this point; the client was seeing "Order
    // save failed (504)" for orders that had, in fact, saved successfully.
    // Fixed with after() (stable in Next.js 15+, this app is on 16.2.9): the
    // response below returns to the client immediately, and Vercel keeps the
    // function alive in the background just long enough to finish the emails
    // -- same delivery guarantee as before (including the failed_emails
    // dead-letter path), just no longer blocking the user-visible response.
    after(async () => {
      // ── Confirmation email ─────────────────────────────────────────────
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

          // BUG FIX (order-confirmation email showing an emoji instead of the
          // real product photo): i.image was always undefined before —
          // orderService.ts hardcoded `image: null` on every cart item
          // regardless of whether the product actually had a photo (see
          // orderService.ts fix). Now that image is populated, render an
          // actual <img> thumbnail when available and fall back to the emoji
          // only for the rare product with no photo — same fallback most
          // major e-commerce order emails (Amazon, Myntra, BigBasket) use.
          const itemsHtml = emailItems.map(i => {
            const thumb = i.image
              ? `<img src="${esc(i.image)}" width="44" height="44" alt="" style="width:44px;height:44px;border-radius:8px;object-fit:cover;vertical-align:middle;border:1px solid #eee" />`
              : `<span style="display:inline-block;width:44px;height:44px;border-radius:8px;background:#f0f7f4;text-align:center;line-height:44px;font-size:20px;vertical-align:middle">${esc(i.emoji) || '🌿'}</span>`
            return `<tr>
              <td style="padding:10px 0;border-bottom:1px solid #f0f0f0">
                <table style="border-collapse:collapse"><tr>
                  <td style="padding:0 10px 0 0">${thumb}</td>
                  <td>
                    <strong style="color:#1a1a1a">${esc(i.name)}</strong>
                    <span style="color:#888;font-size:13px"> × ${esc(i.qty)}</span>
                  </td>
                </tr></table>
              </td>
              <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:#1a3a1e">
                ₹${(i.price * i.qty).toLocaleString('en-IN')}
              </td>
            </tr>`
          }).join('')

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
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#fff;margin-bottom:3px">HimVeda by Pahadi Roots</div>
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
      <tr><td style="padding:6px 0;color:#555">Subtotal</td><td style="text-align:right;color:#555">₹${(order.subtotal ?? 0).toLocaleString('en-IN')}</td></tr>
      ${(order.discount ?? 0) > 0 ? `<tr><td style="padding:6px 0;color:#2d7a3a">Discount</td><td style="text-align:right;color:#2d7a3a">−₹${(order.discount ?? 0).toLocaleString('en-IN')}</td></tr>` : ''}
      <tr><td style="padding:6px 0;color:#555">Shipping</td><td style="text-align:right;color:#555">${(order.shippingCharge ?? 0) === 0 ? 'FREE' : '₹' + (order.shippingCharge ?? 0).toLocaleString('en-IN')}</td></tr>
      ${(order.codSurcharge ?? 0) > 0 ? `<tr><td style="padding:6px 0;color:#555">COD Charges</td><td style="text-align:right;color:#555">₹${(order.codSurcharge ?? 0).toLocaleString('en-IN')}</td></tr>` : ''}
      <tr><td style="padding:6px 0;color:#555">Payment</td><td style="text-align:right;color:#555">${esc(payLabel)}</td></tr>
      <tr>
        <td style="padding:10px 0 0;font-size:17px;font-weight:900;color:#1a3a1e;border-top:1px solid #f0f0f0">Total</td>
        <td style="text-align:right;padding-top:10px;font-size:17px;font-weight:900;color:#1a3a1e;border-top:1px solid #f0f0f0">₹${order.total_amount.toLocaleString('en-IN')}</td>
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
      🌿 HimVeda by Pahadi Roots — Pure Himalayan Goodness<br>
      <a href="https://www.pahadiroots.com" style="color:#e8b84b;text-decoration:none">pahadiroots.com</a>
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
    })

    const successRes = NextResponse.json(
      { success: true, order_number: order.order_number, order_id: order.id, confirmation_token: order.confirmationToken },
      { status: alreadyExists ? 200 : 201 }
    )
    if (refreshedAuth) applyNewCookies(successRes, refreshedAuth.token, refreshedAuth.refresh)
    return successRes
  } catch (err: unknown) {
    logger.error('orders POST error', { action: 'orders.post', error: err instanceof Error ? err.message : String(err) })

    // P3: a reused idempotency key for a different request. 409 + a stable `code` lets the
    // client mint a fresh key and ask the customer to re-confirm, instead of looping.
    if (err instanceof IdempotencyConflictError) {
      logger.warn('idempotency key reused with a different request', { action: 'idempotency.conflict', reason: err.reason })
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 })
    }
    const internalMessage = err instanceof Error ? err.message : 'Internal server error'

    // BUG FIX (live 504 mitigation — see OrderCreateTimeoutError/withTimeout
    // above for the full incident writeup): a fast, specific 503 instead of
    // silently riding out the remaining time until Vercel's hard 15s kill
    // produces a bare, unexplained 504. Checked first so it can never be
    // misclassified by the generic message-sniffing below.
    if (err instanceof OrderCreateTimeoutError) {
      return NextResponse.json(
        { error: 'Our server is briefly slow right now — please try again in a few seconds.' },
        { status: 503, headers: { 'Retry-After': '5' } },
      )
    }

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
      // BUG FIX [ERROR HANDLING] (found via a live "Order placement failed"
      // report — Vercel logs showed the real reason was a legitimate,
      // user-actionable rejection, not a crash, but the customer only ever
      // saw the generic 500 message): both of these are createOrder()'s own
      // COD guardrails, thrown as plain, perfectly clear messages — they
      // just didn't match any existing substring here, so they fell through
      // to the generic "contact support" 500 like a genuine server crash.
      || lowerMessage.includes('cod is only available')       // per-order COD value cap (cod_max_value)
      || lowerMessage.includes('already in progress')         // active-COD-order count cap (cod_max_active_orders)
      || lowerMessage.includes('coupon')
      || lowerMessage.includes('no longer available')
      || lowerMessage.includes('multiple options')
      || lowerMessage.includes('invalid cart item')
      || lowerMessage.includes('insufficient loyalty balance')
    )
    const status  = isUserFacing ? 409 : 500
    const clientMessage = isUserFacing || process.env.NODE_ENV !== 'production'
      ? internalMessage
      : 'Order placement failed. Please try again or contact support.'
    return NextResponse.json({ error: clientMessage }, { status })
  }
}
