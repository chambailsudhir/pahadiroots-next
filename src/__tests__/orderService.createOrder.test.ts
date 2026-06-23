/**
 * orderService.createOrder.test.ts
 *
 * createOrder() in lib/services/orderService.ts is the single most
 * security-and-money-critical function in the codebase — it resolves live
 * prices, re-validates coupons, enforces loyalty caps, reserves stock
 * atomically, and creates the order via an RPC transaction.
 *
 * AUDIT GAP: every existing test (paymentOrderRoutes.test.ts) mocks
 * createOrder() entirely via vi.mock — meaning the function body itself,
 * and every one of its documented BUG FIX / DATA INTEGRITY comments, had
 * ZERO direct test coverage. This file closes that gap by testing
 * createOrder() in isolation, mocking only its two dependencies:
 *   • global.fetch        (used by sbGet/sbPost for products/variants/customers)
 *   • getServiceClient    (used by db.from()/db.rpc() for orders/coupons/loyalty)
 *
 * Covered regressions:
 *   1. Idempotency — duplicate idempotency_key returns existing order, no new RPC
 *   2. Stock reservation failure → throws, no order created
 *   3. Coupon server-side re-validation — max_uses, expiry, min_order all enforced
 *      even though /api/v1/coupons already checked client-side (defence in depth)
 *   4. max_discount ?? not || — max_discount: 0 must be respected, not ignored
 *   5. Loyalty max_redeem_pct cap — clamps even if customer has enough points
 *   6. Loyalty balance guard — live DB balance re-checked, throws if insufficient
 *   7. paymentMethod passed through to calcPriceSummary — razorpay orders get the
 *      prepaid discount baked into total_amount; cod orders do not
 *   8. order_status / payment_status — cod → 'confirmed'/'cod_pending'; razorpay → 'pending'/'pending'
 *   9. Coupon uses_count optimistic-lock increment — update includes the snapshot guard
 *  10. Finally-block stock restore — any throw after reservation triggers restoreStock
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock: @/lib/supabase (db.from / db.rpc) ──────────────────────────────────

interface MockDb {
  responses:    Record<string, unknown>   // keyed by table name
  rpcResponses: Record<string, unknown>   // keyed by rpc name
  rpcCalls:     Array<{ rpcName: string; args: unknown }>
  updateCalls:  Array<{ table: string; payload: unknown; eqCalls: unknown[][] }>
}

let mockDb: MockDb

function resetMockDb() {
  mockDb = { responses: {}, rpcResponses: {}, rpcCalls: [], updateCalls: [] }
}

function buildQueryBuilder(table: string) {
  const response = () => {
    const val = mockDb.responses[table]
    if (val instanceof Error) return { data: null, error: val }
    return { data: val ?? null, error: null }
  }

  let currentUpdate: { table: string; payload: unknown; eqCalls: unknown[][] } | null = null

  const builder: Record<string, (...a: unknown[]) => unknown> = {
    select:      () => builder,
    insert:      () => builder,
    update:      (payload: unknown) => {
      currentUpdate = { table, payload, eqCalls: [] }
      mockDb.updateCalls.push(currentUpdate)
      return builder
    },
    delete:      () => builder,
    upsert:      () => builder,
    eq:          (...args: unknown[]) => {
      if (currentUpdate) currentUpdate.eqCalls.push(args)
      return builder
    },
    neq:         () => builder,
    in:          () => builder,
    limit:       () => builder,
    order:       () => builder,
    maybeSingle: () => Promise.resolve(response()),
    single:      () => Promise.resolve(response()),
    then:        (...a: unknown[]) => Promise.resolve(response()).then(a[0] as (v: unknown) => unknown),
  }
  return builder
}

vi.mock('@/lib/supabase', () => ({
  getServiceClient: () => ({
    from: (table: string) => buildQueryBuilder(table),
    rpc:  (name: string, args: unknown) => {
      mockDb.rpcCalls.push({ rpcName: name, args })
      const val = mockDb.rpcResponses[name]
      if (val instanceof Error) return Promise.resolve({ data: null, error: val })
      return Promise.resolve({ data: val ?? true, error: null })
    },
  }),
  supabase: {},
}))

// ─── Mock: global.fetch (sbGet/sbPost REST calls for products/variants/customers) ──

interface FetchRoute {
  match: (url: string, method: string) => boolean
  respond: (url: string, method: string, body?: string) => { ok: boolean; status?: number; json: unknown }
}

let fetchRoutes: FetchRoute[] = []
let fetchCalls: Array<{ url: string; method: string; body?: string }> = []

function resetFetchRoutes() {
  fetchRoutes = []
  fetchCalls = []
}

function route(matcher: (url: string, method: string) => boolean, json: unknown) {
  fetchRoutes.push({ match: matcher, respond: () => ({ ok: true, json }) })
}

const mockFetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
  const method = init?.method ?? 'GET'
  fetchCalls.push({ url, method, body: init?.body })
  const found = fetchRoutes.find(r => r.match(url, method))
  const result = found ? found.respond(url, method, init?.body) : { ok: false, status: 404, json: { message: 'no mock route' } }
  return {
    ok:     result.ok,
    status: result.status ?? (result.ok ? 200 : 500),
    json:   async () => result.json,
    text:   async () => JSON.stringify(result.json),
  }
})

beforeEach(() => {
  resetMockDb()
  resetFetchRoutes()
  fetchCalls = []
  mockFetch.mockClear()
  vi.stubGlobal('fetch', mockFetch)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_KEY     = 'test-service-key'
})

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  free_shipping_min:     '799',
  flat_shipping_charge:  '99',
  prepaid_discount_pct:  '5',
  cod_enabled:           'true',
  loyalty_points_value:       '0.25',
  loyalty_max_redeem_pct:     '20',
} as any

const VARIANT_ID  = 'var-uuid-1'
const PRODUCT_ID  = 'prod-uuid-1'

const BASE_INPUT = {
  customerName:   'Ramesh Kumar',
  customerPhone:  '9876543210',
  customerEmail:  'ramesh@example.com',
  flat:           '12 Pahadi Lane',
  area:           'Shimla Hills',
  city:           'Shimla',
  state:          'Himachal Pradesh',
  pincode:        '171001',
  items:          [{ productId: PRODUCT_ID, variantId: VARIANT_ID, qty: 2 }],
  paymentMethod:  'cod' as const,
  idempotencyKey: '123e4567-e89b-12d3-a456-426614174000',
}

// Wires up the standard happy-path fetch routes: variant lookup, product lookup,
// customer lookup (not found) + customer insert.
function wireHappyPathFetch(opts: { variantPrice?: number; gstRate?: number } = {}) {
  const variantPrice = opts.variantPrice ?? 200
  const gstRate       = opts.gstRate ?? 5

  // 1. product_variants lookup (sbGet)
  route(
    (url, method) => method === 'GET' && url.includes('/product_variants') && url.includes(VARIANT_ID),
    [{ id: VARIANT_ID, price: variantPrice, original_price: variantPrice + 50, is_active: true, available_stock: 10, product_id: PRODUCT_ID }]
  )
  // 2. products lookup (sbGet)
  route(
    (url, method) => method === 'GET' && url.includes('/products') && url.includes(PRODUCT_ID),
    [{ id: PRODUCT_ID, name: 'Himalayan Honey', emoji: '🍯', gst_rate: gstRate, is_deleted: false, status: 'active', price: variantPrice, mrp: variantPrice + 50, available_stock: 10 }]
  )
  // 3. customer lookup by phone — not found
  route(
    (url, method) => method === 'GET' && url.includes('/customers') && url.includes('phone=eq.'),
    []
  )
  // 4. customer insert
  route(
    (url, method) => method === 'POST' && url.includes('/customers'),
    [{ id: 'cust-uuid-001' }]
  )
}

function wireOrderRpcSuccess(overrides: Partial<{ id: string; order_number: string; total_amount: number; order_status: string }> = {}) {
  mockDb.rpcResponses['create_order_with_items'] = [{
    id:           overrides.id ?? 'order-db-uuid-001',
    order_number: overrides.order_number ?? 'PR1A2B3C4D',
    total_amount: overrides.total_amount ?? 299,
    order_status: overrides.order_status ?? 'confirmed',
  }]
}

// ─────────────────────────────────────────────────────────────────────────────

describe('createOrder — idempotency', () => {
  it('returns existing order immediately when idempotency_key already exists, without reserving stock or calling the RPC', async () => {
    mockDb.responses['orders'] = {
      id: 'order-existing-001', order_number: 'PREXIST01', total_amount: 500, order_status: 'confirmed',
    }
    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder(BASE_INPUT, DEFAULT_SETTINGS)

    expect(result.alreadyExists).toBe(true)
    expect(result.order.order_number).toBe('PREXIST01')
    expect(result.order.total_amount).toBe(500)
    // No order RPC call and no product/variant fetches — should short-circuit
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
    expect(fetchCalls.length).toBe(0)
  })
})

describe('createOrder — stock reservation failure', () => {
  it('throws and never reaches the RPC when stock reservation fails', async () => {
    mockDb.responses['orders'] = null  // no existing idempotent order
    mockDb.rpcResponses['reserve_stock_at_order'] = false  // RPC returns falsy → reservation fails
    wireHappyPathFetch()

    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder(BASE_INPUT, DEFAULT_SETTINGS)).rejects.toThrow(/insufficient stock/i)

    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
  })

  it('restores stock via restoreStock when a later step throws after reservation succeeded', async () => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true  // reservation succeeds
    // Make the products fetch fail so createOrder throws AFTER reservation
    route((url, method) => method === 'GET' && url.includes('/product_variants'), [
      { id: VARIANT_ID, price: 200, original_price: 250, is_active: true, available_stock: 10, product_id: PRODUCT_ID },
    ])
    route((url, method) => method === 'GET' && url.includes('/products'), [])  // empty → throws "product IDs not found"

    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder(BASE_INPUT, DEFAULT_SETTINGS)).rejects.toThrow(/product details/i)

    // restoreStock calls db.rpc('restore_stock', ...) — verify it fired
    const restoreCall = mockDb.rpcCalls.find(c => c.rpcName === 'restore_stock')
    expect(restoreCall).toBeDefined()
    expect((restoreCall!.args as any).p_variant_id).toBe(VARIANT_ID)
    expect((restoreCall!.args as any).p_qty).toBe(2)
  })
})

describe('createOrder — coupon server-side re-validation (defence in depth)', () => {
  beforeEach(() => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
    wireOrderRpcSuccess()
  })

  it('rejects an order when the coupon usage limit has been reached', async () => {
    mockDb.responses['coupons'] = {
      code: 'SAVE10', value: 10, type: 'percent', max_uses: 5, uses_count: 5,
      is_active: true, expires_at: null, min_order: null, max_discount: null,
    }
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, couponCode: 'SAVE10' }, DEFAULT_SETTINGS))
      .rejects.toThrow(/usage limit reached/i)
  })

  it('rejects an order when the coupon has expired', async () => {
    mockDb.responses['coupons'] = {
      code: 'EXPIRED', value: 10, type: 'percent', max_uses: null, uses_count: 0,
      is_active: true, expires_at: '2020-01-01T00:00:00Z', min_order: null, max_discount: null,
    }
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, couponCode: 'EXPIRED' }, DEFAULT_SETTINGS))
      .rejects.toThrow(/expired/i)
  })

  it('rejects an order below the coupon min_order threshold even though the client already checked', async () => {
    // Order subtotal here is 2 * 200 = 400; min_order requires 1000
    mockDb.responses['coupons'] = {
      code: 'BIGORDER', value: 10, type: 'percent', max_uses: null, uses_count: 0,
      is_active: true, expires_at: null, min_order: 1000, max_discount: null,
    }
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, couponCode: 'BIGORDER' }, DEFAULT_SETTINGS))
      .rejects.toThrow(/minimum order/i)
  })

  // BUG FIX regression: max_discount ?? Infinity, not || Infinity.
  // max_discount: 0 must cap the discount at 0, not be treated as "no cap".
  it('respects max_discount = 0 as a real cap (not treated as falsy/no-cap)', async () => {
    mockDb.responses['coupons'] = {
      code: 'ZEROCAP', value: 50, type: 'percent', max_uses: null, uses_count: 0,
      is_active: true, expires_at: null, min_order: null, max_discount: 0,
    }
    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder({ ...BASE_INPUT, couponCode: 'ZEROCAP' }, DEFAULT_SETTINGS)

    expect(result.alreadyExists).toBe(false)
    // p_coupon_discount sent to the RPC must be 0 (capped), not 200 (50% of 400)
    const rpcCall = mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')
    expect((rpcCall!.args as any).p_coupon_discount).toBe(0)
  })

  it('increments coupon uses_count with an optimistic-lock eq guard on the snapshot value', async () => {
    mockDb.responses['coupons'] = {
      code: 'TRACK5', value: 10, type: 'percent', max_uses: 100, uses_count: 5,
      is_active: true, expires_at: null, min_order: null, max_discount: null,
    }
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...BASE_INPUT, couponCode: 'TRACK5' }, DEFAULT_SETTINGS)

    const couponUpdate = mockDb.updateCalls.find(c => c.table === 'coupons')
    expect(couponUpdate).toBeDefined()
    expect((couponUpdate!.payload as any).uses_count).toBe(6)
    // Optimistic lock: .eq('uses_count', 5) must be present so a concurrent
    // order that already incremented it causes this update to match 0 rows
    // instead of double-incrementing.
    const eqOnUsesCount = couponUpdate!.eqCalls.some(args => args[0] === 'uses_count' && args[1] === 5)
    expect(eqOnUsesCount).toBe(true)
  })
})

describe('createOrder — loyalty enforcement', () => {
  beforeEach(() => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    // Subtotal = 2 * 1000 = 2000, so max_redeem_pct=20% caps loyalty at 400
    wireHappyPathFetch({ variantPrice: 1000 })
    wireOrderRpcSuccess({ total_amount: 1701 })
  })

  it('clamps loyalty discount to max_redeem_pct of subtotal, even when customer has a much larger balance', async () => {
    mockDb.responses['customers'] = { loyalty_points: 100_000 }  // huge balance
    const { createOrder } = await import('@/lib/services/orderService')
    // request 5000 points * 0.25 = 1250 ₹, cap = 20% of 2000 = 400 ₹
    await createOrder({ ...BASE_INPUT, loyaltyPointsRedeemed: 5000 }, DEFAULT_SETTINGS)

    const rpcCall = mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')
    // subtotal=2000, shipping=0 (>=799 free ship), loyaltyDiscount=400 → afterDiscount=1600, total cod=1600+0=1600
    expect((rpcCall!.args as any).p_total_amount).toBe(1600)
  })

  it('throws when requested loyalty points exceed the live DB balance (race-condition guard)', async () => {
    mockDb.responses['customers'] = { loyalty_points: 50 }  // small balance
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, loyaltyPointsRedeemed: 500 }, DEFAULT_SETTINGS))
      .rejects.toThrow(/insufficient loyalty balance/i)
  })
})

describe('createOrder — payment method correctness (DATA INTEGRITY FIX)', () => {
  beforeEach(() => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch({ variantPrice: 500 })
  })

  it('applies the prepaid discount to total_amount for razorpay orders (real paymentMethod passed through)', async () => {
    wireOrderRpcSuccess()
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...BASE_INPUT, paymentMethod: 'razorpay' }, DEFAULT_SETTINGS)

    // subtotal = 2*500=1000, free ship (>=799) → shipping=0
    // prepaidDiscount = round(1000 * 5/100) = 50 → total = 1000+0-50 = 950
    const rpcCall = mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')
    expect((rpcCall!.args as any).p_total_amount).toBe(950)
  })

  it('does NOT apply the prepaid discount for cod orders (prepaid is razorpay-only)', async () => {
    wireOrderRpcSuccess()
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...BASE_INPUT, paymentMethod: 'cod' }, DEFAULT_SETTINGS)

    // Same cart, cod → no prepaid discount → total = 1000+0-0 = 1000
    const rpcCall = mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')
    expect((rpcCall!.args as any).p_total_amount).toBe(1000)
  })

  it('sets order_status=confirmed and payment_status=cod_pending for COD orders', async () => {
    wireOrderRpcSuccess()
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...BASE_INPUT, paymentMethod: 'cod' }, DEFAULT_SETTINGS)

    const rpcCall = mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')
    expect((rpcCall!.args as any).p_order_status).toBe('confirmed')
    expect((rpcCall!.args as any).p_payment_status).toBe('cod_pending')
  })

  it('sets order_status=pending and payment_status=pending for razorpay orders (awaiting verify_payment)', async () => {
    wireOrderRpcSuccess()
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...BASE_INPUT, paymentMethod: 'razorpay' }, DEFAULT_SETTINGS)

    const rpcCall = mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')
    expect((rpcCall!.args as any).p_order_status).toBe('pending')
    expect((rpcCall!.args as any).p_payment_status).toBe('pending')
  })

  it('rejects a COD order when cod_enabled setting is false', async () => {
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, paymentMethod: 'cod' }, { ...DEFAULT_SETTINGS, cod_enabled: 'false' }))
      .rejects.toThrow(/cod is not available/i)
  })
})

describe('createOrder — happy path return shape', () => {
  it('returns enriched cartItems (name/emoji/qty/price) for the email template', async () => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch({ variantPrice: 300 })
    wireOrderRpcSuccess({ total_amount: 600 })

    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder(BASE_INPUT, DEFAULT_SETTINGS)

    expect(result.alreadyExists).toBe(false)
    expect(result.customerId).toBe('cust-uuid-001')
    expect(result.order.cartItems).toHaveLength(1)
    expect(result.order.cartItems[0]).toMatchObject({ name: 'Himalayan Honey', emoji: '🍯', qty: 2, price: 300 })
  })
})
