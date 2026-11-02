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
vi.mock('@/lib/services/orderService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/orderService')>()
  return { ...actual, createOrder: mockCreateOrder, logOrderEvent: mockLogOrderEvent }
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

async function callOrders() {
  const { POST } = await import('@/app/api/v1/orders/route')
  return POST(new Request('http://localhost/api/v1/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1', origin: 'http://localhost:3000' },
    body: JSON.stringify(BODY),
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
  it('awards the COD loyalty points, redeems requested coins, and records the marker BEFORE finalising', async () => {
    wireDb()
    const res = await callOrders()
    expect(res.status).toBe(200)

    expect(mockLogOrderEvent).toHaveBeenCalledWith('163', 'post_order_finalized', 'system', expect.objectContaining({ via: 'timeout_recovery' }))
    // customer 58, order 163, the committed total — through the same helper the normal path uses
    expect(mockAward).toHaveBeenCalledWith('58', '163', 500, expect.any(Object), 'Earned from COD order')
    // marker is written before any of the steps run
    const markerAt = mockLogOrderEvent.mock.invocationCallOrder[0]
    expect(markerAt).toBeLessThan(mockAward.mock.invocationCallOrder[0])
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
