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
    input.items.map(i => ({ variantId: i.variantId, qty: i.qty }))
  )
  if (!stockCheck.ok) {
    const failed = stockCheck.failedItems.map(f => `variantId:${f.variantId} (req:${f.requested} avail:${f.available})`).join(', ')
    throw new Error(`Insufficient stock: ${failed}`)
  }

  // 3. Fetch product/variant prices from DB (never trust client prices)
  const variantIds = input.items.map(i => i.variantId)
  const { data: variants, error: varErr } = await db
    .from('product_variants')
    .select('id, price, mrp, is_active, available_stock, products(id, name, emoji, gst_rate, is_deleted, status)')
    .in('id', variantIds.map(id => isNaN(Number(id)) ? id : Number(id)))

  if (varErr || !variants?.length) throw new Error('Could not fetch product details')

  // Helper to safely extract product from Supabase join (can be object or array)
  type ProductRow = { id: unknown; name: unknown; emoji: unknown; gst_rate: unknown; is_deleted: unknown; status: unknown }
  function getProduct(raw: unknown): ProductRow {
    if (Array.isArray(raw)) return (raw[0] ?? {}) as ProductRow
    return (raw ?? {}) as ProductRow
  }

  // Validate all products are active
  for (const v of variants) {
    const p = getProduct(v.products as unknown)
    if (p?.is_deleted || p?.status !== 'active' || !v.is_active) {
      throw new Error(`Product no longer available`)
    }
  }

  // Build CartItem array for pricing — map our DB fields to CartItem shape
  const cartItems: import('@/types').CartItem[] = input.items.map(i => {
    const v = variants.find(vv => String(vv.id) === String(i.variantId))!
    const p = getProduct(v.products as unknown)
    return {
      productId:  i.productId,
      variantId:  i.variantId,
      name:       String(p?.name  ?? ''),
      slug:       '',                          // not needed for price calc
      image:      null,                        // not needed for price calc
      emoji:      String(p?.emoji ?? '🌿'),
      size:       '',                          // not needed for price calc
      price:      Number(v.price)  || 0,
      mrp:        Number(v.mrp)    || 0,
      gstRate:    Number(p?.gst_rate ?? 0),   // CartItem uses gstRate not gst_rate
      qty:        i.qty,
      maxQty:     Number(v.available_stock) || 999,
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

  // 8. Create order record
  const shippingAddress = {
    name:    input.customerName,
    phone:   input.customerPhone,
    flat:    input.flat,
    area:    input.area,
    city:    input.city,
    state:   input.state,
    pincode: input.pincode,
    label:   input.label ?? 'Home',
  }

  const { data: newOrder, error: orderErr } = await db
    .from('orders')
    .insert({
      order_number:     orderNumber,
      order_status:     input.paymentMethod === 'cod' ? 'confirmed' : 'pending_payment',
      payment_method:   input.paymentMethod,
      payment_status:   input.paymentMethod === 'cod' ? 'pending' : 'awaiting_payment',
      subtotal:         pricing.subtotal,
      coupon_discount:  pricing.discount,
      coupon_code:      input.couponCode ?? null,
      shipping_charge:  pricing.shipping,
      tax:              pricing.gstTotal,
      total_amount:     pricing.total,
      shipping_address: shippingAddress,
      customer_name:    input.customerName,
      customer_phone:   input.customerPhone,
      customer_email:   input.customerEmail ?? null,
      idempotency_key:  input.idempotencyKey,
      created_at:       new Date().toISOString(),
      updated_at:       new Date().toISOString(),
    })
    .select('id, order_number, total_amount, order_status')
    .single()

  if (orderErr || !newOrder) throw new Error('Failed to create order: ' + orderErr?.message)

  // 9. Insert order items
  const orderItems = input.items.map(i => {
    const v = variants.find(vv => String(vv.id) === String(i.variantId))!
    const p = getProduct(v.products as unknown)
    return {
      order_id:               newOrder.id,
      product_id:             i.productId,
      variant_id:             i.variantId,
      quantity:               i.qty,
      price_at_time:          Number(v.price) || 0,
      mrp_at_time:            Number(v.mrp)   || 0,
      product_name_snapshot:  String(p?.name  ?? ''),
      variant_value_snapshot: null,
    }
  })

  await db.from('order_items').insert(orderItems)

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
    updated_at:   new Date().toISOString(),
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

