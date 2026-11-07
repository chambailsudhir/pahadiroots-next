/**
 * ordersRouteTimeoutRecovery.test.ts
 *
 * AUDIT ACC-032 — live evidence: POST /api/v1/orders answered 503 "server briefly slow" after ~32 s
 * (ORDER_CREATE_TIMEOUT) while the RPC went on to COMMIT the order a moment later, so the customer
 * saw an error for an order that exists. When the create budget is exceeded the route must look the
 * order up by its idempotency key and return it as a success; only a genuine miss is a 503.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (cb: () => void | Promise<void>) => { void cb() } }
})

const mockCreateOrder = vi.fn()
const mockLogOrderEvent = vi.fn().mockResolvedValue(undefined)
const mockEnsureLinked = vi.fn().mockResolvedValue('linked')
vi.mock('@/lib/services/orderService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/orderService')>()
  return { ...actual, createOrder: mockCreateOrder, logOrderEvent: mockLogOrderEvent, ensureCouponUsageLinked: mockEnsureLinked }
})

const mockSbAdmin = vi.fn()
vi.mock('@/lib/api/serverUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/serverUtils')>()
  return { ...actual, sbAdmin: mockSbAdmin, checkCsrf: () => null }
})

const mockAward  = vi.fn().mockResolvedValue(undefined)
const mockRedeem = vi.fn().mockResolvedValue(true)
vi.mock('@/lib/server/loyalty', () => ({ awardLoyaltyPoints: mockAward, redeemLoyaltyPoints: mockRedeem }))
vi.mock('@/lib/getSiteSettings', () => {
  const getSiteSettings = vi.fn().mockResolvedValue({
    cod_enabled: 'true', order_email_enabled: 'false', loyalty_enabled: 'false',
    loyalty_points_per_rupee: '1', loyalty_points_value: '0.25', loyalty_max_redeem_pct: '20',
    admin_notify_email: '', store_open: 'true',
  })
  return { getSiteSettings, getFreshSiteSettings: (...a: unknown[]) => (getSiteSettings as (...x: unknown[]) => unknown)(...a) }
})
vi.mock('@/lib/api/rateLimitKv', () => ({
  checkRateLimitKv:       vi.fn().mockResolvedValue(true),
  checkRateLimitKvStrict: vi.fn().mockResolvedValue('allowed'),
  RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SEC: 10,
}))
vi.mock('@/lib/supabase', () => ({ getServiceClient: () => ({ from: () => ({}), rpc: () => Promise.resolve({ data: true, error: null }) }), supabase: {} }))

const KEY = '123e4567-e89b-12d3-a456-426614174000'
const BODY = {
  address:         { name: 'Ramesh Kumar', phone: '9876543210', flat: '12 Pahadi Lane', area: 'Shimla Hills', city: 'Shimla', state: 'Himachal Pradesh', pincode: '171001' },
  items:           [{ productId: 'prod-uuid-1', variantId: 'var-uuid-1', qty: 1 }],
  payment_method:  'cod' as const,
  idempotency_key: KEY,
  customer_email:  'ramesh@example.com',
}

async function callOrders(extra: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/v1/orders/route')
  return POST(new Request('http://localhost/api/v1/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1', origin: 'http://localhost:3000' },
    body: JSON.stringify({ ...BODY, ...extra }),
  }) as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ORDER_CREATE_BUDGET_MS', '300')
  mockCreateOrder.mockImplementation(() => new Promise(() => { /* hangs past the budget */ }))
})

const COMMITTED_ROW = { id: 163, order_number: 'ORD-2026-00140', confirmation_token: 'tok-1', total_amount: 500, subtotal: 500, shipping_charge: 0, cod_surcharge: 0, coupon_discount: 0, customer_id: 58 }

/** Path-aware sbAdmin: the order row, the once-only marker (empty = not finalised yet) and the order items. */
function wireDb(opts: { order?: unknown[]; finalised?: boolean } = {}) {
  mockSbAdmin.mockImplementation(async (_m: string, path: string) => {
    if (path.startsWith('/rest/v1/orders?idempotency_key=')) return opts.order ?? [COMMITTED_ROW]
    if (path.startsWith('/rest/v1/order_events?')) return opts.finalised ? [{ id: 9 }] : []
    if (path.startsWith('/rest/v1/order_items?')) return [{ quantity: 2, price_at_time: 250, product_name_snapshot: 'Wild Honey', variant_value_snapshot: '500g', products: { emoji: '🍯', image_url: null } }]
    return []
  })
}

describe('POST /api/v1/orders — recover a committed order after the create budget is exceeded (ACC-032)', () => {
  it('returns the already-committed order as a success instead of a 503', async () => {
    wireDb()
    const res  = await callOrders()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ success: true, order_number: 'ORD-2026-00140', order_id: 163, confirmation_token: 'tok-1' })
    expect(mockSbAdmin).toHaveBeenCalledWith('GET', expect.stringContaining(`idempotency_key=eq.${KEY}`))
  })

  it('still answers a fast 503 when the order genuinely does not exist', async () => {
    wireDb({ order: [] })
    const res = await callOrders()

    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('5')
    expect(mockAward).not.toHaveBeenCalled()
  })

  it('treats a failing lookup as "not found" (503), never as an unhandled error', async () => {
    mockSbAdmin.mockRejectedValue({ status: 500, message: 'db down' })
    const res = await callOrders()

    expect(res.status).toBe(503)
  })
})

describe('recovered order gets its post-order steps exactly once (loyalty + once-only marker)', () => {
  it('redeems requested coins and records the marker BEFORE finalising (no coins are awarded at placement any more)', async () => {
    wireDb()
    const res = await callOrders()
    expect(res.status).toBe(200)

    expect(mockLogOrderEvent).toHaveBeenCalledWith('163', 'post_order_finalized', 'system', expect.objectContaining({ via: 'timeout_recovery' }))
    // Coins are paid on DELIVERY by a database trigger (db_migration_v28), never at placement.
    expect(mockAward).not.toHaveBeenCalled()
  })

  it('does NOT run them again when the marker already exists (customer retried and timed out again)', async () => {
    wireDb({ finalised: true })
    const res = await callOrders()

    expect(res.status).toBe(200)                       // the customer still gets their order
    expect(mockAward).not.toHaveBeenCalled()
    expect(mockLogOrderEvent).not.toHaveBeenCalled()
  })

  it('a crash inside the post-order steps never turns a committed order into an error', async () => {
    wireDb()
    mockAward.mockRejectedValueOnce(new Error('loyalty rpc down'))
    const res = await callOrders()

    expect(res.status).toBe(200)
  })
})

// Verification F-1 (Nov 2026): the first request timed out BEFORE the commit landed -> 503; the customer retried with the same key,
// createOrder answered alreadyExists and every post-order step was skipped forever. Now the first successful request records the
// once-only marker and a replay WITHOUT that marker finishes the steps through the recovery path.
describe('a replay of a committed-but-never-finalised order finishes its post-order steps once (F-1)', () => {
  it('replay with alreadyExists and NO marker -> runs the recovery finaliser and writes the marker', async () => {
    mockCreateOrder.mockResolvedValue({
      order: { id: '163', order_number: 'ORD-2026-00140', total_amount: 500, total: 500, status: 'confirmed', subtotal: 0, shippingCharge: 0, codSurcharge: 0, discount: 0, cartItems: [], confirmationToken: 'tok-1' },
      alreadyExists: true, customerId: null,
    })
    wireDb()
    const res = await callOrders()
    expect(res.status).toBe(200)
    expect(mockLogOrderEvent).toHaveBeenCalledWith('163', 'post_order_finalized', 'system', expect.objectContaining({ via: 'timeout_recovery' }))
  })

  it('replay with alreadyExists and the marker present -> nothing runs again', async () => {
    mockCreateOrder.mockResolvedValue({
      order: { id: '163', order_number: 'ORD-2026-00140', total_amount: 500, total: 500, status: 'confirmed', subtotal: 0, shippingCharge: 0, codSurcharge: 0, discount: 0, cartItems: [], confirmationToken: 'tok-1' },
      alreadyExists: true, customerId: null,
    })
    wireDb({ finalised: true })
    const res = await callOrders()
    expect(res.status).toBe(200)
    expect(mockLogOrderEvent).not.toHaveBeenCalledWith('163', 'post_order_finalized', 'system', expect.anything())
  })

  it('a normal first-time order records the marker so a later replay is a no-op', async () => {
    mockCreateOrder.mockResolvedValue({
      order: { id: '164', order_number: 'ORD-2026-00141', total_amount: 500, total: 500, status: 'confirmed', subtotal: 500, shippingCharge: 0, codSurcharge: 0, discount: 0, cartItems: [], confirmationToken: 'tok-2' },
      alreadyExists: false, customerId: null,
    })
    wireDb()
    const res = await callOrders()
    expect(res.status).toBe(201)
    expect(mockLogOrderEvent).toHaveBeenCalledWith('164', 'post_order_finalized', 'system', expect.objectContaining({ via: 'request' }))
  })
})

// COM-1 (Nov 2026 audit): createOrder outlived the request, so its coupon claim may still be unlinked — the 30-minute sweep would
// then free the use. The recovery links it (idempotent helper; see orderService.ensureCouponUsageLinked).
describe('recovered order gets its coupon claim linked (COM-1)', () => {
  it('links the claim for an order placed with a coupon', async () => {
    wireDb({ order: [{ ...COMMITTED_ROW, coupon_discount: 50, created_at: '2026-11-06T10:00:00Z' }] })
    const res = await callOrders({ coupon_code: 'TRACK5' })
    expect(res.status).toBe(200)
    expect(mockEnsureLinked).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 163, couponCode: 'TRACK5', couponDiscount: 50, customerPhone: '9876543210', orderCreatedAt: '2026-11-06T10:00:00Z',
    }))
  })
  it('does nothing for an order without a coupon', async () => {
    wireDb()
    expect((await callOrders()).status).toBe(200)
    expect(mockEnsureLinked).not.toHaveBeenCalled()
  })
})
