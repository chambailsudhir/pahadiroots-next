import { getServiceClient } from '@/lib/supabase'
import { checkStockAvailability } from './inventoryService'
import { validateCouponServer, calcPriceSummary } from './pricingService'
import type { CartItem, SiteSettings } from '@/types'

// Real order_status values from actual DB (admin panel confirmed)
export type RealOrderStatus =
  | 'pending' | 'pending_payment' | 'confirmed' | 'packed'
  | 'shipped' | 'out_for_delivery' | 'delivered' | 'cancelled'
  | 'return_requested' | 'returned' | 'refunded'

const VALID_TRANSITIONS: Record<RealOrderStatus, RealOrderStatus[]> = {
  pending:           ['confirmed', 'cancelled'],
  pending_payment:   ['confirmed', 'cancelled'],
  confirmed:         ['packed', 'cancelled'],
  packed:            ['shipped'],
  shipped:           ['out_for_delivery'],
  out_for_delivery:  ['delivered'],
  delivered:         ['return_requested'],
  cancelled:         ['refunded'],
  return_requested:  ['returned', 'confirmed'],
  returned:          ['refunded'],
  refunded:          [],
}

export function validateStatusTransition(current: RealOrderStatus, next: RealOrderStatus): void {
  const allowed = VALID_TRANSITIONS[current] || []
  if (!allowed.includes(next)) throw new Error(`Invalid transition: ${current} -> ${next}`)
}

export interface CreateOrderInput {
  customerName:   string
  customerPhone:  string
  customerEmail?: string
  flat:     string
  area:     string
  city:     string
  state:    string
  pincode:  string
  label?:   string
  items:         Array<{ productId: string; variantId: string; qty: number }>
  paymentMethod: 'razorpay' | 'cod'
  couponCode?:   string
  idempotencyKey: string
}

export async function createOrder(input: CreateOrderInput, settings: SiteSettings): Promise<{ order: any; alreadyExists: boolean }> {
  const db = getServiceClient()

  // Idempotency check
  const { data: existing } = await db.from('orders').select('*').eq('idempotency_key', input.idempotencyKey).maybeSingle()
  if (existing) return { order: existing, alreadyExists: true }

  // Fetch real prices — never trust client
  const variantIds = input.items.map(i => i.variantId)
  const { data: variants, error: varErr } = await db
    .from('product_variants').select('id, price, mrp, gst_rate, available_stock, product_id, size, is_active').in('id', variantIds)
  if (varErr || !variants?.length) throw new Error('Failed to fetch product data')
  const variantMap = new Map(variants.map(v => [v.id, v]))

  const serverItems: CartItem[] = input.items.map(item => {
    const v = variantMap.get(item.variantId)
    if (!v || !v.is_active) throw new Error(`Product not available`)
    return { productId: item.productId, variantId: item.variantId, name: '', slug: '', image: null, emoji: null, size: v.size || '', price: v.price, mrp: v.mrp, gstRate: v.gst_rate, qty: item.qty, maxQty: v.available_stock }
  })

  // Stock check
  const stockCheck = await checkStockAvailability(input.items.map(i => ({ variantId: i.variantId, qty: i.qty })))
  if (!stockCheck.ok) { const f = stockCheck.failedItems[0]; throw new Error(`Only ${f.available} units available`) }

  // Coupon validation
  const subtotalForCoupon = serverItems.reduce((s, i) => s + i.price * i.qty, 0)
  let appliedCoupon = null
  if (input.couponCode) { const r = await validateCouponServer(input.couponCode, subtotalForCoupon); if (r.valid && r.coupon) appliedCoupon = r.coupon }

  const pricing = calcPriceSummary(serverItems, settings, appliedCoupon, input.paymentMethod)

  // COD fraud checks
  if (input.paymentMethod === 'cod') {
    const codMax = parseFloat(settings.cod_max_value || '3000')
    if (pricing.total > codMax) throw new Error(`COD not available above Rs.${codMax}. Please pay online.`)
    const maxActiveCOD = parseInt(settings.cod_max_active_orders || '3')
    const { data: cust } = await db.from('customers').select('id').eq('phone', input.customerPhone).maybeSingle()
    if (cust) {
      const { count } = await db.from('orders').select('*', { count: 'exact', head: true })
        .eq('customer_id', cust.id).eq('payment_method', 'cod').in('order_status', ['pending','confirmed','packed','shipped','out_for_delivery'])
      if ((count || 0) >= maxActiveCOD) throw new Error(`Max ${maxActiveCOD} active COD orders allowed per number.`)
    }
  }

  // Upsert customer
  const customerId = await upsertCustomer(db, input)

  // Create order atomically
  const { data: order, error: orderErr } = await db.rpc('create_order_atomic', {
    p_customer_id: customerId, p_payment_method: input.paymentMethod,
    p_subtotal: pricing.subtotal, p_discount: pricing.discount, p_shipping: pricing.shipping,
    p_tax: pricing.gstTotal, p_total: pricing.total, p_coupon_code: appliedCoupon?.code || null,
    p_idempotency_key: input.idempotencyKey,
    p_items: JSON.stringify(input.items.map(item => {
      const v = variantMap.get(item.variantId)!
      return { product_id: item.productId, variant_id: item.variantId, quantity: item.qty, price: v.price, mrp: v.mrp, gst_rate: v.gst_rate, size: v.size }
    })),
  })
  if (orderErr) throw new Error('Order creation failed: ' + orderErr.message)

  await logOrderEvent(String(order.id), 'order_created', 'customer', { payment_method: input.paymentMethod, total: pricing.total })
  return { order, alreadyExists: false }
}

async function upsertCustomer(db: any, input: CreateOrderInput): Promise<number> {
  const { data: existing } = await db.from('customers').select('id, saved_addresses').eq('phone', input.customerPhone).maybeSingle()
  const addressEntry = { flat: input.flat, area: input.area, city: input.city, state: input.state, pincode: input.pincode, label: input.label || 'Home' }

  if (existing) {
    const savedAddresses = existing.saved_addresses || []
    const alreadySaved = savedAddresses.some((a: any) => a.flat === input.flat && a.pincode === input.pincode)
    await db.from('customers').update({
      address_line1: input.flat, address_line2: input.area, city: input.city, state: input.state,
      postal_code: input.pincode, email: input.customerEmail || undefined,
      saved_addresses: alreadySaved ? savedAddresses : [...savedAddresses, addressEntry].slice(-5),
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id)
    return existing.id
  }

  const { data: newCust, error } = await db.from('customers').insert({
    phone: input.customerPhone,
    first_name: input.customerName.split(' ')[0] || input.customerName,
    last_name: input.customerName.split(' ').slice(1).join(' ') || null,
    email: input.customerEmail || null,
    address_line1: input.flat, address_line2: input.area, city: input.city,
    state: input.state, postal_code: input.pincode,
    saved_addresses: [addressEntry],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select('id').single()
  if (error) throw new Error('Customer creation failed: ' + error.message)
  return newCust.id
}

export async function updateOrderStatus(orderId: string | number, newStatus: RealOrderStatus, actor = 'system', metadata?: Record<string, unknown>): Promise<void> {
  const db = getServiceClient()
  const { data: order, error } = await db.from('orders').select('order_status').eq('id', orderId).single()
  if (error || !order) throw new Error('Order not found')
  validateStatusTransition(order.order_status as RealOrderStatus, newStatus)
  await db.from('orders').update({ order_status: newStatus, updated_at: new Date().toISOString() }).eq('id', orderId)
  await logOrderEvent(String(orderId), `status_changed_to_${newStatus}`, actor, { previous_status: order.order_status, ...metadata })
}

export async function logOrderEvent(orderId: string, event: string, actor: string, metadata?: Record<string, unknown>): Promise<void> {
  try {
    const db = getServiceClient()
    await db.from('event_logs').insert({ entity_type: 'order', entity_id: orderId, event, actor, metadata: metadata || {}, created_at: new Date().toISOString() })
  } catch { /* non-critical */ }
}
