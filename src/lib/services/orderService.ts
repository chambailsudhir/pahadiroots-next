import { captureError, logger } from '@/lib/logger'
import crypto from 'crypto'
// ─────────────────────────────────────────────────────────────
// orderService — orders API calls
//
// Features:
//  ✅ Server-side pagination (?page=&limit=)
//  ✅ Server-side search (?search=&status=)
//  ✅ Retry with exponential backoff
//  ✅ Zod schema validation
//  ✅ Independent of React — testable
// ─────────────────────────────────────────────────────────────
import { z } from 'zod'
import { ServiceError } from './profileService'

// ── Zod Schema ───────────────────────────────────────────────
const OrderItemSchema = z.object({
  qty:       z.number(),
  price:     z.number(),
  name:      z.string(),
  emoji:     z.string(),
  image_url: z.string().nullable(),
  variant:   z.string().nullable().optional(),
})

export const OrderSchema = z.object({
  id:              z.union([z.string(), z.number()]),
  order_number:    z.string(),
  order_status:    z.string(),
  _displayStatus:  z.string(),
  payment_method:  z.string().nullable(),
  payment_status:  z.string().nullable(),
  total_amount:    z.number(),
  created_at:      z.string(),
  tracking_number: z.string().nullable(),
  courier:         z.string().nullable(),
  shipped_at:      z.string().nullable(),
  delivered_at:    z.string().nullable(),
  updated_at:      z.string().nullable().optional(),
  items:           z.array(OrderItemSchema),
  _return:         z.unknown().nullable(),
})

const OrdersResponseSchema = z.object({
  success: z.boolean(),
  orders:  z.array(OrderSchema),
  total:   z.number().optional(),
  page:    z.number().optional(),
  pages:   z.number().optional(),
  stats:   z.object({
    delivered: z.number(),
    active:    z.number(),
    cancelled: z.number(),
    spent:     z.number(),
  }).optional(),
})

export type Order          = z.infer<typeof OrderSchema>
export type OrdersResponse = z.infer<typeof OrdersResponseSchema>

export interface FetchOrdersParams {
  page?:   number
  limit?:  number
  search?: string
  status?: string
  signal?: AbortSignal
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 800): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try { return await fn() } catch (err: unknown) {
      lastErr = err
      if (err instanceof ServiceError && err.status && err.status < 500) throw err
      if (i < retries - 1) await new Promise(r => setTimeout(r, delayMs * 2 ** i))
    }
  }
  throw lastErr
}

// BUG FIX: the Supabase JS SDK's PostgrestBuilder (db.from(...), db.rpc(...))
// does not support AbortSignal or any built-in timeout — confirmed by the
// same issue already fixed in getSiteSettings.ts. Every raw `db.*` call in
// this file previously had no timeout protection at all, unlike sbGet/
// sbPost/sbGetOne (which all correctly use AbortSignal.timeout(8_000)).
// A slow/unresponsive Supabase instance could hang any of these calls
// indefinitely, consuming the entire Vercel function timeout with nothing
// left for the rest of order creation — exactly the failure mode that
// caused live 504s during checkout. This wraps any Supabase JS SDK call
// in the same Promise.race timeout pattern, so it fails fast and
// predictably instead of hanging.
function withTimeout<T>(promise: PromiseLike<T>, ms = 8_000, label = 'db call'): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ])
}

export async function fetchOrders(params: FetchOrdersParams = {}): Promise<OrdersResponse> {
  const { page = 1, limit = 20, search = '', status = '', signal } = params
  const qs = new URLSearchParams({
    page: String(page), limit: String(limit),
    ...(search ? { search } : {}),
    ...(status && status !== 'all' ? { status } : {}),
  })
  const timeoutCtrl    = new AbortController()
  // BUG FIX (LOW): 15 s is too long for a client-side UI call — users see a
  // loading spinner for 15 s before an error. 8 s matches the server-side
  // Supabase budget (AbortSignal.timeout(8_000) in sbGet/sbGetOne) so the
  // outer timeout fires at the same point the inner DB call would.
  const timeoutId      = setTimeout(() => timeoutCtrl.abort(new Error('Timeout')), 8_000)
  const onCallerAbort  = () => timeoutCtrl.abort(signal?.reason)
  signal?.addEventListener('abort', onCallerAbort)

  try {
    const raw = await withRetry(async () => {
      const res  = await fetch(`/api/orders?${qs}`, { signal: timeoutCtrl.signal })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new ServiceError(
        (data as { error?: string }).error || `Orders fetch failed (${res.status})`, res.status
      )
      return data
    })

    const parsed = OrdersResponseSchema.safeParse(raw)
    if (!parsed.success) {
      captureError(parsed.error, { action: 'orderService/fetchOrders', validation: true })
      return { success: true, orders: [], total: 0, page: 1, pages: 0 }
    }
    return parsed.data
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onCallerAbort)
  }
}

// ─────────────────────────────────────────────────────────────
// SERVER-SIDE ORDER FUNCTIONS
// Used by: /api/v1/orders, /api/v1/payments, /api/v1/webhook
// These run only on the server (Node.js) — not in the browser
// ─────────────────────────────────────────────────────────────
import type { SiteSettings } from '@/types'
import { getServiceClient } from '@/lib/supabase'
import { reserveStockAtomicForOrder } from './inventoryService'
import { calcPriceSummary } from './pricingService'

// ── Module-level Supabase REST helpers ───────────────────────
// Declared once here so createOrder() doesn't re-create closures
// and duplicate env-var reads on every invocation.
// BUG FIX: previously declared as SUPABASE_URL + SUPABASE_URL2 and
// SERVICE_KEY + SERVICE_KEY2 inside the function body — identical
// values, allocated on every call.
// BUG FIX (LOW): previously declared as functions (_sbUrl / _sbSvcKey) so
// process.env was read on every sbGet/sbPost/sbGetOne call. Env vars are set
// once at cold-start and never change — declaring as constants reads each var
// exactly once and gives V8 a stable reference to inline into callers.
const _sbUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL!
const _sbSvcKey = process.env.SUPABASE_SERVICE_KEY!

async function sbGet(table: string, query: string) {
  const res = await fetch(`${_sbUrl}/rest/v1/${table}?${query}`, {
    headers: { apikey: _sbSvcKey, Authorization: `Bearer ${_sbSvcKey}` },
    // BUG FIX: no timeout was set — a slow Supabase response would hang this
    // serverless function until Vercel's hard 15-second limit fired, blocking
    // order creation entirely. 8 s matches sbAdmin in serverUtils.ts.
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => res.status.toString())
    throw new Error(`DB fetch ${table} failed: ${txt}`)
  }
  return res.json()
}

async function sbPost(table: string, query: string, body: object, method = 'POST') {
  const res = await fetch(`${_sbUrl}/rest/v1/${table}${query ? '?' + query : ''}`, {
    method,
    headers: {
      apikey:         _sbSvcKey,
      Authorization:  `Bearer ${_sbSvcKey}`,
      'Content-Type': 'application/json',
      Prefer:         method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: JSON.stringify(body),
    // BUG FIX: no timeout — slow Supabase hangs the lambda until Vercel's 15 s hard limit.
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => res.status.toString())
    throw new Error(`DB ${method} ${table} failed: ${txt}`)
  }
  return method === 'POST' ? res.json() : null
}

async function sbGetOne(table: string, query: string) {
  const res = await fetch(`${_sbUrl}/rest/v1/${table}?${query}`, {
    headers: { apikey: _sbSvcKey, Authorization: `Bearer ${_sbSvcKey}` },
    // BUG FIX: no timeout — slow Supabase hangs the lambda until Vercel's 15 s hard limit.
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) return null
  const rows = await res.json()
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
}
// ─────────────────────────────────────────────────────────────

export interface CreateOrderInput {
  customerName:   string
  customerPhone:  string
  customerEmail?: string
  flat:           string
  area:           string
  city:           string
  state:          string
  pincode:        string
  label?:         string
  items:          Array<{ productId: string; variantId: string; qty: number }>
  paymentMethod:  'cod' | 'razorpay'
  couponCode?:    string
  idempotencyKey: string
  loyaltyPointsRedeemed?: number
}

export interface OrderEmailItem {
  name:  string
  emoji: string
  qty:   number
  price: number  // price per unit
}

export interface CreatedOrder {
  id:           string
  order_number: string
  total_amount: number
  total:        number
  status:       string
  cartItems:    OrderEmailItem[]  // enriched items for email — real names + prices from DB
  // Guest-safe capability token for the order-success confirmation page —
  // null when token generation failed (non-fatal) or for the idempotency
  // "already exists" path (see db_migration_v6_order_confirmation_token.sql).
  confirmationToken: string | null
}

export async function createOrder(
  input: CreateOrderInput,
  settings: SiteSettings,
): Promise<{ order: CreatedOrder; alreadyExists: boolean; customerId: string | null }> {
  const db = getServiceClient()

  // 1. Idempotency check — return existing order if same key
  const { data: existing } = await withTimeout(
    db.from('orders')
      .select('id, order_number, total_amount, order_status, confirmation_token')
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle(),
    8_000,
    'orders idempotency check',
  )

  if (existing) {
    return {
      order: {
        id:           existing.id,
        order_number: existing.order_number,
        total_amount: existing.total_amount,
        total:        existing.total_amount,
        status:       existing.order_status,
        cartItems:    [], // not needed — email is skipped when alreadyExists is true
        confirmationToken: existing.confirmation_token ?? null,
      },
      alreadyExists: true,
      customerId:    null,
    }
  }

  // 2. Atomic stock reservation — replaces the old read-only checkStockAvailability.
  //
  // RACE CONDITION FIX: the previous pattern did SELECT available_stock, then checked
  // qty client-side, then created the order separately.  Two concurrent checkouts for
  // the last unit both passed the read-check and both created orders → stock went to -1.
  //
  // We now call reserve_stock_at_order / reserve_product_stock_at_order, which execute:
  //   UPDATE product_variants
  //   SET    available_stock = available_stock - qty
  //   WHERE  id = $1 AND is_active AND available_stock >= qty
  // PostgreSQL's row-level locking guarantees only one concurrent UPDATE wins when
  // available_stock = 1.  The loser gets rows_updated = 0 → we throw before order insert.
  //
  // Stock is restored (restoreStock) on cancellation or if any subsequent step fails.
  //
  // NOTE: reserveStockAtomicForOrder() now THROWS StockReservationError for
  // genuine DB/infra failures (bad param types, RLS, connection errors) rather
  // than returning { ok: false } for them. It only returns { ok: false } when
  // the database explicitly evaluated available_stock < qty. This means the
  // "Insufficient stock" message below is now ONLY ever shown for real stock
  // shortfalls — infra failures surface as a 500 via StockReservationError
  // instead of masquerading as a customer-actionable stock message.
  const stockReservation = await reserveStockAtomicForOrder(
    input.items.map(i => ({ variantId: i.variantId, productId: i.productId, qty: i.qty }))
  )
  if (!stockReservation.ok) {
    throw new Error(`Insufficient stock for item ${stockReservation.failedVariantId ?? 'unknown'} — please reduce quantity or remove the item`)
  }

  // ── STOCK SAFETY WRAPPER ─────────────────────────────────────────────────
  // Everything from here to the final return runs inside try/finally.
  // If ANY step throws — bad product ID, coupon expired, customer creation
  // failure, loyalty shortfall, RPC error — the stock we atomically decremented
  // above is restored in the finally block.
  //
  // The guard is: newOrder===null means the DB transaction never committed →
  // safe to restore.  Once newOrder is set the order owns those units and we
  // must not touch stock again.
  let newOrder: { id: string; order_number: string; total_amount: number; order_status: string } | null = null

  try {

  // 3. Fetch prices via direct REST API (same pattern as store-data route — proven working)
  // Split items: those with a real variant ID vs those using product ID as fallback
  // (variantId === productId means the product has no variants)
  const itemsWithVariant: typeof input.items = []
  const itemsNoVariant:   typeof input.items = []
  for (const item of input.items) {
    if (item.variantId === item.productId) { itemsNoVariant.push(item) }
    else                                   { itemsWithVariant.push(item) }
  }

  // Fetch variant rows (only for items that have a real variant ID)
  const variantRows: any[] = []
  if (itemsWithVariant.length > 0) {
    const variantIdList = itemsWithVariant.map(i => i.variantId).join(',')
    const data = await sbGet('product_variants',
      `select=id,price,original_price,is_active,available_stock,product_id&id=in.(${variantIdList})`
    )
    variantRows.push(...(data || []))
    if (variantRows.length === 0) throw new Error('Could not fetch product details — variant IDs not found in DB')
  }

  // Collect all product IDs (from variants + direct product-only items)
  const allProductIds = Array.from(new Set([
    ...variantRows.map((v: any) => String(v.product_id)),
    ...itemsNoVariant.map(i => String(i.productId)),
  ]))
  if (!allProductIds.length) throw new Error('Could not fetch product details')

  const productIdList = allProductIds.join(',')
  const products: any[] = await sbGet('products',
    `select=id,name,emoji,gst_rate,is_deleted,status,price,mrp,available_stock&id=in.(${productIdList})`
  )
  if (!products?.length) throw new Error('Could not fetch product details — product IDs not found in DB')

  const productMap = new Map(products.map((p: any) => [String(p.id), p]))

  // Validate all products/variants are active
  for (const v of variantRows) {
    const p = productMap.get(String(v.product_id))
    if (!v.is_active || p?.is_deleted || p?.status !== 'active') {
      throw new Error('Product no longer available')
    }
  }
  for (const item of itemsNoVariant) {
    const p = productMap.get(String(item.productId))
    if (!p || p.is_deleted || p.status !== 'active') {
      throw new Error('Product no longer available')
    }
  }

  // Build CartItem array for pricing — handles both variant and non-variant products
  const cartItems: import('@/types').CartItem[] = input.items.map(i => {
    if (i.variantId === i.productId) {
      // No-variant product — price comes from products table
      const p = productMap.get(String(i.productId))
      return {
        productId:    i.productId,
        variantId:    i.variantId,
        name:         String(p?.name  ?? ''),
        slug:         '',
        image:        null,
        emoji:        String(p?.emoji ?? '🌿'),
        size:         '',
        price:        Number(p?.price) || 0,
        mrp:          Number(p?.mrp)   || Number(p?.price) || 0,
        gstRate:      Number(p?.gst_rate ?? 0),
        qty:          i.qty,
        maxQty:       Number(p?.available_stock) || 999,
        // Badge flags are display-only and irrelevant for server-side price calculation
        isOrganic:    !!(p?.badges_organic),
        isHimalayan:  !!(p?.state_id),
        isBestseller: !!(p?.badges_bestseller),
      }
    } else {
      // Variant product — price from product_variants, mrp from original_price column
      const v = variantRows.find((vv: any) => String(vv.id) === String(i.variantId))
      const p = productMap.get(String(v?.product_id ?? i.productId))
      return {
        productId:    i.productId,
        variantId:    i.variantId,
        name:         String(p?.name  ?? ''),
        slug:         '',
        image:        null,
        emoji:        String(p?.emoji ?? '🌿'),
        size:         '',
        price:        Number(v?.price) || 0,
        mrp:          Number(v?.original_price) || Number(p?.mrp) || Number(v?.price) || 0,
        gstRate:      Number(p?.gst_rate ?? 0),
        qty:          i.qty,
        maxQty:       Number(v?.available_stock) || 999,
        // Badge flags are display-only and irrelevant for server-side price calculation
        isOrganic:    !!(p?.badges_organic),
        isHimalayan:  !!(p?.state_id),
        isBestseller: !!(p?.badges_bestseller),
      }
    }
  })

  // 4. Resolve coupon — validate server-side then convert to AppliedCoupon shape.
  //
  // BUG FIX: previously this step fetched the coupon and applied it without
  // re-checking max_uses, expires_at, or min_order.  Those checks only lived in
  // /api/v1/coupons (the client pre-validation endpoint), so anyone calling
  // /api/v1/orders directly could bypass all coupon limits.
  //
  // We now replicate every limit check here — this is the authoritative gate.
  // The pre-check endpoint is still useful (fast UX feedback) but no longer
  // the only line of defence.
  let appliedCoupon: import('@/types').AppliedCoupon | null = null
  // Retain the raw DB row so we can atomically increment uses_count after order creation.
  let couponDbRow: { code: string; uses_count: number; max_uses: number | null } | null = null
  if (input.couponCode) {
    const { data: coupon } = await withTimeout(
      db.from('coupons')
        .select('*')
        .eq('code', input.couponCode.toUpperCase())
        .eq('is_active', true)
        .maybeSingle(),
      8_000,
      'coupon fetch',
    )

    if (coupon) {
      // ── Server-side coupon guards (mirrors validateCouponServer) ──────────
      // max_uses check
      if (coupon.max_uses != null && (coupon.uses_count ?? 0) >= coupon.max_uses) {
        throw new Error('Coupon usage limit reached')
      }
      // Expiry check
      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        throw new Error('Coupon has expired')
      }
      // Min order check (against live server-computed subtotal)
      const subtotalForCheck = cartItems.reduce((s, i) => s + i.price * i.qty, 0)
      if (coupon.min_order && subtotalForCheck < coupon.min_order) {
        throw new Error(`Minimum order ₹${coupon.min_order} required for this coupon`)
      }

      couponDbRow = { code: coupon.code, uses_count: coupon.uses_count ?? 0, max_uses: coupon.max_uses ?? null }
      const discountAmt = coupon.type === 'percent'
        ? Math.min(
            Math.round(subtotalForCheck * coupon.value / 100),
            // BUG FIX (pricingService mirror): use ?? not || so max_discount=0 is
            // respected rather than treated as "no cap".
            coupon.max_discount ?? Infinity
          )
        : coupon.value
      appliedCoupon = {
        code:     coupon.code,
        discount: Math.round(discountAmt),
        type:     coupon.type,
        percent:  coupon.type === 'percent' ? coupon.value : undefined,
      }
    }
  }

  // 5. Calculate final price server-side
  //
  // SEC-FIX: loyalty discount must be enforced server-side here, not just in
  // /api/v1/loyalty action=validate.  That route is a client-facing pre-check;
  // an attacker who calls /api/v1/orders directly can supply any
  // loyalty_points_redeemed value.  We enforce two guards:
  //
  //   a) Balance guard (step 7c below) — points cannot exceed live balance.
  //   b) max_redeem_pct cap (here) — loyalty ₹ value cannot exceed
  //      loyalty_max_redeem_pct % of the subtotal.  Without this, a user with
  //      a very large points balance could make an arbitrarily large order for
  //      free even if they legitimately accrued that many points.
  //
  // loyaltyDiscountInr is then passed to calcPriceSummary so pricing.total
  // reflects the actual amount to charge.  Previously this arg was omitted,
  // meaning the stored total_amount ignored loyalty — customers were being
  // charged the full pre-loyalty price even when points were redeemed.
  let loyaltyDiscountInr = 0
  if ((input.loyaltyPointsRedeemed ?? 0) > 0) {
    const pointsValue  = parseFloat(settings.loyalty_points_value   || '0.25') || 0.25
    const maxRedeemPct = parseFloat(settings.loyalty_max_redeem_pct || '20')   || 20
    const subtotal     = cartItems.reduce((s, i) => s + i.price * i.qty, 0)

    const requestedDiscount = Math.floor(input.loyaltyPointsRedeemed! * pointsValue)
    const maxAllowed        = Math.floor(subtotal * maxRedeemPct / 100)

    // Clamp to the cap rather than throwing — the order still proceeds but
    // excess loyalty is silently capped.  The balance guard (step 7c) handles
    // the "more points than the customer owns" case.
    loyaltyDiscountInr = Math.min(requestedDiscount, maxAllowed)
  }

  // DATA INTEGRITY / PAYMENT INTEGRITY FIX: this was hardcoded to 'cod', which
  // means calcPriceSummary's prepaidPct discount (applied only when
  // paymentMethod === 'razorpay') was NEVER applied server-side — regardless
  // of what the customer actually selected.
  //
  // The checkout UI (useCheckoutPage.ts) computes its displayed pricing with
  // `calcPriceSummary(items, s, coupon, payMethod, ...)`, where payMethod can
  // be 'razorpay'. For a Razorpay checkout, that client-side total already has
  // the prepaid discount (default 5%) subtracted — e.g. a ₹1000 cart shows a
  // total of ₹950 (after free-shipping threshold).
  //
  // With 'cod' hardcoded here, order.total_amount came out as ₹1000 (no
  // prepaid discount). /api/v1/payments then converts that DB-authoritative
  // total_amount directly to paise and creates the Razorpay order for ₹1000 —
  // ₹50 MORE than what the customer saw and agreed to on the checkout page.
  // Every Razorpay order silently overcharged customers by the prepaid-discount
  // amount (5% of afterDiscount by default).
  //
  // Fix: pass the real input.paymentMethod through. For 'cod' orders this is
  // a no-op (prepaidDiscount is already 0 for 'cod' inside calcPriceSummary),
  // so COD pricing is unaffected — only Razorpay totals change, and they now
  // match what the customer was shown.
  const pricing = calcPriceSummary(cartItems, settings, appliedCoupon, input.paymentMethod, loyaltyDiscountInr)

  // 6. COD availability check
  if (input.paymentMethod === 'cod' && settings.cod_enabled === 'false') {
    throw new Error('COD is not available at this time')
  }

  // 7. Generate order number — shown to customers and support.
  //    Date.now() gives the millisecond epoch; appending 4 random base-36 chars
  //    makes same-millisecond collisions astronomically unlikely without any DB
  //    lookup. The idempotency_key remains the true uniqueness guard in the DB.
  const orderNumber = `PR${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()

  // 7b. Upsert customer — actual schema stores customer_id FK, not inline fields
  // Matches old site pattern: lookup by phone → upsert → get custId
  const nameParts   = input.customerName.trim().split(' ')
  const firstName   = nameParts[0] || input.customerName.trim()
  const lastName    = nameParts.slice(1).join(' ') || null
  const addressLine = [input.flat, input.area].filter(Boolean).join(', ')
  const custBody = {
    first_name:    firstName,
    last_name:     lastName,
    phone:         input.customerPhone.trim(),
    email:         input.customerEmail?.trim() || null,
    address_line1: addressLine || null,
    city:          input.city    || null,
    state:         input.state   || null,
    pincode:       input.pincode || null,
  }

  // Lookup: phone first, then email — avoids duplicate key on idx_customers_email
  let custId: string | null = null
  let existingCust: any = null
  existingCust = await sbGetOne('customers', `phone=eq.${encodeURIComponent(input.customerPhone.trim())}&select=id&limit=1`)
  if (!existingCust?.id && input.customerEmail?.trim()) {
    existingCust = await sbGetOne('customers', `email=eq.${encodeURIComponent(input.customerEmail.trim())}&select=id&limit=1`)
  }

  if (existingCust?.id) {
    // Existing customer — update name/address but skip email to avoid unique constraint
    custId = existingCust.id
    const { email: _e, ...patchBody } = custBody
    await sbPost('customers', `id=eq.${custId}`, patchBody, 'PATCH').catch(() => null)
  } else {
    // New customer — insert, fallback to null email if constraint fires
    const rows: any[] = await sbPost('customers', '', custBody).catch(async () => {
      return sbPost('customers', '', { ...custBody, email: null })
    })
    custId = rows?.[0]?.id ?? null
  }
  if (!custId) throw new Error('Could not create/find customer record')

  // 7c. Loyalty balance guard — verify the customer still holds enough points
  //     at this exact moment before we create the order.
  //     The client-side validate call (POST /api/v1/loyalty action=validate) is
  //     a point-in-time snapshot; points can be redeemed in a parallel session
  //     between that call and now. We re-fetch the live balance here so a race
  //     cannot result in a negative balance.
  if ((input.loyaltyPointsRedeemed ?? 0) > 0) {
    const { data: customerRow, error: balanceErr } = await withTimeout(
      db.from('customers')
        .select('loyalty_points')
        .eq('id', custId)
        .single(),
      8_000,
      'loyalty balance check',
    )

    if (balanceErr) throw new Error('Could not verify loyalty balance')

    const liveBalance = Number(customerRow?.loyalty_points ?? 0)
    if (input.loyaltyPointsRedeemed! > liveBalance) {
      throw new Error(
        `Insufficient loyalty balance — available: ${liveBalance} pts, ` +
        `requested: ${input.loyaltyPointsRedeemed} pts`
      )
    }
  }

  // 8 + 9. Create order AND insert order items in a single PostgreSQL transaction.
  //
  // DB TRANSACTION FIX: previously these were two separate Supabase SDK calls.
  // If the order_items insert failed, we attempted a manual DELETE of the orphan
  // order — a fragile cleanup that could also fail (e.g. network drop), leaving
  // an orphan order row with no items.
  //
  // We now call create_order_with_items(), a PL/pgSQL function that wraps both
  // INSERTs in an implicit transaction.  If the order_items loop throws, PG rolls
  // back the orders row automatically — no orphan cleanup needed.
  //
  // loyalty_points_redeemed is stored on the orders row so that verify_payment
  // can read it from the DB rather than trusting the client-supplied value.
  // This fixes the P2 security issue where an inflated client value could
  // pass if the DB RPC lacked a sufficient balance check.

  // Resolve canonical variant UUIDs for no-variant products before the RPC call
  const noVariantProductIds = itemsNoVariant.map(i => i.productId)
  const defaultVariantMap = new Map<string, string>() // productId → variantId (UUID)
  if (noVariantProductIds.length > 0) {
    const productIdList2 = noVariantProductIds.join(',')
    const defaultVariants: any[] = await sbGet('product_variants',
      `select=id,product_id,price&product_id=in.(${productIdList2})&is_active=eq.true&order=id.asc&limit=${noVariantProductIds.length * 2}`
    ).catch(() => [])
    for (const v of (defaultVariants || [])) {
      const pid = String(v.product_id)
      if (!defaultVariantMap.has(pid)) defaultVariantMap.set(pid, String(v.id))
    }
  }

  const rpcItems = input.items.map(i => {
    const v: any = variantRows.find((vv: any) => String(vv.id) === String(i.variantId))
    const p: any = productMap.get(String(v?.product_id ?? i.productId))
    const resolvedVariantId = i.variantId === i.productId
      ? (defaultVariantMap.get(String(i.productId)) ?? i.variantId)
      : i.variantId
    return {
      product_id:    i.productId,
      variant_id:    resolvedVariantId,
      quantity:      i.qty,
      price_at_time: Number(v?.price) || Number(p?.price) || 0,
    }
  })

  const { data: rpcResult, error: rpcErr } = await withTimeout(
    db.rpc('create_order_with_items', {
      p_order_number:             orderNumber,
      p_customer_id:              custId,
      p_total_amount:             pricing.total,
      p_subtotal:                 pricing.subtotal,
      p_coupon_discount:          pricing.discount,
      p_tax:                      pricing.gstTotal,
      p_shipping_charge:          pricing.shipping,
      // BUG FIX: COD orders were created with order_status='pending', meaning the
      // storefront sent a "Order Confirmed!" email but the DB row said 'pending'.
      // This caused inconsistency in the admin panel (orders showed as unconfirmed)
      // and broke any dashboard query filtering on order_status='confirmed'.
      //
      // COD requires no online payment verification: the customer pays on delivery,
      // so the order is confirmed the moment it is placed.  Set status accordingly.
      // Razorpay orders remain 'pending' until verify_payment or the webhook fires.
      p_order_status:             input.paymentMethod === 'cod' ? 'confirmed' : 'pending',
      // payment_status: 'cod_pending' = payment expected on delivery (not yet paid,
      // not failed).  Distinct from 'pending' (online payment in progress) so that
      // admin queries can correctly separate the two payment flows.
      p_payment_status:           input.paymentMethod === 'cod' ? 'cod_pending' : 'pending',
      p_payment_method:           input.paymentMethod,
      p_idempotency_key:          input.idempotencyKey,
      p_loyalty_points_redeemed:  input.loyaltyPointsRedeemed ?? 0,
      p_items:                    rpcItems,
      p_shipping_address:         {
        address_line1: addressLine || null,
        city:          input.city    || null,
        state:         input.state   || null,
        pincode:       input.pincode || null,
      },
    }),
    8_000,
    'create_order_with_items RPC',
  )

  if (rpcErr || !rpcResult) {
    throw new Error('Failed to create order: ' + (rpcErr?.message ?? 'no data returned'))
  }

  // rpc() with RETURNS TABLE returns an array — take first row
  const row = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
  if (!row?.id) throw new Error('Order creation RPC returned no row')
  newOrder = row as { id: string; order_number: string; total_amount: number; order_status: string }

  // 9b. Generate the guest-safe order-confirmation token (see
  // db_migration_v6_order_confirmation_token.sql for the full rationale —
  // this replaces the dead /api/admin-api call the order-success page used
  // to make with a proper, IDOR-safe guest lookup mechanism).
  //
  // crypto.randomUUID() is cryptographically secure (Node's crypto module,
  // backed by the OS CSPRNG) — 122 bits of randomness, unguessable. Stored
  // as a normal REST update (not raw SQL) against the confirmation_token
  // column added by the migration above.
  //
  // Deliberately non-fatal: order creation has already fully committed by
  // this point (stock reserved, order row exists, coupon/loyalty applied).
  // If this UPDATE fails for any reason, the order itself is still 100%
  // valid — the customer just gets a token-less order-success URL, which
  // degrades gracefully to the existing "check your email/WhatsApp"
  // fallback (see buildOrderSuccessUrl in useCheckoutPage.ts). We must
  // never let a non-critical UX enhancement fail an already-successful order.
  let confirmationToken: string | null = null
  try {
    confirmationToken = crypto.randomUUID()
    const { error: tokenErr } = await withTimeout(
      db.from('orders')
        .update({ confirmation_token: confirmationToken })
        .eq('id', newOrder.id),
      5_000,
      'confirmation_token update',
    )
    if (tokenErr) {
      logger.error('[createOrder] confirmation_token update failed', {
        action: 'createOrder.confirmation_token', orderId: newOrder.id, error: tokenErr.message,
      })
      confirmationToken = null
    }
  } catch (e) {
    logger.error('[createOrder] confirmation_token generation/update threw', {
      action: 'createOrder.confirmation_token', orderId: newOrder.id,
      error: e instanceof Error ? e.message : String(e),
    })
    confirmationToken = null
  }

  // 10. Atomically increment coupon uses_count now that the order is committed.
  //
  // BUG FIX: the previous implementation used a stale client-read value:
  //   .update({ uses_count: couponDbRow.uses_count + 1 })
  //
  // Two concurrent orders that both read uses_count=5 at step 4 would both
  // write 6 — the coupon gets used one extra time per concurrent pair.
  //
  // Fix: add an optimistic-lock condition .eq('uses_count', snapshot).
  // PostgREST only updates the row if uses_count still matches the snapshot
  // we read at step 4.  If another order already incremented it, this update
  // silently matches 0 rows — the coupon has already been correctly counted.
  // Non-fatal: at worst one concurrent over-use is missed; the order is committed.
  if (couponDbRow) {
    const { error: couponIncrErr } = await withTimeout(
      db.from('coupons')
        .update({ uses_count: couponDbRow.uses_count + 1 })
        .eq('code', couponDbRow.code)
        .eq('uses_count', couponDbRow.uses_count), // optimistic lock — prevents stale write
      8_000,
      'coupon uses_count increment',
    )
    if (couponIncrErr) {
      // BUG FIX 20a: use structured logger (not raw console.error) so this is
      // parseable by log aggregators and shows up in dashboards.
      logger.error('[createOrder] coupon uses_count increment failed', {
        action:  'createOrder.coupon_increment',
        code:    couponDbRow.code,
        error:   couponIncrErr.message,
      })
    }
  }

  // 11. Log creation event
  await logOrderEvent(newOrder!.id, 'order_created', 'system', {
    payment_method: input.paymentMethod,
    total:          pricing.total,
    items:          input.items.length,
  })

  // Return cartItems alongside order so the email template in orders/route.ts
  // can use real product names + prices (d.items from Zod only has productId/variantId/qty)
  return {
    order: {
      id:           newOrder!.id,
      order_number: newOrder!.order_number,
      total_amount: newOrder!.total_amount,
      total:        newOrder!.total_amount,
      status:       newOrder!.order_status,
      cartItems:    cartItems.map(i => ({
        name:  i.name,
        emoji: i.emoji ?? '🌿',
        qty:   i.qty,
        price: i.price,
      })),
      confirmationToken,
    },
    alreadyExists: false,
    customerId:    custId,
  }

  } finally {
    // Restore stock if order was never committed (newOrder===null means
    // the DB transaction rolled back or a pre-insert step threw).
    // This covers ALL throw paths after the atomic reservation:
    // bad product ID, coupon expired, COD disabled, loyalty shortfall,
    // customer creation failure, RPC error — every possible exit.
    if (newOrder === null) {
      const { restoreStock } = await import('./inventoryService')
      await restoreStock(
        input.items.map(i => ({ variantId: i.variantId, productId: i.productId, qty: i.qty }))
      ).catch(async restoreErr => {
        // BUG FIX 20b: use captureError with alert:true — a failed stock restore
        // on an aborted order means inventory is permanently locked. Ops must fix.
        captureError(restoreErr, {
          action: 'createOrder.stock_restore_failed',
          alert:  true,
        })
      })
    }
  }
}

export async function updateOrderStatus(
  orderId: string,
  status:  string,
  extra:   Record<string, unknown> = {},
): Promise<void> {
  const db = getServiceClient()
  await withTimeout(
    db.from('orders').update({
      order_status: status,
      ...extra,
    }).eq('id', orderId),
    8_000,
    'updateOrderStatus',
  )
}

/**
 * Records an audit-trail event for an order (e.g. 'order_created',
 * 'payment_verified', 'payment_signature_mismatch').
 *
 * BUG FIX [ERROR HANDLING]: this function previously let `db.insert()`
 * errors propagate to the caller. The single call site inside createOrder()
 * (step 11, "Log creation event") runs AFTER the order has already been
 * durably committed via the create_order_with_items RPC — so a transient
 * failure on this audit-only insert (e.g. a momentary RLS hiccup, the
 * order_events table briefly unavailable) would throw, get caught by the
 * outer try/catch in orders/route.ts or payments/route.ts, and return a
 * scary "Order placement failed" error to a customer whose order had
 * ALREADY succeeded. The customer could not tell their order actually went
 * through; a retry would correctly hit the idempotency-key short-circuit
 * and report success, but only after needless confusion (and possibly an
 * abandoned cart or a support ticket for a non-issue).
 *
 * It also meant every call site in payments/route.ts and webhook/route.ts
 * had to defensively wrap this call in `.catch(() => null)` to avoid the
 * same risk — silently discarding the error with NO log line anywhere,
 * leaving zero trace if the audit table genuinely breaks.
 *
 * Fix: catch and log internally, mirroring the same non-fatal pattern
 * already used by awardLoyaltyPoints() in lib/server/loyalty.ts. Order
 * creation (and payment confirmation) must never fail because the audit
 * log couldn't be written — but ops should still see it in server logs.
 */
export async function logOrderEvent(
  orderId:  string,
  event:    string,
  actor:    string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const db = getServiceClient()
    const { error } = await withTimeout(
      db.from('order_events').insert({
        order_id:   orderId,
        event,
        actor,
        metadata,
        created_at: new Date().toISOString(),
      }),
      8_000,
      'logOrderEvent insert',
    )
    if (error) {
      // BUG FIX 21: use structured logger.error — raw console.error is unparseable
    // by log aggregators and won't appear in log-level filters.
    logger.error('logOrderEvent: insert failed', { action: 'logOrderEvent.insert_failed', order_id: orderId, event, error: error.message })
    }
  } catch (e) {
    // Network failure, table missing, or any other unexpected error —
    // never let an audit-log problem fail the caller's order flow.
    logger.error('logOrderEvent: unexpected error', { action: 'logOrderEvent.unexpected', order_id: orderId, event, error: e instanceof Error ? e.message : String(e) })
  }
}
