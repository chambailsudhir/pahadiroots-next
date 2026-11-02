/**
 * ordersLoyaltyHold.test.ts — orders audit Nov 2026: #3 (COD coins held), #4 (min redeem / stored points).
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
  const chain: string[] = []
  const response = (terminal: 'maybeSingle' | 'single' | 'then' = 'then') => {
    const raw = mockDb.responses[table]
    const val = typeof raw === 'function' ? (raw as (t: string, c: string[]) => unknown)(terminal, chain) : raw
    if (val instanceof Error) return { data: null, error: val }
    return { data: val ?? null, error: null }
  }
  const b: Record<string, (...a: unknown[]) => unknown> = {
    select: () => b, insert: () => b, delete: () => b, upsert: () => b,
    update: (payload: unknown) => { mockDb.updateCalls.push({ table, payload }); return b },
    eq: (...a: unknown[]) => { chain.push(`eq:${a[0]}`); return b }, neq: () => b, is: () => b, gt: () => b, gte: () => b, lt: () => b, lte: () => b,
    in: (...a: unknown[]) => { chain.push(`in:${a[0]}`); return b }, limit: () => b, order: () => b,
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

/** Rows returned for the auth-link check made on a unique-index collision. */
function guestRowLookup(rows: Array<{ id: string; auth_user_id: string | null; normalized_phone?: string }> = [{ id: VICTIM_ID, auth_user_id: null, normalized_phone: '9876543210' }]) {
  routeFirst((u, m) => m === 'GET' && u.includes('/customers') && u.includes('auth_user_id'), rows)
}


const rpc = (name: string) => mockDb.rpcCalls.filter(c => c.rpcName === name)
beforeEach(() => {
  resetMockDb(); routes = []; fetchCalls = []
  mockFetch.mockClear()
  vi.stubGlobal('fetch', mockFetch)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_KEY     = 'test-service-key'
})
afterEach(() => { vi.useRealTimers() })

const AUTHED = { ...GUEST_INPUT, authenticatedCustomerId: 'cust-auth-7' }
const SET = { ...SETTINGS, loyalty_min_redeem: '40' } as any

/** orders answers: online-held query (no payment_method filter) vs COD-held query (in:payment_method). */
function ordersAnswer(opts: { online?: unknown[]; cod?: unknown[] }) {
  mockDb.responses['orders'] = (terminal: string, chain: string[]) =>
    terminal !== 'then' ? null : chain.includes('in:payment_method') ? (opts.cod ?? []) : (opts.online ?? [])
}

describe('#3 — in-flight COD orders with coins and no redeem row are HELD', () => {
  it('balance 500, an open COD order holds 400 (no ledger row) -> asking 200 is refused', async () => {
    wireHappyPath()
    mockDb.responses['customers'] = { loyalty_points: 500 }
    ordersAnswer({ cod: [{ id: 'o-cod', order_status: 'confirmed', loyalty_points_redeemed: 400 }] })
    mockDb.responses['loyalty_transactions'] = []
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...AUTHED, loyaltyPointsRedeemed: 200 }, SET)).rejects.toThrow(/insufficient loyalty balance/i)
    expect(rpc('create_order_with_items')).toHaveLength(0)
  })

  it('the same COD order already has its redeem ledger row -> not held (balance already reduced)', async () => {
    wireHappyPath()
    mockDb.responses['customers'] = { loyalty_points: 500 }
    ordersAnswer({ cod: [{ id: 'o-cod', order_status: 'confirmed', loyalty_points_redeemed: 400 }] })
    mockDb.responses['loyalty_transactions'] = [{ order_id: 'o-cod' }]
    const { createOrder } = await import('@/lib/services/orderService')
    const r = await createOrder({ ...AUTHED, loyaltyPointsRedeemed: 200 }, SET)
    expect(r.alreadyExists).toBe(false)
  })

  it('a cancelled COD order holds nothing', async () => {
    wireHappyPath()
    mockDb.responses['customers'] = { loyalty_points: 500 }
    ordersAnswer({ cod: [{ id: 'o-cod', order_status: 'cancelled', loyalty_points_redeemed: 400 }] })
    mockDb.responses['loyalty_transactions'] = []
    const { createOrder } = await import('@/lib/services/orderService')
    expect((await createOrder({ ...AUTHED, loyaltyPointsRedeemed: 200 }, SET)).alreadyExists).toBe(false)
  })
})

describe('#4 — minimum redeem and stored coin count', () => {
  it('below loyalty_min_redeem is refused in createOrder (not only in the UI)', async () => {
    wireHappyPath()
    mockDb.responses['customers'] = { loyalty_points: 500 }
    ordersAnswer({})
    const { createOrder } = await import('@/lib/services/orderService')
    await expect(createOrder({ ...AUTHED, loyaltyPointsRedeemed: 10 }, SET)).rejects.toThrow(/minimum 40 points required to redeem/i)
    expect(rpc('create_order_with_items')).toHaveLength(0)
  })

  it('stores ceil(clampedDiscount / pointsValue): 4000 coins asked, 20% cap of Rs400 = Rs80 -> 320 coins stored', async () => {
    wireHappyPath()   // 2 x Rs200 = Rs400 subtotal
    mockDb.responses['customers'] = { loyalty_points: 5000 }
    ordersAnswer({})
    const { createOrder } = await import('@/lib/services/orderService')
    const r = await createOrder({ ...AUTHED, loyaltyPointsRedeemed: 4000 }, SET)
    expect((rpc('create_order_with_items')[0].args as any).p_loyalty_points_redeemed).toBe(320)
    expect(r.order.loyaltyPointsRedeemed).toBe(320)
  })

  it('points_value < 1 floor() no longer wastes coins: value 0.3, 41 coins -> Rs12 -> ceil(12/0.3)=40 stored', async () => {
    wireHappyPath()
    mockDb.responses['customers'] = { loyalty_points: 500 }
    ordersAnswer({})
    const { createOrder } = await import('@/lib/services/orderService')
    await createOrder({ ...AUTHED, loyaltyPointsRedeemed: 41 }, { ...SET, loyalty_points_value: '0.3' })
    expect((rpc('create_order_with_items')[0].args as any).p_loyalty_points_redeemed).toBe(40)
  })
})
