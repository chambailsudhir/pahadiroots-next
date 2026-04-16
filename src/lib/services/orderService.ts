import { getServiceClient } from '@/lib/supabase'
import { checkStockAvailability } from './inventoryService'
import { validateCouponServer, calcPriceSummary } from './pricingService'
import type { OrderStatus, CartItem, SiteSettings, OrderAddress } from '@/types'

// ─── Order State Machine (Audit #A2) ─────────────────────────────────────────
// Only valid transitions are allowed. Any other transition throws.

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  created:           ['pending_payment', 'cancelled'],
  pending_payment:   ['paid', 'cancelled'],
  paid:              ['confirmed', 'cancelled', 'refunded'],
  confirmed:         ['packed', 'cancelled'],
  packed:            ['shipped'],
  shipped:           ['out_for_delivery'],
  out_for_delivery:  ['delivered'],
  delivered:         ['return_requested'],
  cancelled:         ['refunded'],
  return_requested:  ['returned', 'confirmed'],  // confirm = rejected return
  returned:          ['refunded'],
  refunded:          [],
}

export function validateStatusTransition(
  current: OrderStatus,
  next: OrderStatus
): void {
  const allowed = VALID_TRANSITIONS[current] || []
  if (!allowed.includes(next)) {
    throw new Error(
      `Invalid order status transition: ${current} → ${next}. Allowed: ${allowed.join(', ')}`
    )
  }
}

// ─── Create Order (Audit #A3 — transaction safe) ─────────────────────────────

export interface CreateOrderInput {
  address:         OrderAddress
  items:           Array<{ productId: string; variantId: string; qty: number }>
  payment_method:  'razorpay' | 'cod'
  coupon_code?:    string
  idempotency_key: string
  customer_email?: string
  customer_id?:    string
}

export async function createOrder(
  input: CreateOrderInput,
  settings: SiteSettings
): Promise<{ order: any; alreadyExists: boolean }> {
  const db = getServiceClient()

  // 1. Check idempotency — if same key already exists, return existing order
  const { data: existing } = await db
    .from('orders')
    .select('*')
    .eq('idempotency_key', input.idempotency_key)
    .maybeSingle()

  if (existing) return { order: existing, alreadyExists: true }

  // 2. Fetch real prices from DB — NEVER trust client-submitted prices (Audit #A5)
  const variantIds = input.items.map(i => i.variantId)
  const { data: variants, error: varErr } = await db
    .from('product_variants')
    .select('id, price, mrp, gst_rate, available_stock, product_id, size, is_active')
    .in('id', variantIds)

  if (varErr || !variants?.length) throw new Error('Failed to fetch product data')

  const variantMap = new Map(variants.map(v => [v.id, v]))

  // 3. Build server-side cart items
  const serverItems: CartItem[] = input.items.map(item => {
    const v = variantMap.get(item.variantId)
    if (!v || !v.is_active) throw new Error(`Product variant ${item.variantId} not available`)
    return {
      productId: item.productId,
      variantId: item.variantId,
      name:      '',
      slug:      '',
      image:     null,
      emoji:     null,
      size:      v.size || '',
      price:     v.price,
      mrp:       v.mrp,
      gstRate:   v.gst_rate,
      qty:       item.qty,
      maxQty:    v.available_stock,
    }
  })

  // 4. Check stock
  const stockCheck = await checkStockAvailability(
    input.items.map(i => ({ variantId: i.variantId, qty: i.qty }))
  )
  if (!stockCheck.ok) {
    const failed = stockCheck.failedItems[0]
    throw new Error(
      `Insufficient stock. Only ${failed.available} units available.`
    )
  }

  // 5. Validate coupon server-side
  const subtotalForCoupon = serverItems.reduce((s, i) => s + i.price * i.qty, 0)
  let appliedCoupon = null
  if (input.coupon_code) {
    const couponResult = await validateCouponServer(input.coupon_code, subtotalForCoupon)
    if (couponResult.valid && couponResult.coupon) {
      appliedCoupon = couponResult.coupon
    }
  }

  // 6. Calculate final price server-side
  const pricing = calcPriceSummary(serverItems, settings, appliedCoupon, input.payment_method)

  // 7. COD fraud checks (Audit #A6)
  if (input.payment_method === 'cod') {
    const codMax = parseFloat(settings.cod_max_value || '3000')
    if (pricing.total > codMax) {
      throw new Error(`COD not available for orders above ₹${codMax}. Please pay online.`)
    }

    const maxActiveCOD = parseInt(settings.cod_max_active_orders || '3')
    const { count } = await db
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('customer_phone', input.address.phone)
      .eq('payment_method', 'cod')
      .in('status', ['created', 'confirmed', 'packed', 'shipped', 'out_for_delivery'])

    if ((count || 0) >= maxActiveCOD) {
      throw new Error(`Maximum ${maxActiveCOD} active COD orders allowed per number.`)
    }
  }

  // 8. Create order via Supabase RPC (atomic transaction — Audit #A3)
  // The RPC does: INSERT order + INSERT order_items in one transaction
  const { data: order, error: orderErr } = await db.rpc('create_order_atomic', {
    p_customer_name:    input.address.name,
    p_customer_phone:   input.address.phone,
    p_customer_email:   input.customer_email || null,
    p_customer_id:      input.customer_id || null,
    p_payment_method:   input.payment_method,
    p_address:          JSON.stringify(input.address),
    p_subtotal:         pricing.subtotal,
    p_discount:         pricing.discount,
    p_shipping:         pricing.shipping,
    p_gst_total:        pricing.gstTotal,
    p_total:            pricing.total,
    p_coupon_code:      appliedCoupon?.code || null,
    p_idempotency_key:  input.idempotency_key,
    p_items:            JSON.stringify(
      input.items.map(item => {
        const v = variantMap.get(item.variantId)!
        return {
          product_id: item.productId,
          variant_id: item.variantId,
          quantity:   item.qty,
          price:      v.price,
          mrp:        v.mrp,
          gst_rate:   v.gst_rate,
          size:       v.size,
        }
      })
    ),
  })

  if (orderErr) throw new Error('Order creation failed: ' + orderErr.message)

  // 9. Log event (Audit #C16)
  await logOrderEvent(order.id, 'order_created', 'customer', {
    payment_method: input.payment_method,
    total: pricing.total,
  })

  return { order, alreadyExists: false }
}

// ─── Update Order Status (enforces state machine) ────────────────────────────

export async function updateOrderStatus(
  orderId: string,
  newStatus: OrderStatus,
  actor = 'system',
  metadata?: Record<string, unknown>
): Promise<void> {
  const db = getServiceClient()

  // Fetch current status
  const { data: order, error } = await db
    .from('orders')
    .select('status')
    .eq('id', orderId)
    .single()

  if (error || !order) throw new Error('Order not found')

  // Validate transition
  validateStatusTransition(order.status as OrderStatus, newStatus)

  // Update
  const { error: updateErr } = await db
    .from('orders')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', orderId)

  if (updateErr) throw new Error('Status update failed: ' + updateErr.message)

  // Log (Audit #C16)
  await logOrderEvent(orderId, `status_changed_to_${newStatus}`, actor, {
    previous_status: order.status,
    ...metadata,
  })
}

// ─── Event Logger (Audit #C16) ────────────────────────────────────────────────

export async function logOrderEvent(
  orderId: string,
  event: string,
  actor: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const db = getServiceClient()
    await db.from('event_logs').insert({
      entity_type: 'order',
      entity_id:   orderId,
      event,
      actor,
      metadata:    metadata || {},
      created_at:  new Date().toISOString(),
    })
  } catch {
    // Non-critical — don't throw
    console.error('[logOrderEvent] Failed to log:', event, orderId)
  }
}
