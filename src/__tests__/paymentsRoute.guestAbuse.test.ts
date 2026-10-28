/**
 * paymentsRoute.guestAbuse.test.ts — AUDIT S1-003, S1-004, S1-002, S1-016(a), S1-005 (track R2b)
 *
 * Route-level contract for POST /api/v1/payments (create_payment) and POST /api/v1/orders:
 *   • S1-003  create_payment is capped per phone and per IP over 10 minutes (429 + Retry-After)
 *   • S1-016a when the limiter cannot decide (KV + DB fallback down) the route answers 503, never
 *             creates an order with no cap
 *   • S1-004  the online path resolves the signed-in customer and passes authenticatedCustomerId
 *   • S1-002  LoyaltyAuthRequiredError → 401 (guest tried to redeem coins)
 *   • S1-005  OrderOutcomeUnknownError → 503 + Retry-After (retry with the same idempotency key)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (cb: () => void | Promise<void>) => { void cb() } }
})

const h = vi.hoisted(() => ({
  createOrder:  vi.fn(),
  strict:       vi.fn(),
  sbAuth:       vi.fn(),
  syncProfile:  vi.fn(),
}))

vi.mock('@/lib/services/orderService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/orderService')>()
  return { ...actual, createOrder: h.createOrder, logOrderEvent: vi.fn().mockResolvedValue(undefined), updateOrderStatus: vi.fn() }
})
vi.mock('@/lib/api/rateLimitKv', () => ({
  checkRateLimitKv:       vi.fn().mockResolvedValue(true),
  checkRateLimitKvStrict: h.strict,
  RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_SEC: 10,
}))
vi.mock('@/lib/api/serverUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/serverUtils')>()
  return { ...actual, sbAuth: h.sbAuth, syncCustomerProfile: h.syncProfile }
})
vi.mock('@/lib/server/loyalty', () => ({ awardLoyaltyPoints: vi.fn().mockResolvedValue(undefined), redeemLoyaltyPoints: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/server/catalogFreshness', () => ({ refreshCatalogIfSoldOut: vi.fn(), refreshCatalogPages: vi.fn() }))
vi.mock('@/lib/server/orderPayments', () => ({
  storeRazorpayOrderId: vi.fn().mockResolvedValue(undefined),
  confirmOrderPayment: vi.fn(), recordCapturedPayment: vi.fn(), runPaidSideEffects: vi.fn(),
}))
vi.mock('@/lib/getSiteSettings', () => {
  const settings = {
    store_open: 'true', cod_enabled: 'true', razorpay_enabled: 'true', order_email_enabled: 'false', loyalty_enabled: 'false',
    loyalty_points_per_rupee: '1', loyalty_points_value: '0.25', loyalty_max_redeem_pct: '20', admin_notify_email: '',
  }
  return { getSiteSettings: vi.fn().mockResolvedValue(settings), getFreshSiteSettings: vi.fn().mockResolvedValue(settings) }
})
vi.mock('@/lib/supabase', () => ({
  supabase: {},
  getServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }), maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    rpc: () => Promise.resolve({ data: true, error: null }),
  }),
}))

const ADDRESS = { name: 'Ramesh Kumar', phone: '9876543210', flat: '12 Lane', area: 'Hills', city: 'Shimla', state: 'Himachal Pradesh', pincode: '171001' }
const BODY = {
  action: 'create_payment', address: ADDRESS, items: [{ productId: 'prod-uuid-1', variantId: 'var-uuid-1', qty: 1 }],
  payment_method: 'razorpay', idempotency_key: '123e4567-e89b-12d3-a456-426614174000', customer_email: 'r@example.com',
}
const COD_BODY = { ...BODY, action: undefined, payment_method: 'cod' }

const CREATED = {
  order: { id: 'order-1', order_number: 'PR1', total_amount: 500, total: 500, status: 'pending', subtotal: 500, shippingCharge: 0, codSurcharge: 0, discount: 0, cartItems: [], confirmationToken: 'tok' },
  alreadyExists: false, customerId: 'cust-1',
}

function makeReq(path: string, body: object, extraHeaders: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', origin: 'http://localhost:3000', ...extraHeaders },
    body: JSON.stringify(body),
  })
}
const callPayments = async (body: object = BODY, headers: Record<string, string> = {}) => {
  const { POST } = await import('@/app/api/v1/payments/route')
  return POST(makeReq('/api/v1/payments', body, headers))
}
const callOrders = async (body: object = COD_BODY, headers: Record<string, string> = {}) => {
  const { POST } = await import('@/app/api/v1/orders/route')
  return POST(makeReq('/api/v1/orders', body, headers))
}

/** Limiter stub: every key allowed except the ones listed. */
function limiter(overrides: Record<string, 'blocked' | 'unavailable'> = {}) {
  h.strict.mockImplementation(async (key: string) => {
    for (const [fragment, outcome] of Object.entries(overrides)) if (key.includes(fragment)) return outcome
    return 'allowed'
  })
}
const keysCalled = () => h.strict.mock.calls.map(c => c[0] as string)

beforeEach(() => {
  vi.clearAllMocks()
  limiter()
  h.createOrder.mockResolvedValue(CREATED)
  h.sbAuth.mockResolvedValue({ id: 'auth-user-1', email: 'r@example.com' })
  h.syncProfile.mockResolvedValue({ id: 'cust-auth-1' })
  process.env.RAZORPAY_KEY_ID = 'rzp_test_x'; process.env.RAZORPAY_KEY_SECRET = 'secret'
  type StubRes = { ok: boolean; status?: number; json: () => Promise<unknown>; text: () => Promise<string> }
  vi.stubGlobal('fetch', vi.fn(async (url: string): Promise<StubRes> => {
    if (String(url).includes('razorpay.com')) return { ok: true, json: async () => ({ id: 'order_rzp_1', amount: 50000, currency: 'INR' }), text: async () => '' }
    return { ok: false, status: 500, json: async () => ({}), text: async () => '' }
  }))
})

// ─────────────────────────────────────────────────────────────────────────────

describe('S1-003 — create_payment per-phone / per-IP 10-minute caps', () => {
  it('more than N create_payment calls for one phone in 10 minutes → 429 with Retry-After, no order created', async () => {
    limiter({ 'payments_phone10m': 'blocked' })
    const res = await callPayments()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('600')
    expect(h.createOrder).not.toHaveBeenCalled()
  })

  it('the phone cap is keyed on the normalised number (format changes share one counter) with a 600 s window', async () => {
    await callPayments({ ...BODY, address: { ...ADDRESS, phone: '9876543210' } })
    const call = h.strict.mock.calls.find(c => String(c[0]).includes('payments_phone10m'))
    expect(call).toEqual(['mw:rl:payments_phone10m:9876543210', expect.any(Number), 600])
    expect(call![1]).toBeGreaterThanOrEqual(3)   // a real customer's retries must still fit
    expect(call![1]).toBeLessThanOrEqual(10)     // … but a few requests cannot lock the catalogue
  })

  it('per-IP 10-minute cap → 429, no order created', async () => {
    limiter({ 'payments_ip10m': 'blocked' })
    const res = await callPayments()
    expect(res.status).toBe(429)
    expect(h.createOrder).not.toHaveBeenCalled()
    expect(keysCalled().some(k => k.startsWith('mw:rl:payments_ip10m:203.0.113.9'))).toBe(true)
  })

  it('all caps allowed → the payment is created as before', async () => {
    const res = await callPayments()
    expect(res.status).toBe(200)
    expect(h.createOrder).toHaveBeenCalledTimes(1)
  })
})

describe('S1-016(a) — limiter unavailable → mutation refused with 503, never allowed', () => {
  it('payments: IP limiter unavailable → 503 + Retry-After, createOrder not called', async () => {
    limiter({ 'payments_ip:': 'unavailable' })
    const res = await callPayments()
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('10')
    expect(h.createOrder).not.toHaveBeenCalled()
  })

  it('payments: phone limiter unavailable → 503', async () => {
    limiter({ 'payments_phone10m': 'unavailable' })
    expect((await callPayments()).status).toBe(503)
    expect(h.createOrder).not.toHaveBeenCalled()
  })

  it('orders: IP limiter unavailable → 503 + Retry-After, createOrder not called', async () => {
    limiter({ 'orders_ip': 'unavailable' })
    const res = await callOrders()
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('10')
    expect(h.createOrder).not.toHaveBeenCalled()
  })

  it('orders: phone limiter unavailable → 503; phone key is normalised', async () => {
    limiter({ 'orders_phone': 'unavailable' })
    expect((await callOrders()).status).toBe(503)
    expect(keysCalled()).toContain('mw:rl:orders_phone:9876543210')
  })
})

describe('S1-004 — the online path resolves the signed-in customer', () => {
  it('with a session cookie, createOrder receives authenticatedCustomerId from syncCustomerProfile', async () => {
    const res = await callPayments(BODY, { cookie: 'pr_token=jwt-abc' })
    expect(res.status).toBe(200)
    expect(h.sbAuth).toHaveBeenCalledWith('/user', null, 'jwt-abc')
    expect(h.createOrder).toHaveBeenCalledWith(expect.objectContaining({ authenticatedCustomerId: 'cust-auth-1', paymentMethod: 'razorpay' }), expect.anything())
  })

  it('without a session, authenticatedCustomerId is null (guest checkout, no auth lookups)', async () => {
    await callPayments()
    expect(h.sbAuth).not.toHaveBeenCalled()
    expect(h.createOrder).toHaveBeenCalledWith(expect.objectContaining({ authenticatedCustomerId: null }), expect.anything())
  })

  it('an expired/invalid session degrades to guest checkout instead of failing the payment', async () => {
    h.sbAuth.mockRejectedValue({ status: 401, message: 'invalid JWT' })
    const res = await callPayments(BODY, { cookie: 'pr_token=stale' })
    expect(res.status).toBe(200)
    expect(h.createOrder).toHaveBeenCalledWith(expect.objectContaining({ authenticatedCustomerId: null }), expect.anything())
  })
})

describe('S1-002 / S1-005 — error mapping', () => {
  it('payments: guest redeeming coins (LoyaltyAuthRequiredError) → 401 with a stable code', async () => {
    const { LoyaltyAuthRequiredError } = await import('@/lib/services/orderService')
    h.createOrder.mockRejectedValue(new LoyaltyAuthRequiredError())
    const res = await callPayments({ ...BODY, loyalty_points_redeemed: 50 })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('LOYALTY_AUTH_REQUIRED')
  })

  it('orders: guest redeeming coins → 401', async () => {
    const { LoyaltyAuthRequiredError } = await import('@/lib/services/orderService')
    h.createOrder.mockRejectedValue(new LoyaltyAuthRequiredError())
    const res = await callOrders({ ...COD_BODY, loyalty_points_redeemed: 50 })
    expect(res.status).toBe(401)
  })

  it('payments: OrderOutcomeUnknownError → 503 + Retry-After (retry with the same key is safe)', async () => {
    const { OrderOutcomeUnknownError } = await import('@/lib/services/orderService')
    h.createOrder.mockRejectedValue(new OrderOutcomeUnknownError(BODY.idempotency_key))
    const res = await callPayments()
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('5')
    expect((await res.json()).code).toBe('ORDER_OUTCOME_UNKNOWN')
  })

  it('orders: OrderOutcomeUnknownError → 503 + Retry-After', async () => {
    const { OrderOutcomeUnknownError } = await import('@/lib/services/orderService')
    h.createOrder.mockRejectedValue(new OrderOutcomeUnknownError(BODY.idempotency_key))
    const res = await callOrders()
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('5')
  })

  it('payments: the sub-₹1 online-total refusal is shown to the customer as 409, not hidden as 500', async () => {
    h.createOrder.mockRejectedValue(new Error('This order total cannot be paid online — please choose Cash on Delivery or adjust your cart.'))
    const res = await callPayments()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/cannot be paid online/)
  })
})
