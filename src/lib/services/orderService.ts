import { captureError } from '@/lib/logger'
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

export async function fetchOrders(params: FetchOrdersParams = {}): Promise<OrdersResponse> {
  const { page = 1, limit = 20, search = '', status = '', signal } = params
  const qs = new URLSearchParams({
    page: String(page), limit: String(limit),
    ...(search ? { search } : {}),
    ...(status && status !== 'all' ? { status } : {}),
  })
  const timeoutCtrl    = new AbortController()
  const timeoutId      = setTimeout(() => timeoutCtrl.abort(new Error('Timeout')), 15000)
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
import { checkStockAvailability } from './inventoryService'
import { calcPriceSummary } from './pricingService'

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
}

export interface CreatedOrder {
  id:           string
  order_number: string
  total_amount: number
  total:        number
  status:       string
}

export async function createOrder(
  input: CreateOrderInput,
  settings: SiteSettings,
): Promise<{ order: CreatedOrder; alreadyExists: boolean }> {
  const db = getServiceClient()

  // 1. Idempotency check — return existing order if same key
  const { data: existing } = await db
    .from('orders')
    .select('id, order_number, total_amount, order_status')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()

  if (existing) {
    return {
      order: {
        id:           existing.id,
        order_number: existing.order_number,
        total_amount: existing.total_amount,
        total:        existing.total_amount,
        status:       existing.order_status,
      },
      alreadyExists: true,
    }
  }

  // 2. Stock check
  const stockCheck = await checkStockAvailability(
    input.items.map(i => ({ variantId: i.variantId, productId: i.productId, qty: i.qty }))
  )
  if (!stockCheck.ok) {
    const failed = stockCheck.failedItems.map(f => `variantId:${f.variantId} (req:${f.requested} avail:${f.available})`).join(', ')
    throw new Error(`Insufficient stock: ${failed}`)
  }

  // 3. Fetch prices via direct REST API (same pattern as store-data route — proven working)
  // Split items: those with a real variant ID vs those using product ID as fallback
  // (variantId === productId means the product has no variants)
  const itemsWithVariant: typeof input.items = []
  const itemsNoVariant:   typeof input.items = []
  for (const item of input.items) {
    if (item.variantId === item.productId) { itemsNoVariant.push(item) }
    else                                   { itemsWithVariant.push(item) }
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!
  async function sbGet(table: string, query: string) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => res.status.toString())
      throw new Error(`DB fetch ${table} failed: ${txt}`)
    }
    return res.json()
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
        productId:  i.productId,
        variantId:  i.variantId,
        name:       String(p?.name  ?? ''),
        slug:       '',
        image:      null,
        emoji:      String(p?.emoji ?? '🌿'),
        size:       '',
        price:      Number(p?.price) || 0,
        mrp:        Number(p?.mrp)   || Number(p?.price) || 0,
        gstRate:    Number(p?.gst_rate ?? 0),
        qty:        i.qty,
        maxQty:     Number(p?.available_stock) || 999,
      }
    } else {
      // Variant product — price from product_variants, mrp from original_price column
      const v = variantRows.find((vv: any) => String(vv.id) === String(i.variantId))
      const p = productMap.get(String(v?.product_id ?? i.productId))
      return {
        productId:  i.productId,
        variantId:  i.variantId,
        name:       String(p?.name  ?? ''),
        slug:       '',
        image:      null,
        emoji:      String(p?.emoji ?? '🌿'),
        size:       '',
        price:      Number(v?.price) || 0,
        mrp:        Number(v?.original_price) || Number(p?.mrp) || Number(v?.price) || 0,
        gstRate:    Number(p?.gst_rate ?? 0),
        qty:        i.qty,
        maxQty:     Number(v?.available_stock) || 999,
      }
    }
  })

  // 4. Resolve coupon — convert raw DB row to AppliedCoupon shape
  let appliedCoupon: import('@/types').AppliedCoupon | null = null
  if (input.couponCode) {
    const { data: coupon } = await db
      .from('coupons')
      .select('*')
      .eq('code', input.couponCode.toUpperCase())
      .eq('is_active', true)
      .maybeSingle()
    if (coupon) {
      const subtotalForDiscount = cartItems.reduce((s, i) => s + i.price * i.qty, 0)
      const discountAmt = coupon.type === 'percent'
        ? Math.min(
            Math.round(subtotalForDiscount * coupon.value / 100),
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
  const pricing = calcPriceSummary(cartItems, settings, appliedCoupon)

  // 6. COD availability check
  if (input.paymentMethod === 'cod' && settings.cod_enabled === 'false') {
    throw new Error('COD is not available at this time')
  }

  // 7. Generate order number
  const orderNumber = `PR${Date.now().toString(36).toUpperCase()}`

  // 7b. Upsert customer — actual schema stores customer_id FK, not inline fields
  // Matches old site pattern: lookup by phone → upsert → get custId
  const SUPABASE_URL2 = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const SERVICE_KEY2  = process.env.SUPABASE_SERVICE_KEY!
  async function sbPost(table: string, query: string, body: object, method = 'POST') {
    const res = await fetch(`${SUPABASE_URL2}/rest/v1/${table}${query ? '?' + query : ''}`, {
      method,
      headers: {
        apikey:         SERVICE_KEY2,
        Authorization:  `Bearer ${SERVICE_KEY2}`,
        'Content-Type': 'application/json',
        Prefer:         method === 'POST' ? 'return=representation' : 'return=minimal',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => res.status.toString())
      throw new Error(`DB ${method} ${table} failed: ${txt}`)
    }
    return method === 'POST' ? res.json() : null
  }
  async function sbGetOne(table: string, query: string) {
    const res = await fetch(`${SUPABASE_URL2}/rest/v1/${table}?${query}`, {
      headers: { apikey: SERVICE_KEY2, Authorization: `Bearer ${SERVICE_KEY2}` },
    })
    if (!res.ok) return null
    const rows = await res.json()
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
  }

  // Build customer body — exact columns from Supabase schema
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
    postal_code:   input.pincode || null,
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

  // 8. Create order — EXACT same columns as working old site (admin-api.js line 325-335)
  // ONLY these columns: customer_id, total_amount, subtotal, coupon_discount, tax,
  // shipping_charge, order_status, payment_status, payment_method, idempotency_key
  // DO NOT add: status, shipping_address, source, order_number, updated_at — these cause constraint errors
  const { data: newOrder, error: orderErr } = await db
    .from('orders')
    .insert({
      customer_id:     custId,
      total_amount:    pricing.total,
      subtotal:        pricing.subtotal,
      coupon_discount: pricing.discount,
      tax:             pricing.gstTotal,
      shipping_charge: pricing.shipping,
      order_status:    'pending',
      payment_status:  'pending',
      payment_method:  input.paymentMethod,
      idempotency_key: input.idempotencyKey,
    })
    .select('id, order_number, total_amount, order_status')
    .single()

  if (orderErr || !newOrder) throw new Error('Failed to create order: ' + orderErr?.message)

  // 9. Insert order items — uses ACTUAL order_items columns:
  //    id, order_id, product_id, quantity, price_at_time, created_at, variant_id
  //    (confirmed from vendor_orders_migration.sql — no snapshot columns in this DB)
  const orderItems = input.items.map(i => {
    if (i.variantId === i.productId) {
      // No-variant product — variant_id is null
      const p: any = productMap.get(String(i.productId))
      return {
        order_id:      newOrder.id,
        product_id:    i.productId,
        variant_id:    null,
        quantity:      i.qty,
        price_at_time: Number(p?.price) || 0,
      }
    } else {
      const v: any = variantRows.find((vv: any) => String(vv.id) === String(i.variantId))
      return {
        order_id:      newOrder.id,
        product_id:    i.productId,
        variant_id:    i.variantId,
        quantity:      i.qty,
        price_at_time: Number(v?.price) || 0,
      }
    }
  })
  const { error: itemsErr } = await db.from('order_items').insert(orderItems)
  if (itemsErr) console.error('[createOrder] order_items insert failed:', itemsErr.message)

  // 10. Log creation event
  await logOrderEvent(newOrder.id, 'order_created', 'system', {
    payment_method: input.paymentMethod,
    total:          pricing.total,
    items:          input.items.length,
  })

  return {
    order: {
      id:           newOrder.id,
      order_number: newOrder.order_number,
      total_amount: newOrder.total_amount,
      total:        newOrder.total_amount,
      status:       newOrder.order_status,
    },
    alreadyExists: false,
  }
}

export async function updateOrderStatus(
  orderId: string,
  status:  string,
  extra:   Record<string, unknown> = {},
): Promise<void> {
  const db = getServiceClient()
  await db.from('orders').update({
    order_status: status,
    ...extra,
  }).eq('id', orderId)
}

export async function logOrderEvent(
  orderId:  string,
  event:    string,
  actor:    string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const db = getServiceClient()
  await db.from('order_events').insert({
    order_id:   orderId,
    event,
    actor,
    metadata,
    created_at: new Date().toISOString(),
  })
  // Non-fatal — if order_events table doesn't exist yet, silently continue
  // .then() not needed — fire and forget pattern for audit log
}
