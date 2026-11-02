import { NextRequest, NextResponse, after } from 'next/server'
import { createOrder, GuestPhoneRegisteredError, IdempotencyConflictError, LoyaltyAuthRequiredError, OrderOutcomeUnknownError, logOrderEvent, normalizePhoneForLookup, type CreatedOrder } from '@/lib/services/orderService'
import { refreshCatalogIfSoldOut } from '@/lib/server/catalogFreshness'
import { StockReservationError } from '@/lib/services/inventoryService'
import { getFreshSiteSettings } from '@/lib/getSiteSettings'
import { sendTransactionalEmail } from '@/lib/server/email'
import { buildOrderEmail, orderEmailSubject } from '@/lib/server/orderEmail'
import { checkCsrf, sbAuth, sbAdmin, syncCustomerProfile, getToken, tryRefresh, applyNewCookies } from '@/lib/api/serverUtils'
import { createOrderSchema } from '@/lib/schemas'
// ── Security: server-only imports (build-time guard against client-bundle leaks) ──
import { awardLoyaltyPoints, redeemLoyaltyPoints } from '@/lib/server/loyalty'
import { esc } from '@/lib/server/htmlEscape'
// REFACTOR: replaced two inline checkOrderIpLimit / checkOrderPhoneLimit functions
// (~80 lines of duplicated Upstash boilerplate) with the shared helper.
// Keys are unchanged so all existing middleware counters are preserved.
// AUDIT S1-016(a): order creation is a mutation — the limiter fails CLOSED (503) when it cannot decide.
import { checkRateLimitKvStrict, RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SEC } from '@/lib/api/rateLimitKv'
import { logger, captureError } from '@/lib/logger'
// REFACTOR: inline sanitize() extracted to shared lib/server/sanitize.ts.
// Was duplicated in payments/route.ts — single source of truth now.
import { sanitize } from '@/lib/server/sanitize'
import { isStoreOpen } from '@/lib/siteSettingsHelpers'
import { runBackgroundSweepsIfDue } from '@/lib/server/backgroundSweeps'
// The one source for every delivery / notification sentence (lib/shippingCopy). The confirmation e-mail used to compute its own
// optimistic 'estimated delivery' date (5 business days from today + 2) that contradicted the published policy.
import { DELIVERY_WINDOWS_TEXT, TRACKING_NOTIFICATION_TEXT } from '@/lib/shippingCopy'

// NOTE: createOrderSchema (imported from @/lib/schemas) is the canonical validation
// schema for this route. coupon_code is accepted but the DISCOUNT is never trusted
// from the client — createOrder() re-validates and recomputes server-side.


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

/** AUDIT S1-016(a): neither KV nor the DB fallback could count — refuse briefly instead of creating uncapped orders. */
function rateLimiterUnavailable() {
  return NextResponse.json(
    { error: 'Our server is briefly busy — please try again in a few seconds.' },
    { status: 503, headers: { 'Retry-After': String(RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SEC) } },
  )
}
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new OrderCreateTimeoutError()), ms)
    }),
  ])
}

// AUDIT ACC-032 — a successful order must never be reported as a failure.
// The route used to abandon createOrder() after a flat 10 s and answer 503 "server briefly slow",
// while the RPC kept running and COMMITTED the order a few seconds later (observed: 503 at ~32 s,
// order row created right after). The customer saw an error for an order that exists.
//   1. The budget is now measured from the START of the request (the pre-steps — rate limiter,
//      session refresh, profile sync — each cost seconds when the database is slow), capped to stay
//      inside vercel.json's maxDuration (40 s) with room to answer.
//   2. If the budget is still exceeded, look the order up by its idempotency key before giving up.
//      A hit is returned as a success (same JSON shape, 200); only a genuine miss is a 503.
// Read per request so tests (and ops, via ORDER_CREATE_BUDGET_MS) can shorten it; default 34 s.
function orderRouteBudgetMs(): number {
  const n = Number(process.env.ORDER_CREATE_BUDGET_MS)
  return Number.isFinite(n) && n > 0 ? n : 34_000
}

interface CommittedOrder {
  id: number | string; order_number: string; confirmation_token: string | null
  total_amount: number; subtotal: number; shipping_charge: number; cod_surcharge: number; coupon_discount: number
  customer_id: number | string | null
}

async function findCommittedOrder(idempotencyKey: unknown): Promise<CommittedOrder | null> {
  if (typeof idempotencyKey !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(idempotencyKey)) return null
  try {
    const rows = await sbAdmin(
      'GET',
      `/rest/v1/orders?idempotency_key=eq.${idempotencyKey}&select=id,order_number,confirmation_token,total_amount,subtotal,shipping_charge,cod_surcharge,coupon_discount,customer_id&limit=1`,
    )
    const r = Array.isArray(rows) ? rows[0] : null
    if (!r) return null
    return {
      id: r.id, order_number: r.order_number, confirmation_token: r.confirmation_token ?? null,
      total_amount: Number(r.total_amount) || 0, subtotal: Number(r.subtotal) || 0,
      shipping_charge: Number(r.shipping_charge) || 0, cod_surcharge: Number(r.cod_surcharge) || 0,
      coupon_discount: Number(r.coupon_discount) || 0, customer_id: r.customer_id ?? null,
    }
  } catch {
    return null
  }
}

/**
 * The request died before the post-order steps ran. Run them now for the committed order — once.
 * `post_order_finalized` in order_events is the once-only marker (the e-mails have no natural idempotency key).
 * Never throws: the customer must still be told their order exists.
 */
async function finalizeRecoveredOrder(
  committed: CommittedOrder,
  finalize: ((order: CreatedOrder, alreadyExists: boolean, customerId: string | null) => Promise<void>) | null,
): Promise<void> {
  if (!finalize) return
  try {
    const done = await sbAdmin('GET', `/rest/v1/order_events?order_id=eq.${committed.id}&event=eq.post_order_finalized&select=id&limit=1`)
    if (Array.isArray(done) && done.length > 0) return

    const items = await sbAdmin(
      'GET',
      `/rest/v1/order_items?order_id=eq.${committed.id}&select=quantity,price_at_time,product_name_snapshot,variant_value_snapshot,products(emoji,image_url)`,
    ).catch(() => [])
    const cartItems = (Array.isArray(items) ? items : []).map((i: {
      quantity: number; price_at_time: number; product_name_snapshot: string | null; variant_value_snapshot: string | null
      products?: { emoji?: string | null; image_url?: string | null } | null
    }) => ({
      name:  [i.product_name_snapshot, i.variant_value_snapshot].filter(Boolean).join(' · ') || 'Item',
      emoji: i.products?.emoji || '🌿',
      image: i.products?.image_url ?? null,
      qty:   Number(i.quantity) || 1,
      price: Number(i.price_at_time) || 0,
    }))

    // Marker FIRST: if the steps below crash half-way we prefer a missing e-mail (the admin sees the alert) over a double one.
    await logOrderEvent(String(committed.id), 'post_order_finalized', 'system', { via: 'timeout_recovery' })

    await finalize({
      id: String(committed.id), order_number: committed.order_number,
      total_amount: committed.total_amount, total: committed.total_amount, status: 'confirmed',
      subtotal: committed.subtotal, shippingCharge: committed.shipping_charge, codSurcharge: committed.cod_surcharge,
      discount: committed.coupon_discount, cartItems, confirmationToken: committed.confirmation_token,
    }, false, committed.customer_id != null ? String(committed.customer_id) : null)
  } catch (e) {
    captureError(e, { action: 'orders.timeout_recovery_finalize', order_id: committed.id, alert: true })
  }
}

export async function POST(req: NextRequest) {
  const requestStartedAt = Date.now()
  // ── CSRF check ─────────────────────────────────────────────────────────────
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  // ── Rate limit: IP-level pre-check (distributed via Upstash KV) ──────────
  // Applied before body parsing so bots are rejected cheaply without DB work.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ipLimit = await checkRateLimitKvStrict(`mw:rl:orders_ip:${ip}`, 10)
  if (ipLimit === 'unavailable') return rateLimiterUnavailable()
  if (ipLimit === 'blocked') {
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

  // Remembered outside the try so the catch can look the order up if createOrder() times out (ACC-032).
  let idempotencyKeyForRecovery: unknown = null
  let finalizeForRecovery: ((order: CreatedOrder, alreadyExists: boolean, customerId: string | null) => Promise<void>) | null = null
  try {
    const body   = await req.json()
    idempotencyKeyForRecovery = (body as { idempotency_key?: unknown } | null)?.idempotency_key ?? null
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
    // Keyed on the normalised number so "+91 98…" and "98…" share one counter (S1-002/S1-003).
    const phoneLimit = await checkRateLimitKvStrict(`mw:rl:orders_phone:${normalizePhoneForLookup(a.phone) || a.phone}`, 3)
    if (phoneLimit === 'unavailable') return rateLimiterUnavailable()
    if (phoneLimit === 'blocked') {
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
    if (!isStoreOpen(settings)) {
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

    // AUDIT ACC-032 (follow-up): everything that must happen once an order EXISTS — COD loyalty redeem/award,
    // the customer + admin e-mails and the catalogue refresh — lives in this one function, so the normal path and the
    // timeout-recovery path (below, in the catch) run exactly the same steps. Loyalty RPCs are idempotent per order
    // (award/redeem skip an order that already has an 'earn'/'redeem' row) and the recovery path guards the e-mails
    // with an order_events marker, so running it twice can never double-pay points or double-send mail.
    const finalizeOrder = async (order: CreatedOrder, alreadyExists: boolean, customerId: string | null): Promise<void> => {
      // ── Loyalty redemption (COD only — Razorpay handled at verify_payment) ──
      if (!alreadyExists && d.payment_method === 'cod') {
        // customerId comes directly from createOrder() return value — no need for
        // the unsafe (order as any).customer_id fallback (order doesn't carry that field).
        const cid = customerId
        if (cid) {
          // Use the coins STORED on the order (post-clamp), not the raw request value.
          const pointsToRedeem = order.loyaltyPointsRedeemed ?? d.loyalty_points_redeemed ?? 0
          if (pointsToRedeem > 0) {
            const redeemed = await redeemLoyaltyPoints(cid, order.id, pointsToRedeem)
            if (!redeemed) {
              // The order is committed WITH the discount but the deduction failed (balance race / timeout).
              // Stronger than an alert (Nov 2026 audit #3): record a durable, queryable event flagged for
              // ops. createOrder also counts an open COD order with coins and no 'redeem' ledger row as
              // HELD, so those coins cannot back a second discount while ops resolves this one.
              captureError(new Error('Loyalty redemption failed on COD order — discount granted without deduction'), {
                action: 'orders.cod_loyalty_redeem_failed', order_id: order.id, points: pointsToRedeem, alert: true,
              })
              await logOrderEvent(order.id, 'loyalty_redeem_failed', 'system', {
                points: pointsToRedeem, needs_ops_review: true, discount_granted: true,
              }).catch(() => null)
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
            // One shared, itemised template for COD and online orders (lib/server/orderEmail.ts). Coins are mentioned ONLY for a
            // signed-in customer — a guest has no account to spend them in.
            const coinsEarned = authenticatedCustomerId != null && settings.loyalty_enabled !== 'false'
              ? Math.floor(order.total_amount * parseFloat(settings.loyalty_points_per_rupee || '1'))
              : 0
            const emailHtml = buildOrderEmail({
              kind: d.payment_method === 'cod' ? 'cod' : 'paid',
              orderNumber: order.order_number,
              customerName: name,
              items: (order.cartItems ?? []).map(i => ({ name: i.name, variant: i.variant, qty: i.qty, price: i.price, image: i.image, emoji: i.emoji })),
              subtotal: order.subtotal ?? 0,
              couponDiscount: order.discount ?? 0,
              prepaidDiscount: order.prepaidDiscount ?? 0,
              loyaltyDiscount: order.loyaltyDiscount ?? 0,
              shipping: order.shippingCharge ?? 0,
              codSurcharge: order.codSurcharge ?? 0,
              gstIncluded: order.gstIncluded ?? 0,
              total: order.total_amount,
              address: { name, line1: flat, line2: area, city, state, pincode: a.pincode, phone: a.phone },
              deliveryText: DELIVERY_WINDOWS_TEXT,
              trackingText: TRACKING_NOTIFICATION_TEXT,
              coinsEarned,
              signedIn: authenticatedCustomerId != null,
            })

            // AUDIT FIX [ERROR HANDLING]: sendTransactionalEmail() checks the resolved Resend `error` explicitly and dead-letters
            // into `failed_emails` for the cron sweep to retry (the SDK resolves, never rejects, on API-level failures).
            await sendTransactionalEmail({
              type:    'order_confirmation',
              to:      customerEmail,
              subject: orderEmailSubject(d.payment_method === 'cod' ? 'cod' : 'paid', order.order_number),
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

      // Homepage/listing cards are ISR-cached: if this order just sold a variant out, regenerate
      // them now instead of waiting for the 5-minute window (see lib/server/catalogFreshness.ts).
      // Deferred so the customer's response is never delayed; skipped for idempotent replays.
      if (!alreadyExists) {
        const orderedVariantIds = (d.items ?? []).map((i: { variantId: string }) => i.variantId)
        try { after(() => { void refreshCatalogIfSoldOut(orderedVariantIds) }) } catch { /* outside a request scope (unit tests) */ }
      }
    }
    finalizeForRecovery = finalizeOrder

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
    }, settings), (() => {
      const budget = orderRouteBudgetMs()
      return Math.max(Math.min(8_000, budget), budget - (Date.now() - requestStartedAt))
    })())

    await finalizeOrder(order, alreadyExists, customerId)
    // OPS-001: housekeeping (expire abandoned online orders, retry failed e-mails) — throttled, after the response, never fatal.
    const sweepOrigin = new URL(req.url).origin
    after(() => runBackgroundSweepsIfDue(sweepOrigin).then(() => undefined))

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
    // AUDIT S1-002: redeeming coins without a verified session is refused, not silently ignored.
    // Nov 2026 audit: a guest used a registered account's mobile number — ask them to sign in.
    if (err instanceof GuestPhoneRegisteredError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 })
    }
    if (err instanceof LoyaltyAuthRequiredError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 401 })
    }
    // AUDIT S1-005/S1-006: the order may have committed; nothing was undone. Same retry contract as
    // the route-level timeout below — the idempotency key makes the retry safe.
    if (err instanceof OrderOutcomeUnknownError) {
      const committed = await findCommittedOrder(idempotencyKeyForRecovery)
      if (committed) {
        logger.warn('orders: outcome-unknown resolved — order was committed', { action: 'orders.recovered', order_id: committed.id, order_number: committed.order_number })
        await finalizeRecoveredOrder(committed, finalizeForRecovery)
        return NextResponse.json({ success: true, order_number: committed.order_number, order_id: committed.id, confirmation_token: committed.confirmation_token }, { status: 200 })
      }
      return NextResponse.json({ error: err.message, code: err.code }, { status: 503, headers: { 'Retry-After': '5' } })
    }
    const internalMessage = err instanceof Error ? err.message : 'Internal server error'

    // BUG FIX (live 504 mitigation — see OrderCreateTimeoutError/withTimeout
    // above for the full incident writeup): a fast, specific 503 instead of
    // silently riding out the remaining time until Vercel's hard 15s kill
    // produces a bare, unexplained 504. Checked first so it can never be
    // misclassified by the generic message-sniffing below.
    if (err instanceof OrderCreateTimeoutError) {
      // ACC-032: the RPC usually finishes a moment after we stop waiting. Check before reporting failure.
      const committed = await findCommittedOrder(idempotencyKeyForRecovery)
      if (committed) {
        // The loyalty award and the confirmation / admin e-mails normally run right after createOrder() returns,
        // which this request never reached — run them now, once, then tell the customer their order exists.
        logger.warn('orders: create budget exceeded — order was committed, recovering', { action: 'orders.timeout_recovered', order_id: committed.id, order_number: committed.order_number })
        await finalizeRecoveredOrder(committed, finalizeForRecovery)
        return NextResponse.json({ success: true, order_number: committed.order_number, order_id: committed.id, confirmation_token: committed.confirmation_token }, { status: 200 })
      }
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
      || lowerMessage.includes('required to redeem')           // loyalty_min_redeem
      || lowerMessage.includes('minimum order is')          // admin min_order_amount
      || lowerMessage.includes('online payment is not available')
      || lowerMessage.includes('cannot be paid online')
      || lowerMessage.includes('we do not deliver')           // F-09 serviceability refusal
    )
    const status  = isUserFacing ? 409 : 500
    const clientMessage = isUserFacing || process.env.NODE_ENV !== 'production'
      ? internalMessage
      : 'Order placement failed. Please try again or contact support.'
    return NextResponse.json({ error: clientMessage }, { status })
  }
}
