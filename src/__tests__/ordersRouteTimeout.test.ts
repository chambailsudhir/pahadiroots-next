/**
 * ordersRouteTimeout.test.ts
 *
 * Regression test for a live 504 "Order save failed" report. Vercel logs
 * showed "Task timed out after 15 seconds", and Supabase logs showed a
 * recurring PostgREST "Thread killed by timeout manager" incident (a known
 * resource-tier characteristic of this project's Supabase compute) landing
 * exactly inside that same 15-second window. createOrder() was awaited
 * directly with no per-step timeout, so a single hung Postgres/PostgREST
 * call during one of these periodic hiccups silently consumed the entire
 * request until Vercel's own hard limit killed the function — the customer
 * saw a bare, unexplained 504 after a long silent wait.
 *
 * This covers the fix: createOrder() wrapped in a 10-second timeout, so a
 * hang produces a fast, specific 503 ("please try again in a few seconds")
 * instead of a slow, unexplained 504.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (cb: () => void | Promise<void>) => { void cb() } }
})

const mockCreateOrder = vi.fn()
vi.mock('@/lib/services/orderService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/orderService')>()
  return { ...actual, createOrder: mockCreateOrder, logOrderEvent: vi.fn().mockResolvedValue(undefined) }
})

vi.mock('@/lib/server/loyalty', () => ({
  awardLoyaltyPoints:  vi.fn().mockResolvedValue(undefined),
  redeemLoyaltyPoints: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/getSiteSettings', () => {
  // getFreshSiteSettings (used by the orders/payments routes) delegates to the
  // same mock so existing per-test overrides keep working.
  const getSiteSettings = vi.fn().mockResolvedValue({
    cod_enabled: 'true', order_email_enabled: 'false', loyalty_enabled: 'false',
    loyalty_points_per_rupee: '1', loyalty_points_value: '0.25', loyalty_max_redeem_pct: '20',
    admin_notify_email: '', store_open: 'true',
  })
  return { getSiteSettings, getFreshSiteSettings: (...a: unknown[]) => (getSiteSettings as (...x: unknown[]) => unknown)(...a) }
})

vi.mock('@/lib/api/rateLimitKv', () => ({
  checkRateLimitKv: vi.fn().mockResolvedValue(true), // always allow — not what this test covers
}))

vi.mock('@/lib/supabase', () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
    rpc: () => Promise.resolve({ data: true, error: null }),
  }),
  supabase: {},
}))

const VALID_ADDRESS = {
  name: 'Ramesh Kumar', phone: '9876543210', flat: '12 Pahadi Lane',
  area: 'Shimla Hills', city: 'Shimla', state: 'Himachal Pradesh', pincode: '171001',
}
const COD_ORDER_BODY = {
  address:         VALID_ADDRESS,
  items:           [{ productId: 'prod-uuid-1', variantId: 'var-uuid-1', qty: 2 }],
  payment_method:  'cod' as const,
  idempotency_key: '123e4567-e89b-12d3-a456-426614174000',
  customer_email:  'ramesh@example.com',
}

function callOrders() {
  return import('@/app/api/v1/orders/route').then(({ POST }) => {
    const req = new Request('http://localhost/api/v1/orders', {
      method:  'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1', origin: 'http://localhost:3000' },
      body:    JSON.stringify(COD_ORDER_BODY),
    })
    return POST(req as any)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/v1/orders — timeout guard around createOrder()', () => {
  it('[BUG FIX] returns a fast 503 with a clear retry message when createOrder() hangs past 10s', async () => {
    // Simulates a createOrder() call stuck on a hung Postgres/PostgREST call
    // during one of the recurring resource-tier hiccups — never resolves or
    // rejects on its own.
    mockCreateOrder.mockImplementation(() => new Promise(() => { /* never settles */ }))

    const res  = await callOrders()
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.error).toMatch(/try again/i)
    expect(res.headers.get('Retry-After')).toBe('5')
  }, 15_000) // real 10s internal timeout + margin — exceeds vitest's 5s default

  it('does not time out a normal, fast createOrder() call', async () => {
    mockCreateOrder.mockResolvedValue({
      order: { id: 'order-1', order_number: 'PR1A2B3C4D', total_amount: 1000, total: 1000, status: 'pending', cartItems: [] },
      alreadyExists: false,
      customerId:    'cust-1',
    })

    const res  = await callOrders()
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.order_number).toBe('PR1A2B3C4D')
  })
})
