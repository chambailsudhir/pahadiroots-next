import { NextRequest, after } from 'next/server'
import { createOrder, ensureCouponUsageLinked, GuestPhoneRegisteredError, IdempotencyConflictError, LoyaltyAuthRequiredError, OrderOutcomeUnknownError, logOrderEvent, normalizePhoneForLookup, type CreatedOrder } from '@/lib/services/orderService'
import { refreshCatalogIfSoldOut } from '@/lib/server/catalogFreshness'
import { CheckoutRejectedError } from '@/lib/errors/checkoutErrors'
import { makeCodRiskGate } from '@/lib/server/codVerification'
import { getFreshSiteSettings } from '@/lib/getSiteSettings'
import { sendTransactionalEmail } from '@/lib/server/email'
import { buildOrderEmail, orderEmailSubject } from '@/lib/server/orderEmail'
import { adminNotifyAddress } from '@/lib/server/adminNotify'
import { loadAdminOrderEmail, describeOrigin } from '@/lib/server/adminOrderEmail'
import { checkCsrf, sbAuth, sbAdmin, syncCustomerProfile, getToken, tryRefresh, applyNewCookies } from '@/lib/api/serverUtils'
import { privateJson } from '@/lib/api/privateJson'
import { createOrderSchema } from '@/lib/schemas'
// ── Security: server-only imports (build-time guard against client-bundle leaks) ──
import { redeemLoyaltyPoints } from '@/lib/server/loyalty'
import { coinsForOrderValue } from '@/lib/loyaltyCoins'
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
import { clientIpKey } from '@/lib/api/clientIp'
import { releaseOwnAbandonedOnlineOrders } from '@/lib/server/pendingOrders'
import { getServiceClient } from '@/lib/supabase'
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
  return privateJson(
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
  /** Stored GST (written by the DB trigger) and the coins actually charged — the e-mail must show the same figures as the invoice. */
  tax: number | null; loyalty_points_redeemed: number | null
  created_at?: string | null
}

interface RecoveryCouponContext { couponCode: string | null; customerPhone: string | null; authenticatedCustomerId: string | number | null }

/**
 * COM-1 (Nov 2026 audit): when createOrder() outlived this request, the order's coupon claim may still be unlinked
 * (coupon_usage.order_id NULL) — and the 30-minute stale-claim sweep would then free the use. Link it now. Never throws.
 */
async function linkRecoveredCoupon(committed: CommittedOrder, ctx: RecoveryCouponContext | null): Promise<void> {
  if (!ctx?.couponCode) return
  try {
    await ensureCouponUsageLinked({
      orderId:                 committed.id,
      orderCreatedAt:          committed.created_at ?? null,
      couponCode:              ctx.couponCode,
      couponDiscount:          committed.coupon_discount,
      authenticatedCustomerId: ctx.authenticatedCustomerId,
      customerPhone:           ctx.customerPhone,
    })
  } catch (e) {
    captureError(e, { action: 'orders.timeout_recovery_coupon_link', order_id: committed.id, alert: true })
  }
}

async function findCommittedOrder(idempotencyKey: unknown): Promise<CommittedOrder | null> {
  if (typeof idempotencyKey !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(idempotencyKey)) return null
  try {
    const rows = await sbAdmin(
      'GET',
      `/rest/v1/orders?idempotency_key=eq.${idempotencyKey}&select=id,order_number,confirmation_token,total_amount,subtotal,shipping_charge,cod_surcharge,coupon_discount,customer_id,tax,loyalty_points_redeemed,created_at&limit=1`,
    )
    const r = Array.isArray(rows) ? rows[0] : null
    if (!r) return null
    return {
      id: r.id, order_number: r.order_number, confirmation_token: r.confirmation_token ?? null,
      total_amount: Number(r.total_amount) || 0, subtotal: Number(r.subtotal) || 0,
      shipping_charge: Number(r.shipping_charge) || 0, cod_surcharge: Number(r.cod_surcharge) || 0,
      coupon_discount: Number(r.coupon_discount) || 0, customer_id: r.customer_id ?? null,
      created_at: typeof r.created_at === 'string' ? r.created_at : null,
      tax: r.tax != null && Number.isFinite(Number(r.tax)) ? Number(r.tax) : null,
      loyalty_points_redeemed: r.loyalty_points_redeemed != null && Number.isFinite(Number(r.loyalty_points_redeemed)) ? Number(r.loyalty_points_redeemed) : null,
    }
  } catch {
    return null
  }
}

/**
 * Atomically claim the once-only `post_order_finalized` marker (Nov 2026 verification). db_migration_v33 makes it unique per
 * order, so the INSERT is the claim: 'claimed' = this request runs the post-order steps, 'taken' = another request already
 * did (HTTP 409 / 23505), 'error' = the claim could not be written (the caller decides).
 */
async function claimPostOrderMarker(orderId: string, via: string): Promise<'claimed' | 'taken' | 'error'> {
  try {
    await sbAdmin('POST', '/rest/v1/order_events', {
      order_id: orderId, event: 'post_order_finalized', actor: 'system', metadata: { via }, created_at: new Date().toISOString(),
    }, 'return=minimal')
    return 'claimed'
  } catch (e) {
    const x = e as { status?: number; message?: unknown }
    if (x?.status === 409 || /23505|duplicate key/i.test(String(x?.message ?? ''))) return 'taken'
    captureError(e, { action: 'orders.post_order_marker_claim', order_id: orderId, alert: false })
    return 'error'
  }
}

/** Idempotently redeem the coins stored on a committed COD order (R3-1). Never throws; a failure is flagged for ops. */
async function ensureCodCoinsRedeemed(committed: CommittedOrder): Promise<void> {
  const points = Number(committed.loyalty_points_redeemed ?? 0)
  if (!(points > 0) || committed.customer_id == null) return
  let ok = false
  try { ok = await redeemLoyaltyPoints(String(committed.customer_id), String(committed.id), points) } catch { ok = false }
  if (!ok) {
    captureError(new Error('Loyalty redemption failed on recovered COD order — discount granted without deduction'), {
      action: 'orders.cod_loyalty_redeem_failed', order_id: committed.id, points, alert: true,
    })
    await logOrderEvent(String(committed.id), 'loyalty_redeem_failed', 'system', {
      points, needs_ops_review: true, discount_granted: true, via: 'recovery',
    }).catch(() => null)
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
    // R3-1 (Nov 2026): settle the coin deduction BEFORE looking at the once-only marker. The normal path claims the marker and
    // then redeems; a request killed between the two left a replay that saw 'taken' and returned, so the customer kept the
    // coin discount AND the coins, with no alert. redeem_loyalty_points is idempotent per order (an existing 'redeem' row
    // returns true), so running it here as well can never deduct twice. This route only places COD orders.
    await ensureCodCoinsRedeemed(committed)

    // Atomic claim (v33 unique index): of two concurrent replays only one gets the marker and sends the e-mails. Marker FIRST:
    // if the steps below crash half-way we prefer a missing e-mail (the admin sees the alert) over a double one.
    const claim = await claimPostOrderMarker(String(committed.id), 'timeout_recovery')
    if (claim === 'taken') return
    if (claim === 'error') {
      captureError(new Error('post-order marker could not be claimed; recovery skipped to avoid duplicate e-mails'), {
        action: 'orders.timeout_recovery_marker_failed', order_id: committed.id, alert: true,
      })
      return
    }

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

    await finalize({
      id: String(committed.id), order_number: committed.order_number,
      total_amount: committed.total_amount, total: committed.total_amount, status: 'confirmed',
      subtotal: committed.subtotal, shippingCharge: committed.shipping_charge, codSurcharge: committed.cod_surcharge,
      discount: committed.coupon_discount, cartItems, confirmationToken: committed.confirmation_token,
      gstIncluded: committed.tax ?? undefined, loyaltyPointsRedeemed: committed.loyalty_points_redeemed ?? undefined,
    }, false, committed.customer_id != null ? String(committed.customer_id) : null)
  } catch (e) {
    captureError(e, { action: 'orders.timeout_recovery_finalize', order_id: committed.id, alert: true })
  }
}

// not exported: Next.js route modules may only export handlers/config
const COD_PHONE_LIMIT_10M = 8    // generous on purpose: every schema-valid attempt counts, and the phone is attacker-supplied
const COD_IP_LIMIT_10M    = 40    // shared NAT / CGNAT / hostel addresses carry many real customers

export async function POST(req: NextRequest) {
  const requestStartedAt = Date.now()
  // ── CSRF check ─────────────────────────────────────────────────────────────
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  // ── Rate limit: IP-level pre-check (distributed via Upstash KV) ──────────
  // Applied before body parsing so bots are rejected cheaply without DB work.
  const ip = clientIpKey(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim())   // IPv6 collapsed to its /64
  const ipLimit = await checkRateLimitKvStrict(`mw:rl:orders_ip:${ip}`, 10)
  if (ipLimit === 'unavailable') return rateLimiterUnavailable()
  if (ipLimit === 'blocked') {
    return privateJson({ error: 'Too many requests — please wait a moment' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  // ── Body size cap — 64 KB is generous for an order payload ───────────────
  // Without this guard, a client can POST a megabyte of junk, exhausting the
  // lambda's memory before body parsing even starts. The webhook already has
  // this guard (1 MB); order/payment payloads are far smaller in practice.
  const rawContentLength = Number(req.headers.get('content-length'))
  if (Number.isFinite(rawContentLength) && rawContentLength > 65_536) {
    return privateJson({ error: 'Request too large' }, { status: 413 })
  }

  // Remembered outside the try so the catch can look the order up if createOrder() times out (ACC-032).
  let idempotencyKeyForRecovery: unknown = null
  let finalizeForRecovery: ((order: CreatedOrder, alreadyExists: boolean, customerId: string | null) => Promise<void>) | null = null
  // COM-1: what the timeout recovery needs to link the order's coupon claim (see linkRecoveredCoupon).
  let couponForRecovery: RecoveryCouponContext | null = null
  try {
    // A body that is not JSON is the caller's mistake (400), not a server fault (500 — it also raised error alerts for every bot probe).
    const body   = await req.json().catch(() => undefined)
    if (body === undefined) return privateJson({ error: 'Invalid JSON' }, { status: 400 })
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
      return privateJson({ error: 'Invalid request', details: fieldErrors }, { status: 400 })
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
      return privateJson(
        { error: 'Online payments must be started from the payment flow. Please use Pay Online at checkout.' },
        { status: 400 },
      )
    }

    // ── Phone-level rate limit (after parse, so we have the phone number) ──
    // Keyed on the normalised number so "+91 98…" and "98…" share one counter (S1-002/S1-003).
    const phoneLimit = await checkRateLimitKvStrict(`mw:rl:orders_phone:${normalizePhoneForLookup(a.phone) || a.phone}`, 3)
    if (phoneLimit === 'unavailable') return rateLimiterUnavailable()
    if (phoneLimit === 'blocked') {
      return privateJson({ error: 'Too many order attempts — please wait a moment' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    // ── Round-2 audit: the same 10-minute abuse caps the online path got in S1-003 ──────────────────────────────────────────
    // A COD order is `confirmed` at once, decrements stock and never expires, so the per-minute limits alone still let a script
    // reserve the catalogue by rotating phone numbers (10 orders/min/IP). A genuine customer places a handful of orders at most.
    const [phone10m, ip10m] = await Promise.all([
      checkRateLimitKvStrict(`mw:rl:cod_phone10m:${normalizePhoneForLookup(a.phone) || a.phone}`, COD_PHONE_LIMIT_10M, 600),
      checkRateLimitKvStrict(`mw:rl:cod_ip10m:${ip}`, COD_IP_LIMIT_10M, 600),
    ])
    if (phone10m === 'unavailable' || ip10m === 'unavailable') return rateLimiterUnavailable()
    if (phone10m === 'blocked' || ip10m === 'blocked') {
      return privateJson({ error: 'Too many order attempts — please wait a few minutes and try again' }, { status: 429, headers: { 'Retry-After': '600' } })
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
      return privateJson(
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
      // Verification F-1 (Nov 2026): a request that timed out BEFORE the commit landed answered 503; the customer's retry then hit this
      // branch with alreadyExists=true and every post-order step (coupon-redeem, customer + owner e-mail) was skipped forever. The first
      // successful request now writes the `post_order_finalized` marker (below), so a replay without that marker is exactly the
      // "committed but never finalised" case and is finished here — once — through the same recovery path the timeout catch uses.
      if (alreadyExists) {
        const committed = await findCommittedOrder(d.idempotency_key)
        if (committed) await finalizeRecoveredOrder(committed, finalizeOrder)
        return
      }
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
          // No coins at placement: they are paid when the order is DELIVERED (database trigger) and taken back on return / refund.
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
              ? coinsForOrderValue(order.total_amount, settings)   // announced as "up to", paid on delivery
              : 0
            // Verification F-6: orders.tax is computed by a database trigger (paise-exact, coupon-net, fee GST); the app's whole-rupee
            // figure could differ by up to ₹0.50 from the invoice. Read the stored figure back for the e-mail; fall back if unreadable.
            const storedTax = order.gstIncluded != null && Number.isFinite(Number(order.gstIncluded)) && String(order.id).length > 0
              ? await sbAdmin('GET', `/rest/v1/orders?id=eq.${encodeURIComponent(String(order.id))}&select=tax&limit=1`)
                  .then((rows: Array<{ tax?: unknown }> | null) => Number(rows?.[0]?.tax)).catch(() => Number.NaN)
              : Number.NaN
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
              gstIncluded: Number.isFinite(storedTax) ? storedTax : (order.gstIncluded ?? 0),
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
        const adminTo = adminNotifyAddress(settings)
        if (!adminTo) {
          // Verification L-4: silently skipping is how the owner once received no new-order mail for weeks. Alert, every order.
          captureError(new Error('No owner notification address: set site_settings.admin_notify_email or the ADMIN_EMAIL env var'), {
            action: 'orders.email.admin.no_recipient', order_id: order.id, alert: true,
          })
        }
        if (adminTo && !alreadyExists) {
          try {
            // Where the order came from (city + device, no IP) is recorded once and read back by the owner mail, which is built from
            // the stored order so it always matches the database.
            const originText = describeOrigin(req.headers)
            if (originText) await logOrderEvent(order.id, 'order_origin', 'system', { origin: originText }).catch(() => null)
            const built = await loadAdminOrderEmail(getServiceClient(), order.id, { kind: 'cod' }).catch(() => null)
            const coinsLine = (d.loyalty_points_redeemed ?? 0) > 0
              ? ` | Coins redeemed: ${d.loyalty_points_redeemed}` : ''
            await sendTransactionalEmail({
              type:    'admin_order_notify',
              to:      adminTo,
              subject: built?.subject ?? `New ${d.payment_method.toUpperCase()} Order #${order.order_number} - Rs.${order.total_amount}`,
              // All user-supplied fields are escaped inside buildAdminOrderEmail(). The one-line fallback below is only used if the
              // order could not be read back (it still escapes everything).
              html:    built?.html ?? `<p>Order: <b>#${esc(order.order_number)}</b><br>Customer: ${esc(name)} (+91${esc(a.phone)})<br>City: ${esc(city)}, ${esc(state)}<br>Total: Rs.${order.total_amount}<br>Payment: ${esc(d.payment_method)}${esc(coinsLine)}</p>`,
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

    // A signed-in customer who closed the Razorpay modal and switched to COD (new key) must not be blocked by their own abandoned
    // online order's coupon / coins / stock: release it first (Razorpay is asked, so a paid order is never released). Best effort.
    if (authenticatedCustomerId != null) {
      try {
        await releaseOwnAbandonedOnlineOrders(getServiceClient(), authenticatedCustomerId, { excludeIdempotencyKey: d.idempotency_key })
      } catch { /* never blocks order creation */ }
    }

    couponForRecovery = { couponCode: d.coupon_code ?? null, customerPhone: a.phone, authenticatedCustomerId: authenticatedCustomerId ?? null }
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
      // Risky-COD gate (Nov 2026): refused after an earlier COD refusal on this phone; first / large COD orders need the code.
      codRiskGate: makeCodRiskGate({ sb: sbAdmin, settings: settings as unknown as Record<string, string | undefined>, token: d.cod_verification_token }),
    }, settings), (() => {
      const budget = orderRouteBudgetMs()
      return Math.max(Math.min(8_000, budget), budget - (Date.now() - requestStartedAt))
    })())

    // F-1: the marker the replay / recovery paths check, claimed atomically BEFORE the post-order steps (Nov 2026 verification:
    // it used to be written after them, so a replay arriving while coins were being redeemed found no marker and sent the
    // e-mails a second time). Never before createOrder returned, so a key whose first request died inside createOrder still
    // finalises on retry. A failed claim (not a conflict) still runs the steps: the normal path must not lose its e-mails.
    if (alreadyExists || (await claimPostOrderMarker(order.id, 'request')) !== 'taken') {
      await finalizeOrder(order, alreadyExists, customerId)
    }
    // OPS-001: housekeeping (expire abandoned online orders, retry failed e-mails) — throttled, after the response, never fatal.
    const sweepOrigin = new URL(req.url).origin
    after(() => runBackgroundSweepsIfDue(sweepOrigin).then(() => undefined))

    const successRes = privateJson(
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
      return privateJson({ error: err.message, code: err.code }, { status: 409 })
    }
    // AUDIT S1-002: redeeming coins without a verified session is refused, not silently ignored.
    // Nov 2026 audit: a guest used a registered account's mobile number — ask them to sign in.
    if (err instanceof GuestPhoneRegisteredError) {
      return privateJson({ error: err.message, code: err.code }, { status: 409 })
    }
    if (err instanceof LoyaltyAuthRequiredError) {
      return privateJson({ error: err.message, code: err.code }, { status: 401 })
    }
    // AUDIT S1-005/S1-006: the order may have committed; nothing was undone. Same retry contract as
    // the route-level timeout below — the idempotency key makes the retry safe.
    if (err instanceof OrderOutcomeUnknownError) {
      const committed = await findCommittedOrder(idempotencyKeyForRecovery)
      if (committed) {
        logger.warn('orders: outcome-unknown resolved — order was committed', { action: 'orders.recovered', order_id: committed.id, order_number: committed.order_number })
        await linkRecoveredCoupon(committed, couponForRecovery)
        await finalizeRecoveredOrder(committed, finalizeForRecovery)
        return privateJson({ success: true, order_number: committed.order_number, order_id: committed.id, confirmation_token: committed.confirmation_token }, { status: 200 })
      }
      return privateJson({ error: err.message, code: err.code }, { status: 503, headers: { 'Retry-After': '5' } })
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
        await linkRecoveredCoupon(committed, couponForRecovery)
        await finalizeRecoveredOrder(committed, finalizeForRecovery)
        return privateJson({ success: true, order_number: committed.order_number, order_id: committed.id, confirmation_token: committed.confirmation_token }, { status: 200 })
      }
      return privateJson(
        { error: 'Our server is briefly slow right now — please try again in a few seconds.' },
        { status: 503, headers: { 'Retry-After': '5' } },
      )
    }

    // SEC-4: expose customer-actionable refusals (stock, coupon, COD caps, minimum order, unavailable
    // product, loyalty shortfall, serviceability…) so the customer can act on them, but never raw
    // DB/RPC/infra messages — they leak table names, constraint names and Supabase internals.
    // Security audit (Nov 2026): this used to be decided by sniffing the message for words like
    // "coupon"/"stock" (with a StockReservationError exclusion), which still leaked e.g.
    // `coupon claim failed: <postgres detail>` or `coupon fetch timed out after 8000ms` as 409s.
    // Only the typed CheckoutRejectedError (customer-safe message by construction) is shown now;
    // StockReservationError and every other failure is a 500 with the generic message in production.
    if (err instanceof CheckoutRejectedError) {
      // `code` lets the checkout react (e.g. open the verification step for COD_VERIFICATION_REQUIRED). Codes are a fixed list.
      return privateJson({ error: err.message, code: err.code }, { status: 409 })
    }
    const status  = 500
    const clientMessage = process.env.NODE_ENV !== 'production'
      ? internalMessage
      : 'Order placement failed. Please try again or contact support.'
    return privateJson({ error: clientMessage }, { status })
  }
}
