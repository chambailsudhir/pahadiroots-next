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

/** Path-aware sbAdmin: the order row, the once-only marker and the order items. The marker INSERT behaves like the v33 unique
 *  index: the first claim per order wins, every later one fails with 409 / 23505. `finalised` = a marker already exists. */
let markers = new Set<string>()
function wireDb(opts: { order?: unknown[]; finalised?: boolean } = {}) {
  markers = new Set(opts.finalised ? ['163', '164'] : [])
  mockSbAdmin.mockImplementation(async (m: string, path: string, body?: { order_id?: string; event?: string }) => {
    if (path.startsWith('/rest/v1/orders?idempotency_key=')) return opts.order ?? [COMMITTED_ROW]
    if (m === 'POST' && path === '/rest/v1/order_events' && body?.event === 'post_order_finalized') {
      await Promise.resolve()   // let a concurrent request interleave, as two serverless invocations would
      const id = String(body.order_id)
      if (markers.has(id)) throw { status: 409, message: 'duplicate key value violates unique constraint (23505)' }
      markers.add(id)
      return null
    }
    if (path.startsWith('/rest/v1/order_items?')) return [{ quantity: 2, price_at_time: 250, product_name_snapshot: 'Wild Honey', variant_value_snapshot: '500g', products: { emoji: '🍯', image_url: null } }]
    return []
  })
}
const markerClaims = (orderId: string) => mockSbAdmin.mock.calls.filter(([m, p, b]) =>
  m === 'POST' && p === '/rest/v1/order_events' && (b as { event?: string; order_id?: string })?.event === 'post_order_finalized'
  && String((b as { order_id?: string }).order_id) === orderId)
const claimedVia = (orderId: string, via: string) => markerClaims(orderId).some(([, , b]) => (b as { metadata?: { via?: string } }).metadata?.via === via)
const recoveryRuns = () => mockSbAdmin.mock.calls.filter(([m, p]) => m === 'GET' && String(p).startsWith('/rest/v1/order_items?')).length

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

    expect(claimedVia('163', 'timeout_recovery')).toBe(true)
    // Coins are paid on DELIVERY by a database trigger (db_migration_v28), never at placement.
    expect(mockAward).not.toHaveBeenCalled()
  })

  it('does NOT run them again when the marker already exists (customer retried and timed out again)', async () => {
    wireDb({ finalised: true })
    const res = await callOrders()

    expect(res.status).toBe(200)                       // the customer still gets their order
    expect(mockAward).not.toHaveBeenCalled()
    expect(recoveryRuns()).toBe(0)                     // the claim lost (409): no post-order step ran again
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
    expect(claimedVia('163', 'timeout_recovery')).toBe(true)
    expect(recoveryRuns()).toBe(1)
  })

  it('replay with alreadyExists and the marker present -> nothing runs again', async () => {
    mockCreateOrder.mockResolvedValue({
      order: { id: '163', order_number: 'ORD-2026-00140', total_amount: 500, total: 500, status: 'confirmed', subtotal: 0, shippingCharge: 0, codSurcharge: 0, discount: 0, cartItems: [], confirmationToken: 'tok-1' },
      alreadyExists: true, customerId: null,
    })
    wireDb({ finalised: true })
    const res = await callOrders()
    expect(res.status).toBe(200)
    expect(recoveryRuns()).toBe(0)
  })

  it('a normal first-time order records the marker so a later replay is a no-op', async () => {
    mockCreateOrder.mockResolvedValue({
      order: { id: '164', order_number: 'ORD-2026-00141', total_amount: 500, total: 500, status: 'confirmed', subtotal: 500, shippingCharge: 0, codSurcharge: 0, discount: 0, cartItems: [], confirmationToken: 'tok-2' },
      alreadyExists: false, customerId: null,
    })
    wireDb()
    const res = await callOrders()
    expect(res.status).toBe(201)
    expect(claimedVia('164', 'request')).toBe(true)
  })

  // Nov 2026 verification: the marker check was a GET and the write a separate INSERT, so two concurrent replays could both
  // pass the check and both send the e-mails. The INSERT is now the claim (v33 unique index).
  it('two CONCURRENT replays of the same unfinished order run the post-order steps exactly once', async () => {
    mockCreateOrder.mockResolvedValue({
      order: { id: '163', order_number: 'ORD-2026-00140', total_amount: 500, total: 500, status: 'confirmed', subtotal: 0, shippingCharge: 0, codSurcharge: 0, discount: 0, cartItems: [], confirmationToken: 'tok-1' },
      alreadyExists: true, customerId: null,
    })
    wireDb()
    const [a, b] = await Promise.all([callOrders(), callOrders()])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(markerClaims('163')).toHaveLength(2)    // both tried
    expect(recoveryRuns()).toBe(1)                 // only the winner finalised
  })

  it('a first-time order whose marker another request already claimed does not finalise twice', async () => {
    mockCreateOrder.mockResolvedValue({
      order: { id: '164', order_number: 'ORD-2026-00141', total_amount: 500, total: 500, status: 'confirmed', subtotal: 500, shippingCharge: 0, codSurcharge: 0, discount: 0, cartItems: [], confirmationToken: 'tok-2', loyaltyPointsRedeemed: 5 },
      alreadyExists: false, customerId: '58',
    })
    wireDb({ finalised: true })
    const res = await callOrders()
    expect(res.status).toBe(201)
    expect(mockRedeem).not.toHaveBeenCalled()
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

// R3-1 (Nov 2026): a request killed between claiming the marker and redeeming coins left the coins un-deducted forever.
describe('coins on a recovered COD order are always settled, even when the marker is already taken (R3-1)', () => {
  const WITH_COINS = { ...COMMITTED_ROW, loyalty_points_redeemed: 40 }
  it('marker already claimed by a request that died -> the replay still redeems the coins (idempotent RPC), once', async () => {
    wireDb({ order: [WITH_COINS], finalised: true })
    const res = await callOrders()
    expect(res.status).toBe(200)
    expect(mockRedeem).toHaveBeenCalledWith('58', '163', 40)
    expect(recoveryRuns()).toBe(0)                   // e-mails etc. are still not re-run
  })
  it('a failed redemption on recovery is flagged for ops', async () => {
    wireDb({ order: [WITH_COINS], finalised: true })
    mockRedeem.mockResolvedValueOnce(false)
    await callOrders()
    expect(mockLogOrderEvent).toHaveBeenCalledWith('163', 'loyalty_redeem_failed', 'system', expect.objectContaining({ points: 40, via: 'recovery' }))
  })
  it('an order without coins never calls the redeem RPC', async () => {
    wireDb({ finalised: true })
    await callOrders()
    expect(mockRedeem).not.toHaveBeenCalled()
  })
})
