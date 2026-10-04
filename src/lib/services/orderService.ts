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
  // Added so the account UI can identify exactly which line item a
  // customer is requesting a return/replacement for (see
  // /api/orders/route.ts and /api/orders/[id]/return/route.ts). Optional
  // + nullable so this schema stays backward-compatible with any response
  // shape that predates this field.
  id:         z.union([z.string(), z.number()]).nullable().optional(),
  variant_id: z.union([z.string(), z.number()]).nullable().optional(),
  product_id: z.union([z.string(), z.number()]).nullable().optional(),
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
  settings: z.record(z.string(), z.string()).optional(),
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
import { variantLinePrice, variantLineMrp, productLinePrice, productLineMrp } from '@/lib/server/cartValidation'
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
  // BUG FIX (root cause of orders silently splitting across duplicate
  // customer records): the customer used to be resolved ENTIRELY by
  // re-matching the phone/email typed into the checkout form, even for a
  // fully logged-in user — with zero awareness of their actual session.
  // A customer who typed their phone slightly differently than how it was
  // stored (e.g. missing the +91 country code) would silently attach
  // their order to a different/duplicate customer record instead of their
  // real one, permanently splitting their order history. When the
  // checkout route has a valid authenticated session, it now resolves the
  // customer via the SAME authoritative mechanism /api/orders (My Orders)
  // already uses — syncCustomerProfile(), keyed on auth_user_id, not
  // free-text form fields — and passes that customer_id here directly,
  // skipping the phone/email fallback matching entirely.
  authenticatedCustomerId?: string | number | null
}

export interface OrderEmailItem {
  name:  string
  emoji: string
  image: string | null
  qty:   number
  price: number  // price per unit
}

export interface CreatedOrder {
  id:           string
  order_number: string
  total_amount: number
  total:        number
  status:       string
  // Pricing breakdown — lets the confirmation email itemize Subtotal /
  // Shipping / COD Charges instead of only showing Total.
  subtotal:       number
  shippingCharge: number
  codSurcharge:   number
  discount:       number
  cartItems:    OrderEmailItem[]  // enriched items for email — real names + prices from DB
  // Guest-safe capability token for the order-success confirmation page —
  // null when token generation failed (non-fatal) or for the idempotency
  // "already exists" path (see db_migration_v6_order_confirmation_token.sql).
  confirmationToken: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency-key reuse guard (P3)
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when an idempotency key is reused for a request that differs from the stored order. */
export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT'
  constructor(public readonly reason: string) {
    super('Your cart or payment details changed since this order was started. Please review your order and place it again.')
    this.name = 'IdempotencyConflictError'
  }
}

export interface StoredOrderItem { product_id: unknown; variant_id: unknown; quantity: unknown }

/**
 * Compare a stored order with an incoming request that reuses its idempotency key.
 * Returns null when it is the same request (a genuine retry), else a short reason.
 *
 * Items: the client may send a product id as variantId for products with no variants
 * (the server resolves the real variant), so an input line matches a stored row when
 * the variant ids are equal OR the input variantId is just the productId.
 * Coupons are not compared here (the discount is already baked into total_amount and
 * the client resets its key when the coupon changes) — see useCheckoutPage.
 */
export function describeIdempotencyMismatch(
  stored: { orderStatus: string; paymentMethod: string; loyaltyPoints: number; items: StoredOrderItem[] },
  req:    { paymentMethod: string; loyaltyPoints: number; items: Array<{ productId: string; variantId: string; qty: number }> },
): string | null {
  // A dead order can never be "resumed" — start a fresh one.
  if (stored.orderStatus === 'cancelled' || stored.orderStatus === 'payment_failed') {
    return `existing order is ${stored.orderStatus}`
  }
  if (stored.paymentMethod !== req.paymentMethod) {
    return `payment method changed (${stored.paymentMethod} → ${req.paymentMethod})`
  }
  if (Number(stored.loyaltyPoints) !== Number(req.loyaltyPoints)) {
    return 'loyalty points changed'
  }

  const remaining = stored.items.map(r => ({
    product: String(r.product_id), variant: String(r.variant_id), qty: Number(r.quantity), used: false,
  }))
  if (remaining.length !== req.items.length) return 'item count changed'
  for (const it of req.items) {
    const hit = remaining.find(r =>
      !r.used && r.qty === Number(it.qty) &&
      (r.variant === String(it.variantId) || (String(it.variantId) === String(it.productId) && r.product === String(it.productId))),
    )
    if (!hit) return 'items or quantities changed'
    hit.used = true
  }
  return null
}

const SAFE_ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/
/** Defence in depth for PS1 — the HTTP schema already enforces this; createOrder must not rely on that. */
function assertSafeItemIds(items: Array<{ productId: string; variantId: string }>): void {
  for (const i of items) {
    if (!SAFE_ITEM_ID.test(String(i.productId)) || !SAFE_ITEM_ID.test(String(i.variantId))) {
      throw new Error('Invalid cart item — please refresh your cart')
    }
  }
}

export async function createOrder(
  input: CreateOrderInput,
  settings: SiteSettings,
): Promise<{ order: CreatedOrder; alreadyExists: boolean; customerId: string | null }> {
  const db = getServiceClient()

  // 1. Idempotency check — return existing order if same key
  const { data: existing } = await withTimeout(
    db.from('orders')
      .select('id, order_number, total_amount, order_status, payment_status, payment_method, loyalty_points_redeemed, confirmation_token')
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle(),
    8_000,
    'orders idempotency check',
  )

  // P3 FIX: the key used to be trusted blindly — ANY request carrying a known key got
  // the stored order back, whatever it asked for. A customer who dismissed the Razorpay
  // modal, edited the cart (or coupon / coins) and paid again was silently charged for
  // the OLD order; and switching Razorpay→COD "placed" the abandoned online order.
  // A reused key is only a retry if the request is actually the same request.
  if (existing) {
    const { data: existingItems } = await withTimeout(
      db.from('order_items')
        .select('product_id, variant_id, quantity')
        .eq('order_id', existing.id),
      8_000,
      'orders idempotency items check',
    )
    const mismatch = describeIdempotencyMismatch(
      {
        orderStatus:   String(existing.order_status),
        paymentMethod: String(existing.payment_method),
        loyaltyPoints: Number(existing.loyalty_points_redeemed ?? 0),
        items:         (existingItems ?? []) as StoredOrderItem[],
      },
      {
        paymentMethod: input.paymentMethod,
        loyaltyPoints: Number(input.loyaltyPointsRedeemed ?? 0),
        items:         input.items,
      },
    )
    if (mismatch) throw new IdempotencyConflictError(mismatch)
  }

  if (existing) {
    return {
      order: {
        id:           existing.id,
        order_number: existing.order_number,
        total_amount: existing.total_amount,
        total:        existing.total_amount,
        status:       existing.order_status,
        // Not needed — email (the only reader of these) is skipped when
        // alreadyExists is true. Zeroed rather than omitted to satisfy
        // CreatedOrder's type without implying these are real values.
        subtotal:       0,
        shippingCharge: 0,
        codSurcharge:   0,
        discount:       0,
        cartItems:    [], // not needed — email is skipped when alreadyExists is true
        confirmationToken: existing.confirmation_token ?? null,
      },
      alreadyExists: true,
      customerId:    null,
    }
  }

  // 1b. I3 PRE-FLIGHT (before ANY stock is touched): a line whose variantId equals its
  //     productId means "this product has no variants" and is priced from the products
  //     table. The server used to take the client's word for it. A client could therefore
  //     send productId as variantId for a product that DOES have variants and buy any of
  //     them at the (lower) base-product price. The storefront only ever sends this shape
  //     when a product has no ACTIVE variants (see getBaseVariant), so a no-variant line for
  //     a product that has active variants is always stale or tampered — reject it.
  //     Fails CLOSED: if the variants cannot be looked up, the order is not created.
  assertSafeItemIds(input.items)
  const noVariantLines = input.items.filter(i => i.variantId === i.productId)
  if (noVariantLines.length > 0) {
    const ids  = Array.from(new Set(noVariantLines.map(i => i.productId))).join(',')
    const rows = await sbGet('product_variants', `select=id,product_id&product_id=in.(${ids})&is_active=eq.true`)
    const hasVariants = new Set((rows ?? []).map((r: { product_id: unknown }) => String(r.product_id)))
    if (noVariantLines.some(i => hasVariants.has(String(i.productId)))) {
      throw new Error('An item in your cart has multiple options — please remove it and add it again with the size you want')
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

    // I3: every variant line must resolve to a real variant that BELONGS to the product the
    // client named. Previously a missing variant silently fell back to the product's price,
    // and a variant of product A could be stored under product B (rpcItems wrote the client's
    // productId beside the real variantId), corrupting product-level stock/GST/reporting.
    for (const item of itemsWithVariant) {
      const v = variantRows.find((vv: any) => String(vv.id) === String(item.variantId))
      if (!v || String(v.product_id) !== String(item.productId)) {
        throw new Error('Product no longer available')
      }
    }
  }

  // Collect all product IDs (from variants + direct product-only items)
  const allProductIds = Array.from(new Set([
    ...variantRows.map((v: any) => String(v.product_id)),
    ...itemsNoVariant.map(i => String(i.productId)),
  ]))
  if (!allProductIds.length) throw new Error('Could not fetch product details')

  const productIdList = allProductIds.join(',')
  // BUG FIX (order-confirmation email missing product photos): this select
  // never fetched image_url, so both branches below hardcoded `image: null`
  // on every cart item — not because images were unavailable, but because
  // this query never asked for them. That null flows straight into
  // OrderEmailItem, which is why the confirmation email could only ever
  // show a generic emoji, never the real product photo.
  //
  const products: any[] = await sbGet('products',
    `select=id,name,emoji,image_url,gst_rate,is_deleted,status,price,selling_price,mrp,available_stock&id=in.(${productIdList})`
  )
  if (!products?.length) throw new Error('Could not fetch product details — product IDs not found in DB')

  // products.image_url is fetched only as a last-resort fallback — per the
  // established pattern everywhere else in this codebase (applyProductImages
  // in normalizeProduct.ts, cart-upsells/route.ts), product_images is the
  // real source of truth and products.image_url can be stale/unset.
  //
  // Deliberately a SEPARATE, non-fatal fetch (not folded into the products
  // Promise.all above): this is cosmetic data for the confirmation email
  // only. If it fails for any reason, the order itself must still go
  // through — the email just falls back to the emoji, same as before this
  // fix. Never let a nice-to-have image lookup block a real order.
  let productImageRows: any[] = []
  try {
    productImageRows = await sbGet('product_images',
      `product_id=in.(${productIdList})&select=product_id,image_url&order=product_id.asc,sort_order.asc`
    )
  } catch (e) {
    logger.error('[createOrder] product_images fetch failed (non-fatal — email will fall back to emoji)', {
      action: 'createOrder.product_images', error: e instanceof Error ? e.message : String(e),
    })
    productImageRows = []
  }

  const productMap = new Map(products.map((p: any) => [String(p.id), p]))
  const productImageMap = new Map<string, string>()
  ;(productImageRows || []).forEach((row: any) => {
    if (!productImageMap.has(String(row.product_id)) && row.image_url) {
      productImageMap.set(String(row.product_id), row.image_url)
    }
  })
  const imageFor = (p: any): string | null =>
    productImageMap.get(String(p?.id)) ?? p?.image_url ?? null

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
        image:        imageFor(p),
        emoji:        String(p?.emoji ?? '🌿'),
        size:         '',
        // BUG FIX (catalogue-wide audit, Aug 2026): products.price is a
        // legacy column no code writes to anymore (the pricing engine only
        // updates product_variants.price and products.selling_price) —
        // confirmed live to disagree with the real price for nearly the
        // whole catalogue (e.g. Sea Buckthorn: 714.29 stale vs 800 real).
        // No live product currently has zero variants, so this branch
        // wasn't actively mispricing anything yet, but it was one variant
        // deletion away from silently undercharging a customer at
        // checkout. Prefer selling_price; keep price as a last-resort
        // fallback only for rows that somehow have neither set.
        price:        productLinePrice(p),
        mrp:          productLineMrp(p),
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
        image:        imageFor(p),
        emoji:        String(p?.emoji ?? '🌿'),
        size:         '',
        // BUG FIX (catalogue-wide audit, Aug 2026): products.price is a
        // legacy column the pricing engine no longer writes to — prefer
        // selling_price. Also protects against a failed variant lookup
        // ever pricing this line at ₹0 (confirmed live risk, see orderService
        // audit notes for order 124/Aug 10).
        price:        variantLinePrice(v, p),
        mrp:          variantLineMrp(v, p),
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
  let couponDbRow: { id: number; code: string; uses_count: number; max_uses: number | null } | null = null
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

      // FEATURE FIX (Sep 2026): coupons.user_limit ("uses per customer") was
      // never enforced anywhere — only the store-wide max_uses/uses_count
      // check above ran. A coupon configured as "once per customer" behaved
      // as "once ever, for the whole store": the first redemption exhausted
      // it for every future customer too (see WELCOME50/MYPAHADI, both
      // configured with user_limit=1).
      //
      // This is the authoritative gate — /api/v1/coupons (pricingService.ts)
      // does the same check for fast UX feedback, but only when a phone has
      // already been typed in; a direct call to this endpoint could
      // otherwise skip it entirely, so it must also live here.
      //
      // Read-only identity lookup — mirrors the real customer upsert later
      // in this function (step 7b) but doesn't create anything. A brand-new
      // customer naturally has no match, so priorUses is correctly 0.
      if (coupon.user_limit != null) {
        let candidateCustId: string | number | null = input.authenticatedCustomerId ?? null
        if (candidateCustId == null) {
          const normalizedPhoneForCheck = input.customerPhone.replace(/\D/g, '').slice(-10)
          const custByPhone = normalizedPhoneForCheck
            ? await sbGetOne('customers', `normalized_phone=eq.${normalizedPhoneForCheck}&select=id&limit=1`)
            : null
          candidateCustId = custByPhone?.id ?? null
          if (candidateCustId == null && input.customerEmail?.trim()) {
            const custByEmail = await sbGetOne('customers', `email=eq.${encodeURIComponent(input.customerEmail.trim())}&select=id&limit=1`)
            candidateCustId = custByEmail?.id ?? null
          }
        }
        if (candidateCustId != null) {
          const { count: priorUses } = await withTimeout(
            db.from('coupon_usage')
              .select('id', { count: 'exact', head: true })
              .eq('coupon_id', coupon.id)
              .eq('customer_id', candidateCustId),
            8_000,
            'coupon per-customer usage check',
          )
          if ((priorUses ?? 0) >= coupon.user_limit) {
            throw new Error('You have already used this coupon')
          }
        }
      }

      couponDbRow = { id: coupon.id, code: coupon.code, uses_count: coupon.uses_count ?? 0, max_uses: coupon.max_uses ?? null }
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

  // 6b. FIX: cod_max_value (max order value eligible for COD) was only ever
  // enforced client-side (useCheckoutPage.ts's `codOk`, which just disables
  // the COD radio button) -- never here, meaning a direct API call could
  // bypass it entirely regardless of what the admin configured. Real
  // enforcement has to happen server-side; the client check remains as a
  // UX nicety (disabling the button before the customer even tries).
  if (input.paymentMethod === 'cod') {
    const codMaxValue = parseFloat(settings.cod_max_value || '3000')
    if (pricing.total > codMaxValue) {
      throw new Error(`COD is only available for orders up to ₹${codMaxValue}. Please pay online for this order.`)
    }
  }

  // 7. Generate order number — shown to customers and support.
  //    FIX (restoring the original readable format): order numbers used to
  //    look like ORD-2026-00076 (see order id 82, the last one in this
  //    format, created 2026-05-17) via order_number_seq, a real Postgres
  //    sequence that's still live in the DB, generated automatically by a
  //    set_order_number() BEFORE INSERT trigger on `orders`.
  //    CONFIRMED root cause (found live while testing this fix, updating
  //    this comment from an earlier, incorrect "avoiding a race condition"
  //    theory): that trigger was NOT actually attached to the orders table
  //    -- it had gone missing at some point, silently leaving order_number
  //    NULL on insert (nullable column, no default). The Date.now()-base36
  //    scheme that used to live here was a client-side stopgap for that, not
  //    a deliberate collision-avoidance trade-off. The DB-side trigger has
  //    since been restored as a defense-in-depth safety net (see migration
  //    037), but this explicit call remains the primary path.
  const orderPrefix = (settings.order_prefix || 'PR').trim().toUpperCase()
  const { data: orderNumberResult, error: orderNumberErr } = await db.rpc('generate_order_number', { p_prefix: orderPrefix })
  if (orderNumberErr || !orderNumberResult) {
    // Should be exceedingly rare (the function itself can't really fail),
    // but never let order creation itself hang or fail over a numbering
    // problem — fall back to the previous scheme rather than block checkout.
    logger.error('orderService: generate_order_number failed, falling back', { action: 'orderService.orderNumber', error: orderNumberErr?.message })
  }
  const orderNumber = orderNumberResult || `${orderPrefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()

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

  // Lookup: authenticated session first (authoritative — see
  // authenticatedCustomerId doc comment above), then phone, then email as
  // a guest-checkout fallback. Avoids duplicate key on idx_customers_email.
  let custId: string | null = null
  let existingCust: any = null
  if (input.authenticatedCustomerId != null) {
    existingCust = { id: input.authenticatedCustomerId }
  } else {
    // BUG FIX: was an exact string match on phone (`phone=eq.<raw>`), which
    // misses an existing customer whose number is stored in a different
    // format (e.g. with vs without +91) — exactly the bug this whole fix
    // addresses. Now matches against normalized_phone (last 10 digits,
    // same normalization the DB's uniqueness constraint uses — migration
    // 048), so format differences can't cause a miss here, and can't hit
    // that constraint on insert either.
    const normalizedPhone = input.customerPhone.replace(/\D/g, '').slice(-10)
    existingCust = normalizedPhone
      ? await sbGetOne('customers', `normalized_phone=eq.${normalizedPhone}&select=id&limit=1`)
      : null
    if (!existingCust?.id && input.customerEmail?.trim()) {
      existingCust = await sbGetOne('customers', `email=eq.${encodeURIComponent(input.customerEmail.trim())}&select=id&limit=1`)
    }
  }

  if (existingCust?.id) {
    custId = existingCust.id
    // BUG FIX (real, confirmed bug — not the phone-sharing theory from an
    // earlier session, which was a different, separate risk): this used to
    // unconditionally PATCH the customer's own permanent profile — name
    // AND default address — with whatever was typed into THIS checkout's
    // shipping form, every single time, for logged-in and guest checkout
    // alike. For an authenticated user that's backwards: choosing to ship
    // one order to a friend's or parent's saved address (a completely
    // normal, one-off delivery choice) permanently overwrote their own
    // account name and default address with that recipient's details —
    // globally, for every future page load and every future invoice,
    // until they happened to place another order to a different address.
    // There is also no per-order recipient-name snapshot anywhere else in
    // the schema (`p_shipping_address` below has no name field) — this
    // PATCH was the only place a delivery name got recorded at all, which
    // is exactly the architectural gap that made the bug possible.
    //
    // Fix: an authenticated user already has their own permanent profile,
    // edited explicitly via /account — checkout must never silently
    // overwrite it just because they shipped to a different address this
    // time. Guest checkout is unaffected: with no auth session, this PATCH
    // (keyed by phone/email lookup above) is the only mechanism recording
    // that guest's contact details at all, so the existing upsert-style
    // sync remains correct there.
    if (input.authenticatedCustomerId == null) {
      const { email: _e, ...patchBody } = custBody
      await sbPost('customers', `id=eq.${custId}`, patchBody, 'PATCH').catch(() => null)
    }
  } else {
    // New customer — insert, fallback to null email if constraint fires
    const rows: any[] = await sbPost('customers', '', custBody).catch(async () => {
      return sbPost('customers', '', { ...custBody, email: null })
    })
    custId = rows?.[0]?.id ?? null
  }
  if (!custId) throw new Error('Could not create/find customer record')

  // 7c-i. FIX: cod_max_active_orders (fraud prevention -- cap on how many
  // COD orders a phone number can have in flight at once) was defined in
  // types/index.ts and getSiteSettings.ts's defaults but never actually
  // enforced anywhere in either codebase -- confirmed via a full-repo
  // search. "Active" = not yet resolved either way (not delivered,
  // cancelled, or returned) -- the risk window this setting exists to cap
  // is real cash exposure on orders still in flight.
  if (input.paymentMethod === 'cod') {
    const codMaxActive = parseInt(settings.cod_max_active_orders || '3', 10)
    if (codMaxActive > 0) {
      const activeCodOrders = await sbGet('orders',
        `customer_id=eq.${custId}&payment_method=in.(cod,whatsapp_cod)` +
        `&order_status=not.in.(delivered,cancelled,returned)&select=id`)
      if ((activeCodOrders?.length ?? 0) >= codMaxActive) {
        throw new Error(`You have ${activeCodOrders.length} COD order(s) already in progress. Please pay online, or wait for an existing order to be delivered before placing another COD order.`)
      }
    }
  }

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

  // I2: variant_id is stored EXACTLY as reserved. A no-variant line (variantId === productId)
  // reserved stock in the PRODUCTS table, so it is stored with variant_id === product_id and
  // every restore path (orderItemsToStockItems → restoreStock) sends it back to the products
  // table. This used to substitute the product's first active variant here, so order_items
  // pointed at a variant whose stock was never decremented while the restore later credited
  // THAT variant — creating stock out of nothing. The I3 pre-flight above guarantees a
  // no-variant line never coexists with active variants, so no substitution is needed.

  const rpcItems = input.items.map((i, idx) => {
    return {
      product_id:    i.productId,
      variant_id:    i.variantId,
      quantity:      i.qty,
      // ARCHITECTURAL FIX (found investigating a live production
      // reconciliation gap, Aug 2026): this used to independently
      // re-derive price via its own variantRows/productMap lookup,
      // separate from the one that computed cartItems (which
      // pricing.total — the amount actually charged — is built from).
      // Two independent lookups for the same line item can silently
      // drift from each other for any reason — confirmed this is exactly
      // what produced order 124's live "Cross-table gap". Reusing the
      // already-resolved cartItems price by index (input.items,
      // cartItems, and rpcItems are all mapped from the same array in
      // the same order) makes order_items.price_at_time always exactly
      // what pricing.total was computed from — single source of truth.
      price_at_time: Number(cartItems[idx]?.price) || 0,
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
      // DATA INTEGRITY FIX: pricing.codSurcharge was already being charged
      // (folded into p_total_amount) but was never persisted as its own
      // value — no page reading this order back (invoice, "My Orders",
      // admin order detail, confirmation emails) could ever show it as a
      // line item, only the opaque total. Snapshotting it here means those
      // surfaces can now itemize it AND it stays correct historically even
      // if settings.cod_surcharge_amount changes later.
      p_cod_surcharge:            pricing.codSurcharge,
      p_shipping_address:         {
        // BUG FIX (proper Amazon/Myntra-style fix, not just the earlier
        // "stop overwriting the account" patch): this JSON is the only
        // per-order record of shipping details, but it never stored WHO
        // the delivery was actually addressed to. Amazon/Myntra always
        // keep "who placed the order" (account holder — never changes)
        // and "who this specific delivery is for" (may be a friend/
        // parent's address) as two separate, independent pieces of data.
        // Recording the recipient name HERE, per order, is what makes
        // that separation actually work — the invoice/admin can now show
        // "Billed to: Sudhir" + "Ship to: Vivek" instead of either losing
        // the recipient name entirely or (the original bug) overwriting
        // the account holder's own identity with it.
        name:          input.customerName || null,
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

    // BUG FIX (found live via ORD-2026-00119): the block above only bumps
    // coupons.uses_count. It never wrote a coupon_usage row — but the admin
    // Coupons page computes both "Uses" and "Discount Given" entirely from
    // coupon_usage (grouped/summed client-side), not from uses_count. Every
    // real coupon order was invisible in that reporting. Insert it here too.
    // coupon_usage.order_id now has a unique constraint (added alongside this
    // fix) so an idempotency-key retry just hits a harmless conflict.
    const { error: couponUsageErr } = await withTimeout(
      db.from('coupon_usage').insert({
        coupon_id:       couponDbRow.id,
        order_id:        newOrder!.id,
        customer_id:     custId,
        discount_amount: appliedCoupon?.discount ?? 0,
      }),
      8_000,
      'coupon usage record',
    )
    if (couponUsageErr && couponUsageErr.code !== '23505') { // 23505 = unique_violation (retry), not a real failure
      logger.error('[createOrder] coupon_usage insert failed', {
        action:  'createOrder.coupon_usage_insert',
        code:    couponDbRow.code,
        orderId: newOrder!.id,
        error:   couponUsageErr.message,
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
      // Pricing breakdown alongside the order — lets orders/route.ts build
      // a fully itemized confirmation email (Subtotal / Shipping / COD
      // Charges / Total) instead of only showing item lines + Total, which
      // silently didn't add up whenever a COD surcharge applied.
      subtotal:        pricing.subtotal,
      shippingCharge:  pricing.shipping,
      codSurcharge:    pricing.codSurcharge,
      discount:        pricing.discount,
      cartItems:    cartItems.map(i => ({
        name:  i.name,
        emoji: i.emoji ?? '🌿',
        image: i.image ?? null,
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
