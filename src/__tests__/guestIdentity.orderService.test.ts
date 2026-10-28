/**
 * guestIdentity.orderService.test.ts — AUDIT S1-002, S1-005, S1-006, S1-013, B1-16 (track R2b)
 *
 * createOrder() used to resolve a GUEST to an existing customers row by the phone number typed into
 * the checkout form, PATCH that row's profile, and let loyalty / coupon limits / COD slots run
 * against it. Anyone who knows a customer's phone number could therefore rewrite their address,
 * spend their Pahadi Coins and consume their coupon allowance.
 *
 * Covered here (each failed before the fix):
 *   1. a guest order with an existing customer's phone never PATCHes that row; a NEW row is inserted
 *   2. a guest asking to redeem loyalty points is rejected (401 at the route) before any work
 *   3. the coupon claim for a guest carries NO customer id (phone match is never adopted)
 *   4. the per-customer coupon limit is still enforced for guests, read-only, via phone/email history
 *   5. the COD active-order cap counts every row sharing the phone (read-only abuse cap — the ONLY
 *      thing phone matching may be used for)
 *   6. when the guest row cannot be inserted (unique index) the order attaches to the existing row
 *      WITHOUT a PATCH and without crediting it the coupon use
 *   7. S1-006: create RPC outcome unknown (timeout / transport error) → stock + coupon NOT restored,
 *      alert raised, OrderOutcomeUnknownError thrown; a committed order found on re-read is used
 *   8. S1-013: idempotency unique violation → the twin's order is returned, our reservation released
 *   9. S1-013: sub-₹1 online total is refused before an order row exists
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ captureError: vi.fn(), warn: vi.fn(), error: vi.fn(), metric: vi.fn(), info: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  captureError: h.captureError,
  logger: { warn: h.warn, error: h.error, metric: h.metric, info: h.info, debug: vi.fn() },
}))

// ─── Supabase JS client mock (db.from / db.rpc) ───────────────────────────────
interface MockDb {
  responses:    Record<string, unknown>
  rpcResponses: Record<string, unknown>
  rpcCalls:     Array<{ rpcName: string; args: unknown }>
  updateCalls:  Array<{ table: string; payload: unknown }>
}
let mockDb: MockDb
const resetMockDb = () => { mockDb = { responses: {}, rpcResponses: {}, rpcCalls: [], updateCalls: [] } }

function buildQueryBuilder(table: string) {
  const response = (terminal: 'maybeSingle' | 'single' | 'then' = 'then') => {
    const raw = mockDb.responses[table]
    const val = typeof raw === 'function' ? (raw as (t: string) => unknown)(terminal) : raw
    if (val instanceof Error) return { data: null, error: val }
    return { data: val ?? null, error: null }
  }
  const b: Record<string, (...a: unknown[]) => unknown> = {
    select: () => b, insert: () => b, delete: () => b, upsert: () => b,
    update: (payload: unknown) => { mockDb.updateCalls.push({ table, payload }); return b },
    eq: () => b, neq: () => b, is: () => b, gt: () => b, gte: () => b, lt: () => b, lte: () => b, in: () => b, limit: () => b, order: () => b,
    maybeSingle: () => Promise.resolve(response('maybeSingle')),
    single:      () => Promise.resolve(response('single')),
    then:        (...a: unknown[]) => Promise.resolve(response()).then(a[0] as (v: unknown) => unknown),
  }
  return b
}

vi.mock('@/lib/supabase', () => ({
  getServiceClient: () => ({
    from: (table: string) => buildQueryBuilder(table),
    rpc:  (name: string, args: unknown) => {
      mockDb.rpcCalls.push({ rpcName: name, args })
      const val = mockDb.rpcResponses[name]
      if (typeof val === 'function') return (val as () => unknown)()
      if (val instanceof Error) return Promise.resolve({ data: null, error: val })
      if (val === undefined && name === 'claim_coupon_use') return Promise.resolve({ data: { ok: true, usage_id: 77 }, error: null })
      return Promise.resolve({ data: val ?? true, error: null })
    },
  }),
  supabase: {},
}))

// ─── fetch mock (sbGet / sbPost REST calls) ───────────────────────────────────
type Route = { match: (url: string, method: string, body?: string) => boolean; json: unknown; ok?: boolean }
let routes: Route[] = []
let fetchCalls: Array<{ url: string; method: string; body?: string }> = []
const route      = (match: Route['match'], json: unknown, ok = true) => { routes.push({ match, json, ok }) }
const routeFirst = (match: Route['match'], json: unknown, ok = true) => { routes.unshift({ match, json, ok }) }

const mockFetch = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
  const method = init?.method ?? 'GET'
  fetchCalls.push({ url, method, body: init?.body })
  const found = routes.find(r => r.match(url, method, init?.body))
  const ok    = found ? found.ok !== false : false
  const json  = found ? found.json : { message: 'no mock route' }
  return { ok, status: ok ? 200 : 400, json: async () => json, text: async () => JSON.stringify(json) }
})

const VARIANT_ID = 'var-uuid-1'
const PRODUCT_ID = 'prod-uuid-1'
const VICTIM_ID  = 'cust-victim-42'
const NEW_GUEST  = 'cust-guest-900'

const SETTINGS = {
  free_shipping_min: '799', flat_shipping_charge: '99', prepaid_discount_pct: '5', cod_enabled: 'true',
  loyalty_points_value: '0.25', loyalty_max_redeem_pct: '20', cod_max_active_orders: '3',
} as any

const GUEST_INPUT = {
  customerName: 'Attacker Person', customerPhone: '9876543210', customerEmail: 'guest@example.com',
  flat: '1 Somewhere', area: '', city: 'Delhi', state: 'Delhi', pincode: '110001',
  items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, qty: 2 }],
  paymentMethod: 'cod' as const,
  idempotencyKey: '123e4567-e89b-12d3-a456-426614174000',
}

/** Catalogue + "no customer rows share this phone/email" + fresh guest insert. */
function wireHappyPath(opts: { customerMatches?: Array<{ id: string }>; variantPrice?: number } = {}) {
  const price = opts.variantPrice ?? 200
  route((u, m) => m === 'GET' && u.includes('/product_variants') && u.includes(VARIANT_ID),
    [{ id: VARIANT_ID, price, original_price: price + 50, is_active: true, available_stock: 10, product_id: PRODUCT_ID }])
  route((u, m) => m === 'GET' && u.includes('/products') && u.includes(PRODUCT_ID),
    [{ id: PRODUCT_ID, name: 'Himalayan Honey', emoji: '🍯', gst_rate: 5, is_deleted: false, status: 'active', price, mrp: price + 50, available_stock: 10 }])
  route((u, m) => m === 'GET' && u.includes('/product_images'), [])
  route((u, m) => m === 'GET' && u.includes('/customers') && u.includes('normalized_phone=eq.'), opts.customerMatches ?? [])
  route((u, m) => m === 'GET' && u.includes('/customers') && u.includes('email=eq.'), [])
  route((u, m) => m === 'POST' && u.includes('/customers'), [{ id: NEW_GUEST }])
  route((u, m) => m === 'GET' && u.includes('/orders') && u.includes('payment_method=in.'), [])
  route((u, m) => m === 'GET' && u.includes('/coupon_usage'), [])
  mockDb.responses['orders'] = null
  mockDb.rpcResponses['reserve_stock_at_order'] = true
  mockDb.rpcResponses['create_order_with_items'] = [{ id: 'order-1', order_number: 'PR1', total_amount: 400, order_status: 'confirmed' }]
}

const customerPatches = () => fetchCalls.filter(c => c.method === 'PATCH' && c.url.includes('/customers'))
const customerPosts   = () => fetchCalls.filter(c => c.method === 'POST'  && c.url.includes('/customers'))
const rpc = (name: string) => mockDb.rpcCalls.filter(c => c.rpcName === name)

beforeEach(() => {
  resetMockDb(); routes = []; fetchCalls = []
  mockFetch.mockClear(); h.captureError.mockClear(); h.warn.mockClear()
  vi.stubGlobal('fetch', mockFetch)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_KEY     = 'test-service-key'
})
afterEach(() => { vi.useRealTimers() })

// ─────────────────────────────────────────────────────────────────────────────

describe('S1-002 — guest checkout never adopts or modifies an existing customer', () => {
  it('a guest order with a phone that matches an existing customer leaves that row unchanged and inserts a NEW (guest) row', async () => {
    wireHappyPath({ customerMatches: [{ id: VICTIM_ID }] })
    const { createOrder } = await import('@/lib/services/orderService')

    const result = await createOrder(GUEST_INPUT, SETTINGS)

    expect(customerPatches()).toHaveLength(0)                       // the victim's profile is never touched
    expect(customerPosts().length).toBeGreaterThanOrEqual(1)        // a separate row for this guest
    expect(JSON.parse(customerPosts()[0].body!)).toMatchObject({ is_guest: true, phone: '9876543210' })
    const create = rpc('create_order_with_items')[0]
    expect((create.args as any).p_customer_id).toBe(NEW_GUEST)       // the order belongs to the new row …
    expect((create.args as any).p_customer_id).not.toBe(VICTIM_ID)   // … never to the phone-matched one
    expect(result.customerId).toBe(NEW_GUEST)
  })

  it('a guest with NO matching customer still gets a new row (unchanged happy path)', async () => {
    wireHappyPath()
    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder(GUEST_INPUT, SETTINGS)
    expect(result.alreadyExists).toBe(false)
    expect(customerPatches()).toHaveLength(0)
    expect(customerPosts()).toHaveLength(1)
  })

  it('drops the is_guest flag (once per instance) when the column is not deployed yet, and the row is still created', async () => {
    vi.resetModules()   // fresh _guestFlagSupported probe state
    wireHappyPath()
    routeFirst((u, m, body) => m === 'POST' && u.includes('/customers') && !!body && body.includes('is_guest'),
      { message: "Could not find the 'is_guest' column of 'customers' in the schema cache" }, false)
    const { createOrder } = await import('@/lib/services/orderService')

    await createOrder(GUEST_INPUT, SETTINGS)
    const posts = customerPosts()
    expect(JSON.parse(posts[posts.length - 1].body!)).not.toHaveProperty('is_guest')
    expect(rpc('create_order_with_items')).toHaveLength(1)

    // second order on the same instance: no is_guest probe at all
    fetchCalls = []
    await createOrder({ ...GUEST_INPUT, idempotencyKey: '123e4567-e89b-12d3-a456-426614174001' }, SETTINGS)
    expect(customerPosts().every(p => !p.body!.includes('is_guest'))).toBe(true)
    expect(customerPatches()).toHaveLength(0)
  })

  it('a signed-in customer is used directly: no phone lookup, no PATCH, no insert', async () => {
    wireHappyPath({ customerMatches: [{ id: VICTIM_ID }] })
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...GUEST_INPUT, authenticatedCustomerId: 'cust-auth-7' }, SETTINGS)
    expect(fetchCalls.some(c => c.url.includes('/customers'))).toBe(false)
    expect((rpc('create_order_with_items')[0].args as any).p_customer_id).toBe('cust-auth-7')
  })

  it('LIVE SCHEMA path: customers.normalized_phone is a generated UNIQUE column, so a returning guest insert collides → the order attaches to the existing row WITHOUT a PATCH, without coupon credit, logged at info (no alert)', async () => {
    wireHappyPath({ customerMatches: [{ id: VICTIM_ID }] })
    routeFirst((u, m) => m === 'POST' && u.includes('/customers'),
      { message: 'duplicate key value violates unique constraint "customers_normalized_phone_key"' }, false)
    mockDb.responses['coupons'] = { id: 5, code: 'SAVE50', value: 50, type: 'flat', max_uses: null, uses_count: 0, is_active: true, expires_at: null, min_order: null, max_discount: null }
    const { createOrder } = await import('@/lib/services/orderService')

    const result = await createOrder({ ...GUEST_INPUT, couponCode: 'SAVE50' }, SETTINGS)

    expect(result.customerId).toBe(VICTIM_ID)
    expect(customerPatches()).toHaveLength(0)
    const attach = mockDb.updateCalls.find(u => u.table === 'coupon_usage')
    expect(attach?.payload).toMatchObject({ order_id: 'order-1', customer_id: null })   // the use is NOT booked on the victim
    expect(h.captureError).not.toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ action: 'createOrder.guest_row_insert_failed' }))
  })

  it('an UNEXPECTED customers insert failure (not the unique index) still attaches read-only but alerts ops', async () => {
    wireHappyPath({ customerMatches: [{ id: VICTIM_ID }] })
    routeFirst((u, m) => m === 'POST' && u.includes('/customers'), { message: 'permission denied for table customers' }, false)
    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder({ ...GUEST_INPUT }, SETTINGS)
    expect(result.customerId).toBe(VICTIM_ID)
    expect(customerPatches()).toHaveLength(0)
    expect(h.captureError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ action: 'createOrder.guest_row_insert_failed', alert: true }))
  })
})

describe('S1-002 — loyalty redemption requires a verified account', () => {
  it('guest + loyalty_points_redeemed > 0 → LoyaltyAuthRequiredError before any read, reservation or lookup', async () => {
    wireHappyPath({ customerMatches: [{ id: VICTIM_ID }] })
    mockDb.responses['customers'] = { loyalty_points: 5000 }   // the victim's balance — must never be consulted
    const { createOrder, LoyaltyAuthRequiredError } = await import('@/lib/services/orderService')

    await expect(createOrder({ ...GUEST_INPUT, loyaltyPointsRedeemed: 100 }, SETTINGS)).rejects.toBeInstanceOf(LoyaltyAuthRequiredError)
    expect(fetchCalls).toHaveLength(0)
    expect(mockDb.rpcCalls).toHaveLength(0)
  })

  it('a signed-in customer can still redeem (balance guard runs against THEIR id)', async () => {
    wireHappyPath()
    mockDb.responses['customers'] = { loyalty_points: 500 }
    const { createOrder } = await import('@/lib/services/orderService')
    const result = await createOrder({ ...GUEST_INPUT, loyaltyPointsRedeemed: 100, authenticatedCustomerId: 'cust-auth-7' }, SETTINGS)
    expect(result.alreadyExists).toBe(false)
    expect((rpc('create_order_with_items')[0].args as any).p_loyalty_points_redeemed).toBe(100)
  })
})

describe('S1-002 / B1-16 — coupons for guests', () => {
  const coupon = (extra: Record<string, unknown> = {}) => ({
    id: 7, code: 'WELCOME50', value: 50, type: 'flat', max_uses: 100, uses_count: 1,
    is_active: true, expires_at: null, min_order: null, max_discount: null, ...extra,
  })

  it('the atomic claim is made with NO customer id for a guest, even when the phone matches an existing row', async () => {
    wireHappyPath({ customerMatches: [{ id: VICTIM_ID }] })
    mockDb.responses['coupons'] = coupon()
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...GUEST_INPUT, couponCode: 'WELCOME50' }, SETTINGS)
    expect((rpc('claim_coupon_use')[0].args as any).p_customer_id).toBeNull()
    // the usage row is booked on the guest's own new row, not the victim
    expect(mockDb.updateCalls.find(u => u.table === 'coupon_usage')?.payload).toMatchObject({ customer_id: NEW_GUEST })
  })

  it('user_limit is enforced for a guest from the phone/email history (read-only), since claim_coupon_use skips it for NULL customers', async () => {
    wireHappyPath({ customerMatches: [{ id: VICTIM_ID }] })
    mockDb.responses['coupons'] = coupon({ user_limit: 1 })
    routeFirst((u, m) => m === 'GET' && u.includes('/coupon_usage') && u.includes(`customer_id=in.(${VICTIM_ID})`), [{ id: 1 }])
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...GUEST_INPUT, couponCode: 'WELCOME50' }, SETTINGS)).rejects.toThrow(/already used this coupon/i)
    expect(rpc('claim_coupon_use')).toHaveLength(0)
    expect(rpc('create_order_with_items')).toHaveLength(0)
    expect(rpc('restore_stock').length).toBeGreaterThan(0)   // reservation given back
  })

  it('first_order_only is denied for a guest whose phone/email already placed an order', async () => {
    wireHappyPath({ customerMatches: [{ id: VICTIM_ID }] })
    mockDb.responses['coupons'] = coupon({ first_order_only: true })
    routeFirst((u, m) => m === 'GET' && u.includes('/orders') && u.includes(`customer_id=in.(${VICTIM_ID})`) && u.includes('payment_status=in.'), [{ id: 'old-order' }])
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...GUEST_INPUT, couponCode: 'WELCOME50' }, SETTINGS)).rejects.toThrow(/first order only/i)
  })
})

describe('S1-002 — COD active-order cap is counted per phone (read-only), never reset by a fresh guest row', () => {
  it('blocks a guest whose phone already has cod_max_active_orders orders in flight under another row', async () => {
    wireHappyPath({ customerMatches: [{ id: VICTIM_ID }] })
    routeFirst((u, m) => m === 'GET' && u.includes('/orders') && u.includes('payment_method=in.') && u.includes(NEW_GUEST) && u.includes(VICTIM_ID),
      [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }])
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder(GUEST_INPUT, SETTINGS)).rejects.toThrow(/already in progress/i)
    expect(rpc('create_order_with_items')).toHaveLength(0)
    expect(customerPatches()).toHaveLength(0)
  })
})

describe('S1-006 / S1-005 — create RPC outcome unknown: never restore blindly', () => {
  it('RPC times out and the re-read finds no order → OrderOutcomeUnknownError, stock + coupon claim left in place, alert raised', async () => {
    vi.useFakeTimers()
    wireHappyPath()
    mockDb.responses['coupons'] = { id: 5, code: 'SAVE50', value: 50, type: 'flat', max_uses: null, uses_count: 0, is_active: true, expires_at: null, min_order: null, max_discount: null }
    mockDb.rpcResponses['create_order_with_items'] = () => new Promise(() => { /* never settles — PostgREST hung */ })
    const { createOrder, OrderOutcomeUnknownError } = await import('@/lib/services/orderService')

    const pending = createOrder({ ...GUEST_INPUT, couponCode: 'SAVE50' }, SETTINGS)
    const settled = pending.then(() => 'resolved', (e: unknown) => e)
    await vi.advanceTimersByTimeAsync(8_500)
    const err = await settled

    expect(err).toBeInstanceOf(OrderOutcomeUnknownError)
    expect(rpc('restore_stock')).toHaveLength(0)
    expect(rpc('release_coupon_claim')).toHaveLength(0)
    expect(h.captureError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      action: 'createOrder.rpc_outcome_unknown', alert: true, idempotency_key: GUEST_INPUT.idempotencyKey, coupon_usage_id: 77,
    }))
  })

  it('transport error on the RPC (request may have reached Postgres) is treated the same way', async () => {
    wireHappyPath()
    mockDb.rpcResponses['create_order_with_items'] = () => Promise.reject(new Error('socket hang up'))
    const { createOrder, OrderOutcomeUnknownError } = await import('@/lib/services/orderService')
    await expect(createOrder(GUEST_INPUT, SETTINGS)).rejects.toBeInstanceOf(OrderOutcomeUnknownError)
    expect(rpc('restore_stock')).toHaveLength(0)
  })

  it('RPC times out but the re-read finds the committed order → continues as a normal success, nothing restored', async () => {
    vi.useFakeTimers()
    wireHappyPath()
    mockDb.rpcResponses['create_order_with_items'] = () => new Promise(() => { /* hung */ })
    // idempotency pre-check: nothing; re-read after the timeout: the committed row
    let ordersReads = 0
    mockDb.responses['orders'] = (terminal: string) => {
      if (terminal !== 'maybeSingle') return []
      ordersReads++
      return ordersReads === 1 ? null : { id: 'order-late', order_number: 'PRLATE', total_amount: 400, order_status: 'confirmed', confirmation_token: null }
    }
    const { createOrder } = await import('@/lib/services/orderService')

    const pending = createOrder(GUEST_INPUT, SETTINGS)
    const settled = pending.then(r => r, (e: unknown) => e)
    await vi.advanceTimersByTimeAsync(8_500)
    const result = await settled

    expect(result).not.toBeInstanceOf(Error)
    expect((result as any).alreadyExists).toBe(false)
    expect((result as any).order.id).toBe('order-late')
    expect(rpc('restore_stock')).toHaveLength(0)
    expect(h.captureError).not.toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ action: 'createOrder.rpc_outcome_unknown' }))
  })

  it('a genuine RPC error (Postgres said no) still restores stock as before', async () => {
    wireHappyPath()
    mockDb.rpcResponses['create_order_with_items'] = new Error('null value in column "total_amount"')
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder(GUEST_INPUT, SETTINGS)).rejects.toThrow(/Failed to create order/)
    expect(rpc('restore_stock').length).toBeGreaterThan(0)
  })
})

describe('S1-013 — idempotency edges', () => {
  it('unique violation on idempotency_key (concurrent twin committed first) → returns the twin as alreadyExists and releases OUR reservation', async () => {
    wireHappyPath()
    const dup = new Error('duplicate key value violates unique constraint "orders_idempotency_key_key"') as Error & { code?: string }
    dup.code = '23505'
    mockDb.rpcResponses['create_order_with_items'] = dup
    let reads = 0
    mockDb.responses['orders'] = (terminal: string) => {
      if (terminal !== 'maybeSingle') return []
      reads++
      return reads === 1 ? null : { id: 'order-twin', order_number: 'PRTWIN', total_amount: 400, order_status: 'confirmed', confirmation_token: 'tok' }
    }
    const { createOrder } = await import('@/lib/services/orderService')

    const result = await createOrder(GUEST_INPUT, SETTINGS)
    expect(result.alreadyExists).toBe(true)
    expect(result.order.order_number).toBe('PRTWIN')
    expect(rpc('restore_stock').length).toBeGreaterThan(0)   // the twin owns the stock; ours goes back
  })

  it('an online order whose total is below ₹1 is refused before any order row exists (Razorpay would reject it)', async () => {
    wireHappyPath({ variantPrice: 20 })   // subtotal 40, flat coupon 5000 → eligible subtotal fully covered
    mockDb.responses['coupons'] = { id: 9, code: 'FREE', value: 5000, type: 'flat', max_uses: null, uses_count: 0, is_active: true, expires_at: null, min_order: null, max_discount: null }
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...GUEST_INPUT, paymentMethod: 'razorpay', couponCode: 'FREE' }, { ...SETTINGS, free_shipping_min: '0' }))
      .rejects.toThrow(/cannot be paid online/i)
    expect(rpc('create_order_with_items')).toHaveLength(0)
    expect(rpc('release_coupon_claim')).toHaveLength(1)
  })
})
