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
 *   9. Coupon claimed atomically (claim_coupon_use) before the order, attached after, released on failure (F-07)
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
  const response = (terminal: 'maybeSingle' | 'single' | 'then' = 'then') => {
    // A canned response may be a function of the terminal call, so one table can answer a
    // single-row lookup (maybeSingle) differently from a list read (awaited builder).
    const raw = mockDb.responses[table]
    const val = typeof raw === 'function' ? (raw as (t: string) => unknown)(terminal) : raw
    if (val instanceof Error) return { data: null, error: val }
    // Count-style queries (.select('id', { count: 'exact', head: true })) —
    // used by the per-customer coupon usage check — resolve to
    // { count, error }, not { data, error }. A canned response shaped like
    // { count: N } is treated as a count response; everything else keeps
    // the existing { data, error } shape untouched.
    if (val && typeof val === 'object' && !Array.isArray(val) && 'count' in val) {
      return { data: null, error: null, count: (val as { count: number }).count }
    }
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
    is:          () => builder,
    gt:          () => builder,
    gte:         () => builder,
    lt:          () => builder,
    lte:         () => builder,
    in:          () => builder,
    limit:       () => builder,
    order:       () => builder,
    maybeSingle: () => Promise.resolve(response('maybeSingle')),
    single:      () => Promise.resolve(response('single')),
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
      // F-07: claim_coupon_use returns a JSON verdict, not a bare boolean.
      if (val === undefined && name === 'claim_coupon_use') return Promise.resolve({ data: { ok: true, usage_id: 1 }, error: null })
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

// Same as route(), but takes priority over routes already registered (e.g.
// wireHappyPathFetch's default "customer not found" route, which matches
// any /customers URL containing "phone=eq." — including our
// "normalized_phone=eq." per-customer-limit lookup, since that string
// contains "phone=eq." as a substring). Tests that need to simulate an
// *existing* customer for that lookup register their override with this
// instead of route().
function routeFirst(matcher: (url: string, method: string) => boolean, json: unknown) {
  fetchRoutes.unshift({ match: matcher, respond: () => ({ ok: true, json }) })
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
  // 3. customer lookup by phone / email (AUDIT S1-002: read-only guest identity) — not found
  route(
    (url, method) => method === 'GET' && url.includes('/customers') && (url.includes('phone=eq.') || url.includes('email=eq.') || url.includes('email=ilike.')),
    []
  )
  // 4. customer insert
  route(
    (url, method) => method === 'POST' && url.includes('/customers'),
    [{ id: 'cust-uuid-001' }]
  )
  // 5. cod_max_active_orders fraud-check lookup (sbGet) — default: no active
  //    COD orders for this customer, so the guard never blocks by default.
  //    Tests exercising the guard itself override this route explicitly.
  route(
    (url, method) => method === 'GET' && url.includes('/orders') && url.includes('payment_method=in.'),
    []
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
      payment_method: 'cod', loyalty_points_redeemed: 0,
    }
    // P3: a reused key is only a retry when the stored order matches the request.
    mockDb.responses['order_items'] = [{ product_id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 2 }]
    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder(BASE_INPUT, DEFAULT_SETTINGS)

    expect(result.alreadyExists).toBe(true)
    expect(result.order.order_number).toBe('PREXIST01')
    expect(result.order.total_amount).toBe(500)
    // No order RPC call and no product/variant fetches — should short-circuit
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
    expect(fetchCalls.length).toBe(0)
  })

  // ── P3: the same key reused for a DIFFERENT request must never return the old order ──
  describe('P3 — key reused with a different request throws IdempotencyConflictError', () => {
    const existingOrder = {
      id: 'order-existing-003', order_number: 'PREXIST03', total_amount: 500, order_status: 'pending',
      payment_status: 'pending', payment_method: 'razorpay', loyalty_points_redeemed: 0,
    }

    const expectConflict = async (input: typeof BASE_INPUT | Record<string, unknown>) => {
      const { createOrder, IdempotencyConflictError } = await import('@/lib/services/orderService')
      await expect(createOrder(input as any, DEFAULT_SETTINGS)).rejects.toBeInstanceOf(IdempotencyConflictError)
      // never reserved stock / created anything
      expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
      expect(mockDb.rpcCalls.find(c => c.rpcName === 'reserve_stock_at_order')).toBeUndefined()
    }

    it('payment method switched (abandoned razorpay order must not be returned for a COD request)', async () => {
      mockDb.responses['orders'] = { ...existingOrder, payment_method: 'razorpay' }
      mockDb.responses['order_items'] = [{ product_id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 2 }]
      await expectConflict({ ...BASE_INPUT, paymentMethod: 'cod' })
    })

    it('quantity changed since the original order', async () => {
      mockDb.responses['orders'] = { ...existingOrder, payment_method: 'cod' }
      mockDb.responses['order_items'] = [{ product_id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 1 }]
      await expectConflict(BASE_INPUT) // BASE_INPUT asks for qty 2
    })

    it('redeemed loyalty points changed', async () => {
      mockDb.responses['orders'] = { ...existingOrder, payment_method: 'cod', loyalty_points_redeemed: 100 }
      mockDb.responses['order_items'] = [{ product_id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 2 }]
      await expectConflict(BASE_INPUT)
    })

    it('existing order is cancelled / payment_failed → start a new one', async () => {
      mockDb.responses['orders'] = { ...existingOrder, payment_method: 'cod', order_status: 'payment_failed' }
      mockDb.responses['order_items'] = [{ product_id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 2 }]
      await expectConflict(BASE_INPUT)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// I3 / I2 — "no-variant" lines (variantId === productId) and variant ownership
// ─────────────────────────────────────────────────────────────────────────────
describe('createOrder — I3: variantId === productId is only valid for products with NO active variants', () => {
  const NV_ID = 'prod-nv-1'
  const nvInput = { ...BASE_INPUT, items: [{ productId: NV_ID, variantId: NV_ID, qty: 1 }] }
  const isPreflightLookup = (url: string, method: string) =>
    method === 'GET' && url.includes('/product_variants') && url.includes(`product_id=in.(${NV_ID})`)
  const nvProductRow = [{ id: NV_ID, name: 'Plain Salt', emoji: '🧂', gst_rate: 5, is_deleted: false, status: 'active', price: 100, selling_price: 100, mrp: 120, available_stock: 10 }]
  // Line-kind lookup: "does a variant with THIS id exist, and whose is it?" (see lib/lineKinds.ts).
  // Default for these tests: no variant has the product's id → genuinely a bare product.
  const isOwnerLookup = (url: string, method: string, id = NV_ID) =>
    method === 'GET' && url.includes('/product_variants') && url.includes(`select=id,product_id&id=in.(${id})`)

  beforeEach(() => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    mockDb.rpcResponses['reserve_product_stock_at_order'] = true
    wireHappyPathFetch()
    route((url, method) => isOwnerLookup(url, method), [])
  })

  it('ATTACK: product that HAS active variants sent as variantId===productId → rejected BEFORE any stock is reserved', async () => {
    routeFirst(isPreflightLookup, [{ id: 'var-expensive', product_id: NV_ID }])
    const { createOrder } = await import('@/lib/services/orderService')

    await expect(createOrder(nvInput, DEFAULT_SETTINGS)).rejects.toThrow(/multiple options/i)

    expect(mockDb.rpcCalls.find(c => c.rpcName === 'reserve_product_stock_at_order')).toBeUndefined()
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'reserve_stock_at_order')).toBeUndefined()
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
    // and nothing needs restoring because nothing was reserved
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'restore_product_stock')).toBeUndefined()
  })

  it('fails CLOSED when the variants lookup itself fails (never prices from the products table on a guess)', async () => {
    fetchRoutes.unshift({ match: isPreflightLookup, respond: () => ({ ok: false, status: 500, json: { message: 'db down' } }) })
    const { createOrder } = await import('@/lib/services/orderService')

    await expect(createOrder(nvInput, DEFAULT_SETTINGS)).rejects.toThrow()
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'reserve_product_stock_at_order')).toBeUndefined()
  })

  it('genuine no-variant product (no active variants) is allowed and reserves from the PRODUCTS table', async () => {
    routeFirst(isPreflightLookup, [])
    routeFirst((url, method) => method === 'GET' && url.includes('/products') && url.includes(NV_ID), nvProductRow)
    wireOrderRpcSuccess()

    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder(nvInput, DEFAULT_SETTINGS)

    const reserve = mockDb.rpcCalls.find(c => c.rpcName === 'reserve_product_stock_at_order')
    expect(reserve?.args).toEqual({ p_product_id: NV_ID, p_qty: 1 })
  })

  it('I2: a stored order_items row always round-trips to the VARIANT restore path (variant_id is a foreign key to product_variants)', async () => {
    // Whatever was stored, order_items.variant_id references a real product_variants row, so
    // stock for a stored line is always restored to a variant — never guessed from equal ids.
    const { orderItemsToStockItems } = await import('@/lib/services/inventoryService')
    expect(orderItemsToStockItems([{ product_id: NV_ID, variant_id: NV_ID, quantity: 1 }]))
      .toEqual([{ variantId: NV_ID, productId: NV_ID, qty: 1, kind: 'variant' }])
    expect(orderItemsToStockItems([{ product_id: 14, variant_id: 11, quantity: 2 }]))
      .toEqual([{ variantId: '11', productId: '14', qty: 2, kind: 'variant' }])
  })

  // ── Line-kind classification (Oct 2026 audit; live product 1 / variant 1) ─────────────
  describe('variantId === productId when a REAL variant shares its product id', () => {
    const HONEY = '1'
    const honeyVariantRow = [{ id: HONEY, price: 200, original_price: 250, is_active: true, available_stock: 10, product_id: HONEY }]
    const honeyProductRow = [{ id: HONEY, name: 'Himalayan Wild Manali Honey', emoji: '🍯', gst_rate: 5, is_deleted: false, status: 'active', price: 150, selling_price: 150, mrp: 180, available_stock: 0 }]
    const honeyInput = { ...BASE_INPUT, items: [{ productId: HONEY, variantId: HONEY, qty: 1 }] }

    it('is a normal variant purchase: NOT rejected as "multiple options", reserved and priced from the VARIANT', async () => {
      routeFirst((url, method) => isOwnerLookup(url, method, HONEY), [{ id: HONEY, product_id: HONEY }])
      routeFirst((url, method) => method === 'GET' && url.includes('/product_variants') && url.includes(`id=in.(${HONEY})`) && url.includes('price'), honeyVariantRow)
      routeFirst((url, method) => method === 'GET' && url.includes('/rest/v1/products?') && url.includes(`id=in.(${HONEY})`), honeyProductRow)
      wireOrderRpcSuccess()

      const { createOrder } = await import('@/lib/services/orderService')
      await createOrder(honeyInput, DEFAULT_SETTINGS)

      // stock is taken from the variant row, NOT from the products row
      expect(mockDb.rpcCalls.find(c => c.rpcName === 'reserve_stock_at_order')?.args).toEqual({ p_variant_id: HONEY, p_qty: 1 })
      expect(mockDb.rpcCalls.find(c => c.rpcName === 'reserve_product_stock_at_order')).toBeUndefined()
      // priced from the variant (200), not the products row (150)
      const rpc = mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')
      const items = (rpc!.args as { p_items: Array<{ price_at_time: number; variant_id: string }> }).p_items
      expect(items[0].price_at_time).toBe(200)
      expect(items[0].variant_id).toBe(HONEY)
    })

    it('a failed order restores the VARIANT stock, not the products row', async () => {
      routeFirst((url, method) => isOwnerLookup(url, method, HONEY), [{ id: HONEY, product_id: HONEY }])
      routeFirst((url, method) => method === 'GET' && url.includes('/product_variants') && url.includes(`id=in.(${HONEY})`) && url.includes('price'),
        [{ ...honeyVariantRow[0], is_active: false }])   // deactivated between reserve and price lookup → throws after reservation
      routeFirst((url, method) => method === 'GET' && url.includes('/rest/v1/products?') && url.includes(`id=in.(${HONEY})`), honeyProductRow)

      const { createOrder } = await import('@/lib/services/orderService')
      await expect(createOrder(honeyInput, DEFAULT_SETTINGS)).rejects.toThrow(/no longer available/i)

      expect(mockDb.rpcCalls.find(c => c.rpcName === 'restore_stock')?.args).toEqual({ p_variant_id: HONEY, p_qty: 1 })
      expect(mockDb.rpcCalls.find(c => c.rpcName === 'restore_product_stock')).toBeUndefined()
    })

    it('LEGACY line: variantId === productId but that id is ANOTHER product\'s variant → rejected, nothing reserved', async () => {
      // old clients stored the product id in the variant slot: product 14 / "variant 14", and
      // variant 14 actually belongs to product 16.
      routeFirst((url, method) => isOwnerLookup(url, method, '14'), [{ id: '14', product_id: '16' }])
      const { createOrder } = await import('@/lib/services/orderService')

      await expect(createOrder({ ...BASE_INPUT, items: [{ productId: '14', variantId: '14', qty: 1 }] }, DEFAULT_SETTINGS))
        .rejects.toThrow(/no longer available/i)

      expect(mockDb.rpcCalls.find(c => c.rpcName === 'reserve_stock_at_order')).toBeUndefined()
      expect(mockDb.rpcCalls.find(c => c.rpcName === 'reserve_product_stock_at_order')).toBeUndefined()
    })
  })

  it('a variant that belongs to a DIFFERENT product than the client named → rejected, and the reserved stock is restored', async () => {
    // reservation succeeds for the variant, but the variant row says it belongs to another product
    route(
      (url, method) => method === 'GET' && url.includes('/product_variants') && url.includes('id=in.(var-uuid-9)'),
      [{ id: 'var-uuid-9', price: 10, original_price: 20, is_active: true, available_stock: 5, product_id: 'some-other-product' }],
    )
    route((url, method) => method === 'GET' && url.includes('/products') && url.includes('some-other-product'),
      [{ id: 'some-other-product', name: 'Other', emoji: '🌿', gst_rate: 5, is_deleted: false, status: 'active', price: 10, selling_price: 10, mrp: 20, available_stock: 5 }])
    const { createOrder } = await import('@/lib/services/orderService')

    await expect(
      createOrder({ ...BASE_INPUT, items: [{ productId: PRODUCT_ID, variantId: 'var-uuid-9', qty: 1 }] }, DEFAULT_SETTINGS),
    ).rejects.toThrow(/no longer available/i)

    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'restore_stock')?.args).toEqual({ p_variant_id: 'var-uuid-9', p_qty: 1 })
  })

  it.each([
    ['comma / filter injection in variantId', { productId: PRODUCT_ID, variantId: '1),or=(id.gt.0', qty: 1 }],
    ['dots in productId',                       { productId: 'a.b',      variantId: VARIANT_ID,        qty: 1 }],
    ['empty-ish whitespace id',                 { productId: ' ',        variantId: VARIANT_ID,        qty: 1 }],
  ])('PS1: %s → rejected before any DB access', async (_label, item) => {
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, items: [item] }, DEFAULT_SETTINGS)).rejects.toThrow(/invalid cart item/i)
    expect(mockDb.rpcCalls).toHaveLength(0)
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

// ─────────────────────────────────────────────────────────────────────────────
// S-01 (Nov 2026 verification, L-15 test debt): server-side guards that the UI also applies but a direct API call skips.
// ─────────────────────────────────────────────────────────────────────────────
describe('createOrder — S-01 server-side guards (named stock error, NaN COD cap, min_order_amount)', () => {
  beforeEach(() => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireOrderRpcSuccess()
  })

  it('a real stock shortfall names the PRODUCT (not a variant id) so the customer knows which line to change', async () => {
    wireHappyPathFetch()
    mockDb.rpcResponses['reserve_stock_at_order'] = false   // DB says available_stock < qty for VARIANT_ID
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder(BASE_INPUT, DEFAULT_SETTINGS)).rejects.toThrow(/Insufficient stock for “Himalayan Honey”/)
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
  })

  it('falls back to the generic wording when the product name cannot be read — never leaks the variant id', async () => {
    wireHappyPathFetch()
    mockDb.rpcResponses['reserve_stock_at_order'] = false
    routeFirst((url, method) => method === 'GET' && url.includes('/products') && url.includes('select=name'), [])
    const { createOrder } = await import('@/lib/services/orderService')
    const err = await createOrder(BASE_INPUT, DEFAULT_SETTINGS).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as { code?: string }).code).toBe('OUT_OF_STOCK')
    expect((err as Error).message).toMatch(/Insufficient stock for one of the items/)
    expect((err as Error).message).not.toContain(VARIANT_ID)
  })

  it('a malformed cod_max_value (NaN) falls back to the ₹3000 cap instead of silently lifting it', async () => {
    wireHappyPathFetch({ variantPrice: 2000 })   // 2 × ₹2000 = ₹4000 > 3000, free shipping
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder(BASE_INPUT, { ...DEFAULT_SETTINGS, cod_max_value: 'abc' }))
      .rejects.toThrow(/COD is only available for orders up to ₹3000/)
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
  })

  it('the same malformed cod_max_value still lets an order under ₹3000 through (the fallback is a cap, not a block)', async () => {
    wireHappyPathFetch({ variantPrice: 200 })    // ₹400 + ₹99 shipping
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder(BASE_INPUT, { ...DEFAULT_SETTINGS, cod_max_value: 'abc' })).resolves.toBeTruthy()
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeDefined()
  })

  it('a configured cod_max_value is enforced on the server (direct API call cannot bypass the UI check)', async () => {
    wireHappyPathFetch({ variantPrice: 200 })    // total ₹499
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder(BASE_INPUT, { ...DEFAULT_SETTINGS, cod_max_value: '450' }))
      .rejects.toThrow(/COD is only available for orders up to ₹450/)
  })

  it('min_order_amount is enforced on the server against the goods subtotal', async () => {
    wireHappyPathFetch({ variantPrice: 200 })    // subtotal ₹400
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder(BASE_INPUT, { ...DEFAULT_SETTINGS, min_order_amount: '500' }))
      .rejects.toThrow(/Minimum order is ₹500/)
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
  })

  it.each([['exactly at the minimum', '400'], ['blank (disabled)', ''], ['malformed', 'abc'], ['zero', '0']])(
    'min_order_amount %s → order proceeds', async (_n, value) => {
      wireHappyPathFetch({ variantPrice: 200 })
      const { createOrder } = await import('@/lib/services/orderService')
      await expect(createOrder(BASE_INPUT, { ...DEFAULT_SETTINGS, min_order_amount: value })).resolves.toBeTruthy()
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

  it('customer-facing refusals are typed CheckoutRejectedError (stock + coupon) so routes never need message sniffing', async () => {
    const { CheckoutRejectedError } = await import('@/lib/errors/checkoutErrors')
    mockDb.responses['coupons'] = {
      code: 'EXPIRED', value: 10, type: 'percent', max_uses: null, uses_count: 0,
      is_active: true, expires_at: '2020-01-01T00:00:00Z', min_order: null, max_discount: null,
    }
    const { createOrder } = await import('@/lib/services/orderService')
    const err = await createOrder({ ...BASE_INPUT, couponCode: 'EXPIRED' }, DEFAULT_SETTINGS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CheckoutRejectedError)
    expect((err as InstanceType<typeof CheckoutRejectedError>).code).toBe('COUPON_INVALID')
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

  it('F-07: claims the coupon use atomically via claim_coupon_use BEFORE the order, then attaches the order to the claim', async () => {
    mockDb.responses['coupons'] = {
      id: 3, code: 'TRACK5', value: 10, type: 'percent', max_uses: 100, uses_count: 5,
      is_active: true, expires_at: null, min_order: null, max_discount: null,
    }
    mockDb.rpcResponses['claim_coupon_use'] = { ok: true, usage_id: 42 }
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...BASE_INPUT, couponCode: 'TRACK5' }, DEFAULT_SETTINGS)

    const names = mockDb.rpcCalls.map(c => c.rpcName)
    expect(names.indexOf('claim_coupon_use')).toBeGreaterThanOrEqual(0)
    expect(names.indexOf('claim_coupon_use')).toBeLessThan(names.indexOf('create_order_with_items'))
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'claim_coupon_use')!.args).toMatchObject({ p_coupon_id: 3 })

    // No more racy read-then-write of coupons.uses_count from the app…
    expect(mockDb.updateCalls.find(c => c.table === 'coupons')).toBeUndefined()
    // …the claim row is simply given its order id.
    const attach = mockDb.updateCalls.find(c => c.table === 'coupon_usage')
    expect(attach).toBeDefined()
    expect(attach!.eqCalls.some(a => a[0] === 'id' && a[1] === 42)).toBe(true)
    expect((attach!.payload as any).order_id).toBeDefined()
    // A successful order must NOT release the claim.
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'release_coupon_claim')).toBeUndefined()
  })

  it('F-07: releases the claim when the order fails after it was taken', async () => {
    mockDb.responses['coupons'] = {
      id: 4, code: 'REL', value: 10, type: 'percent', max_uses: 100, uses_count: 5,
      is_active: true, expires_at: null, min_order: null, max_discount: null,
    }
    mockDb.rpcResponses['claim_coupon_use'] = { ok: true, usage_id: 77 }
    mockDb.rpcResponses['create_order_with_items'] = new Error('db down')
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, couponCode: 'REL' }, DEFAULT_SETTINGS)).rejects.toThrow()
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'release_coupon_claim')?.args).toEqual({ p_usage_id: 77 })
  })

  it('an unknown or inactive coupon code is REJECTED, not silently ignored (customer saw a discount the server never applied)', async () => {
    mockDb.responses['coupons'] = null
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, couponCode: 'NOPE' }, DEFAULT_SETTINGS)).rejects.toThrow(/invalid or inactive coupon/i)
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'claim_coupon_use')).toBeUndefined()
  })

  it('a flat coupon larger than the subtotal can never discount more than the subtotal', async () => {
    // subtotal = 2 * 200 = 400 → a ₹5000 flat coupon is capped at ₹400
    mockDb.responses['coupons'] = {
      id: 5, code: 'HUGE', value: 5000, type: 'flat', max_uses: null, uses_count: 0,
      is_active: true, expires_at: null, min_order: null, max_discount: null,
    }
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...BASE_INPUT, couponCode: 'HUGE' }, DEFAULT_SETTINGS)
    const rpcCall = mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')
    expect((rpcCall!.args as any).p_coupon_discount).toBe(400)
  })

  it('F-08: first_order_only coupon is rejected for a customer with an earlier paid/COD order', async () => {
    mockDb.responses['coupons'] = {
      id: 6, code: 'FIRSTONLY', value: 5, type: 'percent', max_uses: 100, uses_count: 1,
      is_active: true, expires_at: null, min_order: null, max_discount: null, first_order_only: true,
    }
    routeFirst(
      (url, method) => method === 'GET' && url.includes('/customers') && url.includes('normalized_phone=eq.'),
      [{ id: 'cust-uuid-existing' }],
    )
    routeFirst(
      (url, method) => method === 'GET' && url.includes('/orders') && url.includes('payment_status=in.'),
      [{ id: 'earlier-order' }],
    )
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, couponCode: 'FIRSTONLY' }, DEFAULT_SETTINGS))
      .rejects.toThrow(/first order only/i)
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'claim_coupon_use')).toBeUndefined()
  })
})

describe('createOrder — F-09 serviceability (optional, settings-driven)', () => {
  beforeEach(() => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
    wireOrderRpcSuccess()
  })

  it('refuses a state outside serviceable_states BEFORE any stock is reserved', async () => {
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(
      createOrder({ ...BASE_INPUT, state: 'Kerala' }, { ...DEFAULT_SETTINGS, serviceable_states: 'Uttarakhand, Himachal Pradesh' } as any),
    ).rejects.toThrow(/we do not deliver to Kerala/i)
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'reserve_stock_at_order')).toBeUndefined()
  })

  it('refuses a blocked PIN prefix', async () => {
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(
      createOrder({ ...BASE_INPUT, pincode: '193101' }, { ...DEFAULT_SETTINGS, blocked_pincodes: '193' } as any),
    ).rejects.toThrow(/we do not deliver to PIN code 193101/i)
  })

  it('with neither setting configured every destination is served (no behaviour change)', async () => {
    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder({ ...BASE_INPUT, state: 'Kerala' }, DEFAULT_SETTINGS)
    expect(result.alreadyExists).toBe(false)
  })
})

describe('createOrder — per-customer coupon usage limit (user_limit, authoritative gate)', () => {
  // FEATURE FIX (Sep 2026): coupons.user_limit ("uses per customer") existed
  // on this table with real configured values (both live coupons had
  // user_limit=1) but nothing in createOrder ever checked it — only the
  // store-wide max_uses/uses_count check above did. A coupon meant to be
  // "once per customer" behaved as "once ever, for the whole store": the
  // first customer's redemption exhausted it for every future customer too.
  //
  // This block is the authoritative, can't-be-bypassed check — it must
  // still enforce the limit even when the client-side pre-check
  // (validateCouponServer, see validateCouponUserLimit.test.ts) was never
  // called, e.g. a direct POST to /api/v1/orders.
  beforeEach(() => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
    wireOrderRpcSuccess()
  })

  it('rejects an order when the matched customer has already reached their per-customer limit', async () => {
    mockDb.responses['coupons'] = {
      id: 7, code: 'WELCOME50', value: 50, type: 'flat', max_uses: 100, uses_count: 1,
      is_active: true, expires_at: null, min_order: null, max_discount: null, user_limit: 1,
    }
    routeFirst(
      (url, method) => method === 'GET' && url.includes('/customers') && url.includes('normalized_phone=eq.'),
      [{ id: 'cust-uuid-existing' }],
    )
    // AUDIT S1-002 / B1-16: a GUEST's history is checked read-only by phone+email against coupon_usage
    // (claim_coupon_use skips user_limit for a NULL customer) — the matched row is never adopted.
    routeFirst(
      (url, method) => method === 'GET' && url.includes('/coupon_usage') && url.includes('customer_id=in.(cust-uuid-existing)'),
      [{ id: 501 }],
    )
    // F-07: for signed-in customers the per-customer limit is enforced INSIDE claim_coupon_use (atomic, row-locked).
    mockDb.rpcResponses['claim_coupon_use'] = { ok: false, code: 'user_limit', error: 'You have already used this coupon' }

    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, couponCode: 'WELCOME50' }, DEFAULT_SETTINGS))
      .rejects.toThrow(/already used this coupon/i)
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
  })

  it('allows a brand-new customer to use a user_limit=1 coupon (no existing customer row to match)', async () => {
    // wireHappyPathFetch's default customer lookup (matches "phone=eq.",
    // which "normalized_phone=eq." also contains) returns [] — not found —
    // so candidateCustId stays null and the per-customer check is skipped,
    // exactly as it should be for someone who's never ordered before.
    mockDb.responses['coupons'] = {
      id: 8, code: 'WELCOME50', value: 50, type: 'flat', max_uses: 100, uses_count: 1,
      is_active: true, expires_at: null, min_order: null, max_discount: null, user_limit: 1,
    }
    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder({ ...BASE_INPUT, couponCode: 'WELCOME50' }, DEFAULT_SETTINGS)
    expect(result.alreadyExists).toBe(false)
  })

  it('does not reject when user_limit is null (unlimited per customer), even for a customer with heavy prior usage', async () => {
    mockDb.responses['coupons'] = {
      id: 9, code: 'ALWAYSOK', value: 50, type: 'flat', max_uses: null, uses_count: 50,
      is_active: true, expires_at: null, min_order: null, max_discount: null, user_limit: null,
    }
    routeFirst(
      (url, method) => method === 'GET' && url.includes('/customers') && url.includes('normalized_phone=eq.'),
      [{ id: 'cust-uuid-existing' }],
    )
    mockDb.responses['coupon_usage'] = { count: 999 }
    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder({ ...BASE_INPUT, couponCode: 'ALWAYSOK' }, DEFAULT_SETTINGS)
    expect(result.alreadyExists).toBe(false)
  })

  it('uses authenticatedCustomerId directly when logged in, without hitting the phone-lookup route', async () => {
    mockDb.responses['coupons'] = {
      id: 10, code: 'MEMBER1', value: 50, type: 'flat', max_uses: 100, uses_count: 1,
      is_active: true, expires_at: null, min_order: null, max_discount: null, user_limit: 1,
    }
    mockDb.rpcResponses['claim_coupon_use'] = { ok: false, code: 'user_limit', error: 'You have already used this coupon' }

    const { createOrder } = await import('@/lib/services/orderService')
    await expect(
      createOrder({ ...BASE_INPUT, couponCode: 'MEMBER1', authenticatedCustomerId: 'auth-cust-1' }, DEFAULT_SETTINGS),
    ).rejects.toThrow(/already used this coupon/i)
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'claim_coupon_use')).toBeDefined()

    expect(fetchCalls.some(c => c.url.includes('normalized_phone=eq.'))).toBe(false)
  })
})

describe('createOrder — one person / one address, one time only (Nov 2026)', () => {
  // A guest's earlier coupon use is stored with customer_id NULL, so the old guest check (by customer_id) could never see it and a
  // guest could redeem a one-time coupon repeatedly; the delivery address was never compared. The order behind each use is the link.
  const COUPON = { id: 7, code: 'WELCOME50', value: 50, type: 'flat', max_uses: 100, uses_count: 1, is_active: true, expires_at: null,
                   min_order: null, max_discount: null, user_limit: 1 }
  const PRIOR_USE = [{ id: 1, coupon_id: 7, order_id: 500, customer_id: null }]
  const priorOrders = (customer_id: string | null, line: string, pincode = '171001') => (terminal: string) =>
    terminal === 'maybeSingle' ? null : [{ id: 500, customer_id, shipping_address: { pincode, address_line1: line } }]

  beforeEach(() => {
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
    wireOrderRpcSuccess()
    mockDb.responses['coupons'] = COUPON
    mockDb.responses['coupon_usage'] = PRIOR_USE
  })

  it('refuses a GUEST who already used it: matched by phone through the ORDER, though the usage row has no customer_id', async () => {
    routeFirst((url, m) => m === 'GET' && url.includes('/customers') && url.includes('normalized_phone=eq.'), [{ id: 'cust-uuid-existing' }])
    mockDb.responses['orders'] = priorOrders('cust-uuid-existing', 'Somewhere Else 99, Other Colony', '110001')
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, couponCode: 'WELCOME50' }, DEFAULT_SETTINGS)).rejects.toThrow(/already used this coupon/i)
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'claim_coupon_use')).toBeUndefined()
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
  })

  // Nov 2026 verification: the e-mail history lookup was case-sensitive (`email=eq.`), so changing the capitalisation of the
  // e-mail hid an earlier use from the per-person check.
  it('refuses a GUEST matched by e-mail with different capitalisation (case-insensitive, wildcards escaped)', async () => {
    routeFirst((url, m) => m === 'GET' && url.includes('/customers') && url.includes('email=ilike.'), [{ id: 'cust-by-email' }])
    mockDb.responses['orders'] = priorOrders('cust-by-email', 'Somewhere Else 99, Other Colony', '110001')
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, customerEmail: 'Ramesh@Example.com', couponCode: 'WELCOME50' }, DEFAULT_SETTINGS))
      .rejects.toThrow(/already used this coupon/i)
    expect(fetchCalls.some(c => c.url.includes('email=ilike.Ramesh%40Example.com'))).toBe(true)
  })

  it('refuses a DIFFERENT person at the SAME address, even if the address is typed differently', async () => {
    mockDb.responses['orders'] = priorOrders('someone-else', 'Flat No. 12, Pahadi Lane, Shimla Hills')
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, couponCode: 'WELCOME50' }, DEFAULT_SETTINGS)).rejects.toThrow(/delivery address/i)
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
  })

  it('and a refused coupon never reserves or keeps stock (the reservation is restored)', async () => {
    mockDb.responses['orders'] = priorOrders('someone-else', '12 Pahadi Lane, Shimla Hills')
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, couponCode: 'WELCOME50' }, DEFAULT_SETTINGS)).rejects.toThrow()
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'claim_coupon_use')).toBeUndefined()
  })

  it('allows a different person at a different address', async () => {
    mockDb.responses['orders'] = priorOrders('someone-else', '4 Mall Road, Lower Bazaar', '171002')
    const { createOrder } = await import('@/lib/services/orderService')
    const r = await createOrder({ ...BASE_INPUT, couponCode: 'WELCOME50' }, DEFAULT_SETTINGS)
    expect(r.alreadyExists).toBe(false)
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'claim_coupon_use')).toBeDefined()
  })

  it('allows a neighbour (same PIN and street, different house number)', async () => {
    mockDb.responses['orders'] = priorOrders('someone-else', '14 Pahadi Lane, Shimla Hills')
    const { createOrder } = await import('@/lib/services/orderService')
    expect((await createOrder({ ...BASE_INPUT, couponCode: 'WELCOME50' }, DEFAULT_SETTINGS)).alreadyExists).toBe(false)
  })

  it('FAILS CLOSED: if the usage history cannot be read the order is refused, not waved through', async () => {
    mockDb.responses['coupon_usage'] = new Error('db down')
    mockDb.responses['orders'] = null
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, couponCode: 'WELCOME50' }, DEFAULT_SETTINGS)).rejects.toThrow(/history read failed/i)
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
  })

  it('a coupon with no per-customer limit is untouched by all of this', async () => {
    mockDb.responses['coupons'] = { ...COUPON, user_limit: null }
    mockDb.responses['orders'] = priorOrders('someone-else', '12 Pahadi Lane, Shimla Hills')
    const { createOrder } = await import('@/lib/services/orderService')
    expect((await createOrder({ ...BASE_INPUT, couponCode: 'WELCOME50' }, DEFAULT_SETTINGS)).alreadyExists).toBe(false)
  })
})

describe('createOrder — loyalty enforcement', () => {
  // AUDIT S1-002: loyalty redemption is only reachable with a verified session, so these scenarios run
  // as the signed-in customer (a guest asking to redeem is rejected up front — see guestIdentity tests).
  const AUTHED_INPUT = { ...BASE_INPUT, authenticatedCustomerId: 'cust-uuid-001' }
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
    await createOrder({ ...AUTHED_INPUT, loyaltyPointsRedeemed: 5000 }, DEFAULT_SETTINGS)

    const rpcCall = mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')
    // subtotal=2000, shipping=0 (>=799 free ship), loyaltyDiscount=400 → afterDiscount=1600, total cod=1600+0=1600
    expect((rpcCall!.args as any).p_total_amount).toBe(1600)
  })

  it('F-06: points already held by the customer\'s OTHER unpaid orders are not available again', async () => {
    mockDb.responses['customers'] = { loyalty_points: 500 }
    // list read (held points) → 400 pts promised elsewhere; single-row reads (idempotency) → none
    mockDb.responses['orders'] = (terminal: string) => (terminal === 'then' ? [{ loyalty_points_redeemed: 400 }] : null)
    const { createOrder } = await import('@/lib/services/orderService')
    // balance 500 − held 400 = 100 available; asking for 200 must fail
    await expect(createOrder({ ...AUTHED_INPUT, loyaltyPointsRedeemed: 200 }, DEFAULT_SETTINGS))
      .rejects.toThrow(/insufficient loyalty balance.*held by another unpaid order/i)
  })

  it('F-06: with no points held elsewhere the full balance is available', async () => {
    mockDb.responses['customers'] = { loyalty_points: 500 }
    mockDb.responses['orders'] = (terminal: string) => (terminal === 'then' ? [] : null)
    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder({ ...AUTHED_INPUT, loyaltyPointsRedeemed: 200 }, DEFAULT_SETTINGS)
    expect(result.alreadyExists).toBe(false)
  })

  // Owner rule (Nov 2026): the coupon and the coins together stay within loyalty_max_redeem_pct (20%) of the subtotal.
  it('a coupon uses up part of the 20% cap: ₹2000 subtotal, ₹100 coupon → coins can take at most ₹300', async () => {
    mockDb.responses['customers'] = { loyalty_points: 100_000 }
    mockDb.responses['orders'] = (terminal: string) => (terminal === 'then' ? [] : null)
    mockDb.responses['coupons'] = {
      id: 9, code: 'FLAT100', value: 100, type: 'flat', max_uses: 100, uses_count: 0,
      is_active: true, expires_at: null, min_order: null, max_discount: null,
    }
    mockDb.rpcResponses['claim_coupon_use'] = { ok: true, usage_id: 91 }
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...AUTHED_INPUT, couponCode: 'FLAT100', loyaltyPointsRedeemed: 5000 }, DEFAULT_SETTINGS)
    const args = mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')!.args as Record<string, number>
    expect(args.p_coupon_discount).toBe(100)
    expect(args.p_total_amount).toBe(1600)                 // 2000 − 100 coupon − 300 coins
    expect(args.p_loyalty_points_redeemed).toBe(1200)      // ₹300 at ₹0.25 a coin, never the 1600 the old 20%-only cap allowed
  })

  it('throws when requested loyalty points exceed the live DB balance (race-condition guard)', async () => {
    mockDb.responses['customers'] = { loyalty_points: 50 }  // small balance
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...AUTHED_INPUT, loyaltyPointsRedeemed: 500 }, DEFAULT_SETTINGS))
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

describe('createOrder — cod_max_active_orders (fraud guard, previously untested)', () => {
  beforeEach(() => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
  })

  it('blocks a new COD order once the phone already has cod_max_active_orders active orders', async () => {
    resetFetchRoutes()
    // Wire product/variant/customer routes directly (skip wireHappyPathFetch's
    // default empty-active-orders route, since this test overrides it).
    route((url, method) => method === 'GET' && url.includes('/product_variants') && url.includes(VARIANT_ID),
      [{ id: VARIANT_ID, price: 200, original_price: 250, is_active: true, available_stock: 10, product_id: PRODUCT_ID }])
    route((url, method) => method === 'GET' && url.includes('/products') && url.includes(PRODUCT_ID),
      [{ id: PRODUCT_ID, name: 'Himalayan Honey', emoji: '🍯', gst_rate: 5, is_deleted: false, status: 'active', price: 200, mrp: 250, available_stock: 10 }])
    route((url, method) => method === 'GET' && url.includes('/customers') && (url.includes('phone=eq.') || url.includes('email=eq.') || url.includes('email=ilike.')), [])
    route((url, method) => method === 'POST' && url.includes('/customers'), [{ id: 'cust-uuid-001' }])
    // 3 in-flight COD orders already exist for this phone → guard should block.
    route(
      (url, method) => method === 'GET' && url.includes('/orders') && url.includes('payment_method=in.'),
      [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }]
    )

    const { createOrder } = await import('@/lib/services/orderService')
    await expect(
      createOrder({ ...BASE_INPUT, paymentMethod: 'cod' }, { ...DEFAULT_SETTINGS, cod_max_active_orders: '3' })
    ).rejects.toThrow(/3 COD order\(s\) already in progress/i)
  })

  it('allows the order when active COD orders are below the configured cap', async () => {
    resetFetchRoutes()
    route((url, method) => method === 'GET' && url.includes('/product_variants') && url.includes(VARIANT_ID),
      [{ id: VARIANT_ID, price: 200, original_price: 250, is_active: true, available_stock: 10, product_id: PRODUCT_ID }])
    route((url, method) => method === 'GET' && url.includes('/products') && url.includes(PRODUCT_ID),
      [{ id: PRODUCT_ID, name: 'Himalayan Honey', emoji: '🍯', gst_rate: 5, is_deleted: false, status: 'active', price: 200, mrp: 250, available_stock: 10 }])
    route((url, method) => method === 'GET' && url.includes('/customers') && (url.includes('phone=eq.') || url.includes('email=eq.') || url.includes('email=ilike.')), [])
    route((url, method) => method === 'POST' && url.includes('/customers'), [{ id: 'cust-uuid-001' }])
    route(
      (url, method) => method === 'GET' && url.includes('/orders') && url.includes('payment_method=in.'),
      [{ id: 'o1' }]
    )
    wireOrderRpcSuccess()

    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder(
      { ...BASE_INPUT, paymentMethod: 'cod' },
      { ...DEFAULT_SETTINGS, cod_max_active_orders: '3' }
    )
    expect(result.alreadyExists).toBe(false)
  })

  it('skips the guard entirely for razorpay orders (guard only applies to cod/whatsapp_cod)', async () => {
    resetFetchRoutes()
    // No active-orders route wired at all — if the guard ran for razorpay,
    // this would throw "no mock route" and fail the test.
    route((url, method) => method === 'GET' && url.includes('/product_variants') && url.includes(VARIANT_ID),
      [{ id: VARIANT_ID, price: 200, original_price: 250, is_active: true, available_stock: 10, product_id: PRODUCT_ID }])
    route((url, method) => method === 'GET' && url.includes('/products') && url.includes(PRODUCT_ID),
      [{ id: PRODUCT_ID, name: 'Himalayan Honey', emoji: '🍯', gst_rate: 5, is_deleted: false, status: 'active', price: 200, mrp: 250, available_stock: 10 }])
    route((url, method) => method === 'GET' && url.includes('/customers') && (url.includes('phone=eq.') || url.includes('email=eq.') || url.includes('email=ilike.')), [])
    route((url, method) => method === 'POST' && url.includes('/customers'), [{ id: 'cust-uuid-001' }])
    wireOrderRpcSuccess()

    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder(
      { ...BASE_INPUT, paymentMethod: 'razorpay' },
      { ...DEFAULT_SETTINGS, cod_max_active_orders: '1' }
    )
    expect(result.alreadyExists).toBe(false)
  })

  it('disables the guard entirely when cod_max_active_orders is set to 0', async () => {
    resetFetchRoutes()
    // No active-orders route wired — guard must not fire when the cap is 0.
    route((url, method) => method === 'GET' && url.includes('/product_variants') && url.includes(VARIANT_ID),
      [{ id: VARIANT_ID, price: 200, original_price: 250, is_active: true, available_stock: 10, product_id: PRODUCT_ID }])
    route((url, method) => method === 'GET' && url.includes('/products') && url.includes(PRODUCT_ID),
      [{ id: PRODUCT_ID, name: 'Himalayan Honey', emoji: '🍯', gst_rate: 5, is_deleted: false, status: 'active', price: 200, mrp: 250, available_stock: 10 }])
    route((url, method) => method === 'GET' && url.includes('/customers') && (url.includes('phone=eq.') || url.includes('email=eq.') || url.includes('email=ilike.')), [])
    route((url, method) => method === 'POST' && url.includes('/customers'), [{ id: 'cust-uuid-001' }])
    wireOrderRpcSuccess()

    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder(
      { ...BASE_INPUT, paymentMethod: 'cod' },
      { ...DEFAULT_SETTINGS, cod_max_active_orders: '0' }
    )
    expect(result.alreadyExists).toBe(false)
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

// BUG FIX regression: the order-confirmation email used to show a generic
// emoji for every product because this query never even fetched image_url,
// so cartItems[i].image was hardcoded to null before it ever reached the
// email template. These tests cover the fix: product_images is the real
// source of truth (per the same pattern already established in
// normalizeProduct.ts/cart-upsells), products.image_url is a last-resort
// fallback, and — critically — a failure fetching images must never be able
// to fail the order itself (it's cosmetic email data, not order-critical).
describe('createOrder — product image resolution (order-confirmation email fix)', () => {
  it('uses the product_images row as the source of truth for cartItems[i].image', async () => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
    route(
      (url, method) => method === 'GET' && url.includes('/product_images') && url.includes(PRODUCT_ID),
      [{ product_id: PRODUCT_ID, image_url: 'https://cdn.example.com/honey-real.jpg' }],
    )
    wireOrderRpcSuccess()

    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder(BASE_INPUT, DEFAULT_SETTINGS)

    expect(result.order.cartItems[0].image).toBe('https://cdn.example.com/honey-real.jpg')
  })

  it('falls back to products.image_url when no product_images row exists', async () => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    // wireHappyPathFetch's product row has no image_url — override it directly.
    route(
      (url, method) => method === 'GET' && url.includes('/product_variants') && url.includes(VARIANT_ID),
      [{ id: VARIANT_ID, price: 200, original_price: 250, is_active: true, available_stock: 10, product_id: PRODUCT_ID }],
    )
    route(
      (url, method) => method === 'GET' && url.includes('/products') && url.includes(PRODUCT_ID),
      [{ id: PRODUCT_ID, name: 'Himalayan Honey', emoji: '🍯', image_url: 'https://cdn.example.com/honey-fallback.jpg', gst_rate: 5, is_deleted: false, status: 'active', price: 200, mrp: 250, available_stock: 10 }],
    )
    route((url, method) => method === 'GET' && url.includes('/customers') && (url.includes('phone=eq.') || url.includes('email=eq.') || url.includes('email=ilike.')), [])
    route((url, method) => method === 'POST' && url.includes('/customers'), [{ id: 'cust-uuid-001' }])
    route((url, method) => method === 'GET' && url.includes('/orders') && url.includes('payment_method=in.'), [])
    route(
      (url, method) => method === 'GET' && url.includes('/product_images'),
      [], // no rows for this product
    )
    wireOrderRpcSuccess()

    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder(BASE_INPUT, DEFAULT_SETTINGS)

    expect(result.order.cartItems[0].image).toBe('https://cdn.example.com/honey-fallback.jpg')
  })

  it('image is null (not undefined, not a throw) when neither product_images nor products.image_url is set', async () => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch() // default product fixture has no image_url
    route((url, method) => method === 'GET' && url.includes('/product_images'), [])
    wireOrderRpcSuccess()

    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder(BASE_INPUT, DEFAULT_SETTINGS)

    expect(result.order.cartItems[0].image).toBeNull()
  })

  it('a failed product_images fetch never blocks order creation — falls back gracefully instead of throwing', async () => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
    // Deliberately NO route registered for /product_images → mockFetch's
    // default "no mock route" 404 path, simulating a real fetch failure.
    wireOrderRpcSuccess()

    const { createOrder } = await import('@/lib/services/orderService')
    // Must resolve, not throw — a cosmetic image lookup failing must never
    // take down real order creation.
    const result = await createOrder(BASE_INPUT, DEFAULT_SETTINGS)

    expect(result.alreadyExists).toBe(false)
    expect(result.order.cartItems[0].image).toBeNull()
  })
})

// Nov 2026 verification (db_migration_v34): the stored tax credits the prepaid discount's GST only if the order records it.
describe('createOrder — records the prepaid discount on the order', () => {
  it('an online order with a prepaid discount writes prepaid_discount to the new order', async () => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
    wireOrderRpcSuccess({ id: 'order-pp-1' })
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...BASE_INPUT, paymentMethod: 'razorpay' }, { ...DEFAULT_SETTINGS, prepaid_discount_pct: '5' })
    const upd = mockDb.updateCalls.find(c => c.table === 'orders' && (c.payload as { prepaid_discount?: number })?.prepaid_discount != null)
    expect(upd).toBeDefined()
    expect((upd!.payload as { prepaid_discount: number }).prepaid_discount).toBeGreaterThan(0)
    expect(upd!.eqCalls).toContainEqual(['id', 'order-pp-1'])
  })

  it('a COD order (no prepaid discount) writes nothing extra', async () => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
    wireOrderRpcSuccess({ id: 'order-pp-2' })
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...BASE_INPUT, paymentMethod: 'cod' }, { ...DEFAULT_SETTINGS, prepaid_discount_pct: '5' })
    expect(mockDb.updateCalls.find(c => c.table === 'orders' && (c.payload as { prepaid_discount?: number })?.prepaid_discount != null)).toBeUndefined()
  })
})

describe('createOrder — confirmation_token generation (guest-safe order lookup)', () => {
  it('generates a cryptographically random UUID token and persists it via a normal REST update (not raw SQL)', async () => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
    wireOrderRpcSuccess({ id: 'order-db-uuid-777' })

    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder(BASE_INPUT, DEFAULT_SETTINGS)

    // Returned token is a real UUID (122 bits of randomness — unguessable).
    expect(result.order.confirmationToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )

    // Persisted via db.from('orders').update({confirmation_token}).eq('id', <the new order's id>)
    // — never a raw SQL string.
    const tokenUpdate = mockDb.updateCalls.find(
      c => c.table === 'orders' && typeof (c.payload as any)?.confirmation_token === 'string'
    )
    expect(tokenUpdate).toBeDefined()
    expect(tokenUpdate!.payload).toEqual({ confirmation_token: result.order.confirmationToken })
    expect(tokenUpdate!.eqCalls).toContainEqual(['id', 'order-db-uuid-777'])
  })

  it('two orders never get the same token (no collision from a fixed/weak seed)', async () => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
    wireOrderRpcSuccess({ id: 'order-a', order_number: 'PRAAAA' })

    const { createOrder } = await import('@/lib/services/orderService')
    const resultA = await createOrder({ ...BASE_INPUT, idempotencyKey: 'key-a' }, DEFAULT_SETTINGS)

    resetFetchRoutes()
    wireHappyPathFetch()
    wireOrderRpcSuccess({ id: 'order-b', order_number: 'PRBBBB' })
    const resultB = await createOrder({ ...BASE_INPUT, idempotencyKey: 'key-b' }, DEFAULT_SETTINGS)

    expect(resultA.order.confirmationToken).not.toBe(resultB.order.confirmationToken)
  })

  it('order creation still succeeds (non-fatal) even if the confirmation_token update fails', async () => {
    mockDb.responses['orders'] = new Error('connection reset') // update() → this error
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
    wireOrderRpcSuccess()

    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder(BASE_INPUT, DEFAULT_SETTINGS)

    // Order itself is still fully valid — stock reserved, RPC committed —
    // only the token is missing. See db_migration_v6 comment: this must
    // degrade gracefully, never fail an already-successful order.
    expect(result.order.order_number).toBeTruthy()
    expect(result.order.confirmationToken).toBeNull()
  })

  it('a retried request with the same idempotency_key gets back the SAME token as the original order, not null', async () => {
    mockDb.responses['orders'] = {
      id: 'order-existing-002', order_number: 'PREXIST02', total_amount: 500,
      order_status: 'confirmed', confirmation_token: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      payment_method: 'cod', loyalty_points_redeemed: 0,
    }
    mockDb.responses['order_items'] = [{ product_id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 2 }]
    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder(BASE_INPUT, DEFAULT_SETTINGS)

    expect(result.alreadyExists).toBe(true)
    expect(result.order.confirmationToken).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })
})

// AUDIT GAP (closed): order_prefix was a real P1 fix — order numbers used
// to be hardcoded 'PR' in code; now settings.order_prefix (admin-editable)
// is read and passed to the generate_order_number RPC as p_prefix. Every
// existing test above only ever exercised the 'PR' fallback implicitly
// (DEFAULT_SETTINGS never sets order_prefix at all) — nothing asserted the
// actual wiring, or the fallback order-number scheme used the right prefix
// when the RPC itself fails.
describe('createOrder — order_prefix (settings-driven order numbering)', () => {
  beforeEach(() => {
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
  })

  it("passes the admin-configured order_prefix to generate_order_number, uppercased and trimmed", async () => {
    wireOrderRpcSuccess()
    const settingsWithPrefix = { ...DEFAULT_SETTINGS, order_prefix: '  ord  ' }

    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder(BASE_INPUT, settingsWithPrefix)

    const call = mockDb.rpcCalls.find(c => c.rpcName === 'generate_order_number')
    expect(call).toBeDefined()
    expect((call!.args as any).p_prefix).toBe('ORD')
  })

  it("falls back to 'PR' when order_prefix isn't set", async () => {
    wireOrderRpcSuccess()

    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder(BASE_INPUT, DEFAULT_SETTINGS) // no order_prefix key

    const call = mockDb.rpcCalls.find(c => c.rpcName === 'generate_order_number')
    expect((call!.args as any).p_prefix).toBe('PR')
  })

  it("uses the configured prefix in the client-side fallback order number too, if the RPC itself fails", async () => {
    mockDb.rpcResponses['generate_order_number'] = '' // falsy but not nullish — the mock's `data: val ?? true` would silently override an explicit `null` back to `true`
    wireOrderRpcSuccess()
    const settingsWithPrefix = { ...DEFAULT_SETTINGS, order_prefix: 'ORD' }

    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder(BASE_INPUT, settingsWithPrefix)

    // Fallback scheme is `${orderPrefix}${Date.now().toString(36)}...` — the
    // prefix must still be the configured one, not a hardcoded 'PR'. Checked
    // against what was actually passed to create_order_with_items (what
    // really gets written to the DB), not the mock's fixed return value.
    const call = mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')
    expect((call!.args as any).p_order_number.startsWith('ORD')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT ACC-035 — the delivery phone typed at checkout was stored NOWHERE for a signed-in customer
// (checkout deliberately never rewrites the account, and p_shipping_address had no phone key).
// Live evidence: both test orders had customers.phone NULL and no `phone` in shipping_address, so
// /api/v1/orders/track (which matches order_number + phone against customers.phone OR
// shipping_address.phone) answered "Order not found" for a valid order, and ops had no number to call.
// ─────────────────────────────────────────────────────────────────────────────
describe('createOrder — delivery phone is snapshotted on the order (ACC-035)', () => {
  beforeEach(() => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
    wireOrderRpcSuccess()
  })

  it('stores the normalised 10-digit phone inside p_shipping_address', async () => {
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...BASE_INPUT, customerPhone: '+91 98765-43210' }, DEFAULT_SETTINGS)

    const call = mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')
    const ship = (call!.args as { p_shipping_address: Record<string, unknown> }).p_shipping_address
    expect(ship.phone).toBe('9876543210')
    // the recipient / address snapshot is unchanged
    expect(ship).toMatchObject({ name: BASE_INPUT.customerName, city: BASE_INPUT.city, state: BASE_INPUT.state, pincode: BASE_INPUT.pincode })
  })

  it('is the same snapshot the track route reads (shipping_address.phone, last 10 digits)', async () => {
    const { createOrder, normalizePhoneForLookup } = await import('@/lib/services/orderService')
    await createOrder({ ...BASE_INPUT, customerPhone: '098765 43210' }, DEFAULT_SETTINGS)

    const ship = (mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')!.args as { p_shipping_address: { phone: string } }).p_shipping_address
    expect(ship.phone).toBe(normalizePhoneForLookup('098765 43210'))
    expect(ship.phone).toHaveLength(10)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// COM-1 (Nov 2026 audit): a committed order's coupon claim must end up LINKED (coupon_usage.order_id set) — the 30-minute
// release_stale_coupon_claims sweep deletes unlinked claims and the coupon becomes reusable.
// ─────────────────────────────────────────────────────────────────────────────
describe('createOrder — coupon claim linking (COM-1)', () => {
  const COUPON = {
    id: 3, code: 'TRACK5', value: 10, type: 'percent', max_uses: 100, uses_count: 5,
    is_active: true, expires_at: null, min_order: null, max_discount: null,
  }

  it('step 10: retries the attach once when the first PATCH fails, and the order still succeeds', async () => {
    wireHappyPathFetch()
    wireOrderRpcSuccess()
    mockDb.responses['coupons'] = COUPON
    mockDb.rpcResponses['claim_coupon_use'] = { ok: true, usage_id: 42 }
    let usageCalls = 0
    mockDb.responses['coupon_usage'] = () => (++usageCalls === 1 ? new Error('connection reset') : [])
    const { createOrder } = await import('@/lib/services/orderService')
    const r = await createOrder({ ...BASE_INPUT, couponCode: 'TRACK5' }, DEFAULT_SETTINGS)
    expect(r.alreadyExists).toBe(false)
    const attaches = mockDb.updateCalls.filter(c => c.table === 'coupon_usage')
    expect(attaches).toHaveLength(2)
    expect(attaches.every(a => a.eqCalls.some(e => e[0] === 'id' && e[1] === 42))).toBe(true)
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'release_coupon_claim')).toBeUndefined()
  })

  it('step 10: a persistent attach failure is alerted but does not fail the committed order', async () => {
    wireHappyPathFetch()
    wireOrderRpcSuccess()
    mockDb.responses['coupons'] = COUPON
    mockDb.rpcResponses['claim_coupon_use'] = { ok: true, usage_id: 42 }
    mockDb.responses['coupon_usage'] = new Error('permission denied')
    const { createOrder } = await import('@/lib/services/orderService')
    const r = await createOrder({ ...BASE_INPUT, couponCode: 'TRACK5' }, DEFAULT_SETTINGS)
    expect(r.order.id).toBe('order-db-uuid-001')
    expect(mockDb.updateCalls.filter(c => c.table === 'coupon_usage')).toHaveLength(2)
  })

  it('idempotent replay: links the existing order to this customer\'s still-unlinked claim before returning it', async () => {
    const { couponIdentityKey } = await import('@/lib/server/couponClaim')
    const key = couponIdentityKey('9876543210')
    mockDb.responses['orders'] = {
      id: 'order-existing-001', order_number: 'PREXIST01', total_amount: 500, order_status: 'confirmed',
      payment_method: 'cod', loyalty_points_redeemed: 0, coupon_discount: 40, created_at: '2026-11-06T10:00:00Z',
    }
    mockDb.responses['order_items'] = [{ product_id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 2 }]
    mockDb.responses['coupons'] = COUPON
    let usageCalls = 0
    mockDb.responses['coupon_usage'] = () => {
      usageCalls++
      if (usageCalls === 1) return []                                                         // nothing linked to the order yet
      if (usageCalls === 2) return [
        { id: 90, customer_id: null, identity_key: 'ph:someone-else' },                       // another person's claim — never taken
        { id: 77, customer_id: null, identity_key: key },
      ]
      return []                                                                                // the PATCH
    }
    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder({ ...BASE_INPUT, customerPhone: '9876543210', couponCode: 'TRACK5' }, DEFAULT_SETTINGS)
    expect(result.alreadyExists).toBe(true)
    const attach = mockDb.updateCalls.find(c => c.table === 'coupon_usage')
    expect(attach).toBeDefined()
    expect(attach!.eqCalls.some(a => a[0] === 'id' && a[1] === 77)).toBe(true)
    expect(attach!.payload).toMatchObject({ order_id: 'order-existing-001', discount_amount: 40 })
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
  })

  it('idempotent replay: an already-linked claim is left alone (idempotent)', async () => {
    mockDb.responses['orders'] = {
      id: 'order-existing-001', order_number: 'PREXIST01', total_amount: 500, order_status: 'confirmed',
      payment_method: 'cod', loyalty_points_redeemed: 0, coupon_discount: 40,
    }
    mockDb.responses['order_items'] = [{ product_id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 2 }]
    mockDb.responses['coupons'] = COUPON
    mockDb.responses['coupon_usage'] = [{ id: 77 }]
    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder({ ...BASE_INPUT, couponCode: 'TRACK5' }, DEFAULT_SETTINGS)
    expect(result.alreadyExists).toBe(true)
    expect(mockDb.updateCalls.find(c => c.table === 'coupon_usage')).toBeUndefined()
  })

  it('idempotent replay without a coupon does not touch coupon_usage', async () => {
    mockDb.responses['orders'] = {
      id: 'order-existing-001', order_number: 'PREXIST01', total_amount: 500, order_status: 'confirmed',
      payment_method: 'cod', loyalty_points_redeemed: 0,
    }
    mockDb.responses['order_items'] = [{ product_id: PRODUCT_ID, variant_id: VARIANT_ID, quantity: 2 }]
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder(BASE_INPUT, DEFAULT_SETTINGS)
    expect(mockDb.updateCalls.find(c => c.table === 'coupon_usage')).toBeUndefined()
  })
})

// Nov 2026: risky-COD gate (owner decision). createOrder calls the injected gate for a COD order once the customer and the COD
// total are known, and a refusal stops the order before it is written.
describe('createOrder — risky-COD gate', () => {
  it('calls the gate for COD with the customer ids, the COD total and the phone; a refusal creates no order', async () => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
    wireOrderRpcSuccess()
    const { CheckoutRejectedError } = await import('@/lib/errors/checkoutErrors')
    const gate = vi.fn(async () => { throw new CheckoutRejectedError('verify first', 'COD_VERIFICATION_REQUIRED') })
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...BASE_INPUT, paymentMethod: 'cod', codRiskGate: gate }, DEFAULT_SETTINGS)).rejects.toMatchObject({ code: 'COD_VERIFICATION_REQUIRED' })
    expect(gate).toHaveBeenCalledTimes(1)
    const ctx = (gate.mock.calls[0] as unknown as [{ customerIds: string[]; codTotal: number; phone10: string | null }])[0]
    expect(ctx.customerIds.length).toBeGreaterThan(0)
    expect(ctx.codTotal).toBeGreaterThan(0)
    expect(ctx.phone10).toMatch(/^\d{10}$/)
    expect(mockDb.rpcCalls.find(c => c.rpcName === 'create_order_with_items')).toBeUndefined()
  })
  it('is never called for an online payment', async () => {
    mockDb.responses['orders'] = null
    mockDb.rpcResponses['reserve_stock_at_order'] = true
    wireHappyPathFetch()
    wireOrderRpcSuccess()
    const gate = vi.fn(async () => {})
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...BASE_INPUT, paymentMethod: 'razorpay', codRiskGate: gate }, DEFAULT_SETTINGS)
    expect(gate).not.toHaveBeenCalled()
  })
})
