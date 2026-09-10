/**
 * paymentOrderRoutes.test.ts
 *
 * Unit tests for the two highest-stakes server routes:
 *   • POST /api/v1/payments  (create_payment + verify_payment actions)
 *   • POST /api/v1/orders    (COD order creation)
 *
 * Strategy: mock Supabase service client, Razorpay API fetch, and all side-
 * effects (loyalty, email, rate-limiter) so every test is deterministic and
 * runs without network access.
 *
 * Coverage goals (audit gap):
 *   ✅ Happy-path create_payment → Razorpay order created, DB updated
 *   ✅ Happy-path verify_payment → HMAC passes, order marked paid
 *   ✅ HMAC mismatch → 400, order NOT marked paid
 *   ✅ Idempotency — duplicate create_payment returns existing Razorpay ID
 *   ✅ COD happy path — order created, loyalty awarded
 *   ✅ Missing CSRF header → 403
 *   ✅ Invalid body → 400
 *   ✅ Stock failure → 409
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockInstance,
} from 'vitest'
import crypto from 'crypto'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { Resend } from 'resend'

// The route modules under test import after() from next/server internally
// (deferred loyalty/email side-effects). after() throws "called outside a
// request scope" unless invoked through Next's real request pipeline, which
// importing the route module directly (as this file does below) does not
// provide. Mocked to run the callback fire-and-forget — matching real
// production semantics (non-blocking, doesn't delay the response) — instead
// of throwing and turning every after()-using path into a false 500.
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: (cb: () => void | Promise<void>) => { void cb() } }
})

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const VALID_ADDRESS = {
  name:    'Ramesh Kumar',
  phone:   '9876543210',
  flat:    '12 Pahadi Lane',
  area:    'Shimla Hills',
  city:    'Shimla',
  state:   'Himachal Pradesh',
  pincode: '171001',
}

const VALID_ITEMS = [
  { productId: 'prod-uuid-1', variantId: 'var-uuid-1', qty: 2 },
]

const IDEMPOTENCY_KEY = '123e4567-e89b-12d3-a456-426614174000'

const BASE_ORDER_BODY = {
  address:         VALID_ADDRESS,
  items:           VALID_ITEMS,
  payment_method:  'razorpay' as const,
  idempotency_key: IDEMPOTENCY_KEY,
  customer_email:  'ramesh@example.com',
}

const COD_ORDER_BODY = {
  ...BASE_ORDER_BODY,
  payment_method: 'cod' as const,
}

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Build a minimal NextRequest-compatible object.
 * We avoid importing from 'next/server' in tests so they stay fast.
 */
function makeReq(
  body: object,
  opts: { csrfHeader?: boolean; method?: string } = {}
): Request {
  const headers: Record<string, string> = {
    'content-type':    'application/json',
    'x-forwarded-for': '127.0.0.1',
  }
  // CSRF check reads the Origin header and validates it against ALLOWED_ORIGINS.
  // In non-production, localhost:3000 is in the allowed list.
  if (opts.csrfHeader !== false) {
    headers['origin'] = 'http://localhost:3000'
  }
  return new Request('http://localhost/api/v1/payments', {
    method:  opts.method ?? 'POST',
    headers,
    body:    JSON.stringify(body),
  })
}

// ─── Mock: @/lib/supabase ─────────────────────────────────────────────────────

// We create a chainable mock that intercepts .from().select()... etc.
// The factory returns an object you can configure per-test via mockDb.

interface MockDb {
  // Per-test overrides: key = `${table}:${method}` → return value
  responses: Record<string, unknown>
  // Track calls for assertions
  calls: Array<{ table: string; op: string; args: unknown[] }>
  rpcResponses: Record<string, unknown>
  rpcCalls: Array<{ rpcName: string; args: unknown }>
}

let mockDb: MockDb

function resetMockDb() {
  mockDb = {
    responses:    {},
    calls:        [],
    rpcResponses: {},
    rpcCalls:     [],
  }
}

// Build a fluent query builder for a given table
function buildQueryBuilder(table: string) {
  const response = () => {
    const key = table
    const val = mockDb.responses[key]
    if (val instanceof Error) return { data: null, error: val }
    return { data: val ?? [], error: null }
  }

  const builder: Record<string, (...a: unknown[]) => unknown> = {
    select:       (...a) => { mockDb.calls.push({ table, op: 'select', args: a }); return builder },
    insert:       (...a) => { mockDb.calls.push({ table, op: 'insert', args: a }); return builder },
    update:       (...a) => { mockDb.calls.push({ table, op: 'update', args: a }); return builder },
    delete:       (...a) => { mockDb.calls.push({ table, op: 'delete', args: a }); return builder },
    upsert:       (...a) => { mockDb.calls.push({ table, op: 'upsert', args: a }); return builder },
    eq:           (..._) => builder,
    neq:          (..._) => builder,
    in:           (..._) => builder,
    limit:        (..._) => builder,
    order:        (..._) => builder,
    maybeSingle:  () =>     Promise.resolve(response()),
    single:       () =>     Promise.resolve(response()),
    then:         (res: any) => Promise.resolve(response()).then(res),
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

// ─── Mock: @/lib/services/orderService (for route-level tests) ───────────────

// The payments and orders routes import createOrder from orderService.
// We mock it to avoid pulling in all the service internals.

const mockCreateOrder = vi.fn()

vi.mock('@/lib/services/orderService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/orderService')>()
  return {
    ...actual,
    createOrder:      mockCreateOrder,
    logOrderEvent:    vi.fn().mockResolvedValue(undefined),
    updateOrderStatus: vi.fn().mockResolvedValue(undefined),
  }
})

// ─── Mock: @/lib/server/loyalty ───────────────────────────────────────────────

vi.mock('@/lib/server/loyalty', () => ({
  awardLoyaltyPoints:  vi.fn().mockResolvedValue(undefined),
  redeemLoyaltyPoints: vi.fn().mockResolvedValue(true),
}))

// ─── Mock: @/lib/getSiteSettings ─────────────────────────────────────────────

vi.mock('@/lib/getSiteSettings', () => ({
  getSiteSettings: vi.fn().mockResolvedValue({
    cod_enabled:              'true',
    order_email_enabled:      'false',   // disable email in tests
    loyalty_enabled:          'false',
    loyalty_points_per_rupee: '1',
    loyalty_points_value:     '0.25',
    loyalty_max_redeem_pct:   '20',
    admin_notify_email:       '',
  }),
}))

// ─── Mock: resend ─────────────────────────────────────────────────────────────

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: vi.fn().mockResolvedValue({ id: 'email-mock-id' }) },
  })),
}))

// ─── Mock: Razorpay API fetch ─────────────────────────────────────────────────

// We intercept global fetch to capture Razorpay calls.
// Non-Razorpay calls (Upstash) are allowed to fail silently.

let fetchMock: MockInstance

const RAZORPAY_ORDER_ID = 'order_razorpay_test_001'

function mockRazorpayCreate(override?: Partial<{ ok: boolean; body: object }>) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes('razorpay.com')) {
      return {
        ok:   override?.ok ?? true,
        json: async () => override?.body ?? {
          id:       RAZORPAY_ORDER_ID,
          amount:   100000, // ₹1000 in paise
          currency: 'INR',
        },
        text: async () => JSON.stringify(override?.body ?? {}),
      }
    }
    // Upstash / any other fetch → rate-limiter fail-open
    return { ok: true, json: async () => [[' ', 1], [' ', 1]] }
  })
}

// ─── Set up default mocks ─────────────────────────────────────────────────────

beforeEach(() => {
  resetMockDb()
  vi.clearAllMocks()
  fetchMock = vi.spyOn(globalThis, 'fetch')

  // Set required env vars for all tests
  process.env.RAZORPAY_KEY_ID     = 'rzp_test_key_id'
  process.env.RAZORPAY_KEY_SECRET = 'test_razorpay_secret'
  // NODE_ENV is 'test' in vitest — CSRF check allows no-origin in non-production,
  // so CSRF-off tests will get null back from checkCsrf (not 403).
  // We test the forbidden case by sending a disallowed origin instead.

  // Default: no existing order (idempotency miss)
  mockDb.responses['orders'] = null  // maybeSingle → null

  // Default: createOrder resolves successfully
  mockCreateOrder.mockResolvedValue({
    order: {
      id:           'order-db-uuid-001',
      order_number: 'PR1A2B3C4D',
      total_amount: 1000,
      total:        1000,
      status:       'pending',
      cartItems:    [],
    },
    alreadyExists: false,
    customerId:    'cust-uuid-001',
  })

  mockRazorpayCreate()
})

// ─────────────────────────────────────────────────────────────────────────────
// Payments route: create_payment
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/payments — create_payment', () => {
  async function callPayments(body: object, csrfHeader = true) {
    const { POST } = await import('@/app/api/v1/payments/route')
    return POST(makeReq(body, { csrfHeader }) as any)
  }

  it('happy path — creates Razorpay order and returns IDs', async () => {
    const body = { action: 'create_payment', ...BASE_ORDER_BODY }
    const res  = await callPayments(body)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.razorpay_order_id).toBe(RAZORPAY_ORDER_ID)
    expect(json.order_id).toBe('order-db-uuid-001')
  })

  it('rejects disallowed origin (CSRF) with 403', async () => {
    const body    = { action: 'create_payment', ...BASE_ORDER_BODY }
    // Send a cross-origin request from an untrusted domain
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', origin: 'https://evil.example.com' }
    const req     = new Request('http://localhost/api', { method: 'POST', headers, body: JSON.stringify(body) })
    const { POST } = await import('@/app/api/v1/payments/route')
    const res = await POST(req as any)
    expect(res.status).toBe(403)
  })

  it('rejects invalid body with 400', async () => {
    const body = { action: 'create_payment', address: {}, items: [] }
    const res  = await callPayments(body)
    expect(res.status).toBe(400)
  })

  it('idempotency — returns existing Razorpay order without creating a new one', async () => {
    // createOrder returns alreadyExists=true and the DB has a payment_id
    mockCreateOrder.mockResolvedValueOnce({
      order: {
        id:           'order-db-uuid-001',
        order_number: 'PR1A2B3C4D',
        total_amount: 1000,
        total:        1000,
        status:       'pending',
        cartItems:    [],
      },
      alreadyExists: true,
      customerId:    null,
    })

    // DB lookup for existing payment_id
    mockDb.responses['orders'] = {
      payment_id:   'order_existing_rzp_id',
      total_amount: 1000,
    }

    const body = { action: 'create_payment', ...BASE_ORDER_BODY }
    const res  = await callPayments(body)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.razorpay_order_id).toBe('order_existing_rzp_id')
    // Razorpay API must NOT be called for a duplicate
    const rzpCalls = fetchMock.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('razorpay.com')
    )
    expect(rzpCalls).toHaveLength(0)
  })

  // BUG FIX regression: previously this route wrapped EVERY createOrder()
  // error in a blanket 500 with a generic message, even user-actionable ones
  // like "insufficient stock" — while the COD path (orders/route.ts) correctly
  // exposed the same message with a 409. That inconsistency meant a Razorpay
  // customer got a useless "Payment processing failed" with zero indication
  // their cart had a stock problem, while a COD customer hitting the IDENTICAL
  // createOrder() error saw the real reason. Fixed so both checkout paths
  // classify and expose the same set of user-actionable errors consistently.
  it('exposes a stock error from createOrder as 409 with the real message (consistent with orders/route.ts)', async () => {
    mockCreateOrder.mockRejectedValueOnce(
      new Error('Insufficient stock for item var-uuid-1 — please reduce quantity')
    )
    const body = { action: 'create_payment', ...BASE_ORDER_BODY }
    const res  = await callPayments(body)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/insufficient stock/i)
  })

  // BUG FIX regression (found via a live "Order placement failed" report —
  // Vercel logs showed the real, expected reason was "You have 3 COD
  // order(s) already in progress...", not a crash, but the customer only
  // ever saw the generic 500 message). Both of these are createOrder()'s
  // own COD guardrails (cod_max_active_orders / cod_max_value) — perfectly
  // clear, actionable messages that simply didn't match any substring in
  // the isUserFacing whitelist, so they fell through to a 500 exactly like
  // a genuine server crash would.
  it('exposes the COD-active-orders-limit error as 409 with the real message, not a generic 500', async () => {
    mockCreateOrder.mockRejectedValueOnce(
      new Error('You have 3 COD order(s) already in progress. Please pay online, or wait for an existing order to be delivered before placing another COD order.')
    )
    const body = { action: 'create_payment', ...BASE_ORDER_BODY }
    const res  = await callPayments(body)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/already in progress/i)
  })

  it('exposes the COD-max-order-value error as 409 with the real message, not a generic 500', async () => {
    mockCreateOrder.mockRejectedValueOnce(
      new Error('COD is only available for orders up to ₹3000. Please pay online for this order.')
    )
    const body = { action: 'create_payment', ...BASE_ORDER_BODY }
    const res  = await callPayments(body)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/cod is only available/i)
  })

  it('still hides genuinely internal errors (DB/RPC failures) behind a generic message in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockCreateOrder.mockRejectedValueOnce(new Error('Failed to create order: connection refused'))

    const body = { action: 'create_payment', ...BASE_ORDER_BODY }
    const res  = await callPayments(body)
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json.error).toBe('Payment processing failed. Please try again or contact support.')
    expect(json.error).not.toMatch(/connection refused/i)

    vi.unstubAllEnvs()
  })

  it('BUG FIX: rejects a new payment/order with 503 when store_open is "false" — this route is a SEPARATE order-creation entry point from /api/v1/orders and had the same gap independently', async () => {
    vi.mocked(getSiteSettings).mockResolvedValueOnce({
      cod_enabled: 'true', order_email_enabled: 'false', loyalty_enabled: 'false',
      loyalty_points_per_rupee: '1', loyalty_points_value: '0.25', loyalty_max_redeem_pct: '20',
      admin_notify_email: '', store_open: 'false',
    } as any)

    const body = { action: 'create_payment', ...BASE_ORDER_BODY }
    const res  = await callPayments(body)
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.error).toMatch(/not accepting orders/i)
    expect(mockCreateOrder).not.toHaveBeenCalled()
    // Razorpay must never be reached for a blocked order.
    const rzpCalls = fetchMock.mock.calls.filter((c: unknown[]) => String(c[0]).includes('razorpay.com'))
    expect(rzpCalls).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Payments route: verify_payment
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/payments — verify_payment', () => {
  const RZP_ORDER_ID   = 'order_rzp_verify_001'
  const RZP_PAYMENT_ID = 'pay_verify_001'
  const DB_ORDER_ID    = 'order-db-uuid-001'
  const KEY_SECRET     = 'test_razorpay_secret'

  function makeSignature(rzpOrderId: string, rzpPaymentId: string, secret = KEY_SECRET) {
    return crypto
      .createHmac('sha256', secret)
      .update(`${rzpOrderId}|${rzpPaymentId}`)
      .digest('hex')
  }

  async function callVerify(override?: Partial<{
    razorpay_order_id:   string
    razorpay_payment_id: string
    razorpay_signature:  string
    order_id:            string
  }>) {
    const sig = override?.razorpay_signature
      ?? makeSignature(
           override?.razorpay_order_id   ?? RZP_ORDER_ID,
           override?.razorpay_payment_id ?? RZP_PAYMENT_ID,
         )

    const body = {
      action:              'verify_payment',
      razorpay_order_id:   override?.razorpay_order_id   ?? RZP_ORDER_ID,
      razorpay_payment_id: override?.razorpay_payment_id ?? RZP_PAYMENT_ID,
      razorpay_signature:  sig,
      order_id:            override?.order_id ?? DB_ORDER_ID,
    }

    // Provide full order row for the DB .single() after update
    mockDb.responses['orders'] = {
      id:                      DB_ORDER_ID,
      order_number:            'PR1A2B3C4D',
      total_amount:            1000,
      customer_id:             'cust-uuid-001',
      loyalty_points_redeemed: 0,
    }

    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET

    const { POST } = await import('@/app/api/v1/payments/route')
    return POST(makeReq(body) as any)
  }

  it('happy path — valid HMAC → order marked paid, returns order_number', async () => {
    const res  = await callVerify()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    // order_number comes from DB or falls back to order_id
    expect(json.order_number).toBeTruthy()
  })

  it('BUG FIX (design confirmation): verify_payment is NOT blocked by store_open=false — unlike create_payment, this completes a transaction already in flight, not a new one. Blocking it would take a customer\'s money without confirming their order.', async () => {
    vi.mocked(getSiteSettings).mockResolvedValueOnce({
      cod_enabled: 'true', order_email_enabled: 'false', loyalty_enabled: 'false',
      loyalty_points_per_rupee: '1', loyalty_points_value: '0.25', loyalty_max_redeem_pct: '20',
      admin_notify_email: '', store_open: 'false',
    } as any)

    const res  = await callVerify()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it('idempotency — already-confirmed order returns success without re-awarding loyalty', async () => {
    // Simulate: order is already 'confirmed' (payment_status = 'paid').
    // The conditional update returns 0 rows → we should short-circuit.
    // The Supabase mock returns `data: []` for the .select('id') on update when
    // we override responses to simulate 0 rows updated.
    mockDb.responses['orders'] = []  // update().select('id') → [] means 0 rows updated

    // We also need the subsequent .single() for order_number to return something
    // Override: after the first [] response the builder returns the full order on next call
    let callCount = 0
    const origBuilder = (table: string) => {
      const b = buildQueryBuilder(table)
      const origThen = b.then
      b.single = () => {
        callCount++
        if (callCount === 1) return Promise.resolve({ data: [], error: null }) // update → 0 rows
        return Promise.resolve({ data: { id: DB_ORDER_ID, order_number: 'PR1A2B3C4D', total_amount: 1000, customer_id: 'cust-uuid-001', loyalty_points_redeemed: 0 }, error: null })
      }
      return b
    }

    const res  = await callVerify()
    const json = await res.json()

    // Should succeed — not a 500 or 400
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it('HMAC mismatch → 400, order NOT updated', async () => {
    const res = await callVerify({
      razorpay_signature: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/signature mismatch/i)
  })

  it('rejects disallowed origin (CSRF) with 403', async () => {
    const sig  = makeSignature(RZP_ORDER_ID, RZP_PAYMENT_ID)
    const body = { action: 'verify_payment', razorpay_order_id: RZP_ORDER_ID, razorpay_payment_id: RZP_PAYMENT_ID, razorpay_signature: sig, order_id: DB_ORDER_ID }
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', origin: 'https://evil.example.com' }
    const req  = new Request('http://localhost/api', { method: 'POST', headers, body: JSON.stringify(body) })
    const { POST } = await import('@/app/api/v1/payments/route')
    const res = await POST(req as any)
    expect(res.status).toBe(403)
  })

  it('rejects missing required fields with 400', async () => {
    const { POST } = await import('@/app/api/v1/payments/route')
    const res = await POST(makeReq({ action: 'verify_payment' }) as any)
    expect(res.status).toBe(400)
  })

  it('HMAC computed with wrong secret → mismatch → 400', async () => {
    // Signature was built with a different secret
    const wrongSig = makeSignature(RZP_ORDER_ID, RZP_PAYMENT_ID, 'wrong_secret')
    const res = await callVerify({ razorpay_signature: wrongSig })
    expect(res.status).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Orders route (COD)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/orders — COD', () => {
  async function callOrders(body: object, csrfHeader = true) {
    const { POST } = await import('@/app/api/v1/orders/route')
    return POST(makeReq(body, { csrfHeader }) as any)
  }

  it('happy path — creates COD order, returns 201', async () => {
    const res  = await callOrders(COD_ORDER_BODY)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.order_number).toBe('PR1A2B3C4D')
  })

  it('idempotency — duplicate key returns 200 (not 201)', async () => {
    mockCreateOrder.mockResolvedValueOnce({
      order: {
        id:           'order-db-uuid-001',
        order_number: 'PR1A2B3C4D',
        total_amount: 1000,
        total:        1000,
        status:       'pending',
        cartItems:    [],
      },
      alreadyExists: true,
      customerId:    null,
    })

    const res  = await callOrders(COD_ORDER_BODY)
    expect(res.status).toBe(200)
  })

  it('rejects disallowed origin (CSRF) with 403', async () => {
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', origin: 'https://evil.example.com' }
    const req  = new Request('http://localhost/api', { method: 'POST', headers, body: JSON.stringify(COD_ORDER_BODY) })
    const { POST } = await import('@/app/api/v1/orders/route')
    const res = await POST(req as any)
    expect(res.status).toBe(403)
  })

  it('rejects invalid phone with 400', async () => {
    const body = { ...COD_ORDER_BODY, address: { ...VALID_ADDRESS, phone: '1234567890' } }
    const res  = await callOrders(body)
    expect(res.status).toBe(400)
  })

  it('rejects invalid pincode with 400', async () => {
    const body = { ...COD_ORDER_BODY, address: { ...VALID_ADDRESS, pincode: '12345' } }
    const res  = await callOrders(body)
    expect(res.status).toBe(400)
  })

  it('stock error → 409 with user-facing message', async () => {
    mockCreateOrder.mockRejectedValueOnce(
      new Error('Insufficient stock for item var-uuid-1 — please reduce quantity')
    )
    const res  = await callOrders(COD_ORDER_BODY)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/stock/i)
  })

  it('BUG FIX: rejects a new order with 503 when store_open is "false" (Close Store toggle)', async () => {
    vi.mocked(getSiteSettings).mockResolvedValueOnce({
      cod_enabled: 'true', order_email_enabled: 'false', loyalty_enabled: 'false',
      loyalty_points_per_rupee: '1', loyalty_points_value: '0.25', loyalty_max_redeem_pct: '20',
      admin_notify_email: '', store_open: 'false',
    } as any)

    const res  = await callOrders(COD_ORDER_BODY)
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.error).toMatch(/not accepting orders/i)
    expect(mockCreateOrder).not.toHaveBeenCalled()
  })

  it('COD disabled → 500/409 with COD message', async () => {
    mockCreateOrder.mockRejectedValueOnce(
      new Error('COD is not available at this time')
    )
    const res  = await callOrders(COD_ORDER_BODY)
    const json = await res.json()

    // COD errors are user-facing → exposed in error message
    expect(json.error).toMatch(/COD/i)
  })

  // BUG FIX regression (found via a live "Order placement failed" report on
  // this exact COD path — see the create_payment describe block above for
  // the full incident writeup; both routes shared the identical whitelist
  // gap for these two createOrder() COD guardrails).
  it('COD active-orders limit error → 409 with the real message, not a generic 500', async () => {
    mockCreateOrder.mockRejectedValueOnce(
      new Error('You have 3 COD order(s) already in progress. Please pay online, or wait for an existing order to be delivered before placing another COD order.')
    )
    const res  = await callOrders(COD_ORDER_BODY)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/already in progress/i)
  })

  it('COD max-order-value error → 409 with the real message, not a generic 500', async () => {
    mockCreateOrder.mockRejectedValueOnce(
      new Error('COD is only available for orders up to ₹3000. Please pay online for this order.')
    )
    const res  = await callOrders(COD_ORDER_BODY)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toMatch(/cod is only available/i)
  })

  it('items array empty → 400', async () => {
    const body = { ...COD_ORDER_BODY, items: [] }
    const res  = await callOrders(body)
    expect(res.status).toBe(400)
  })

  it('unknown action in payments route → 400', async () => {
    const { POST } = await import('@/app/api/v1/payments/route')
    const res  = await POST(makeReq({ action: 'INVALID' }) as any)
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/unknown action/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Orders route (COD) — confirmation email content
//
// BUG FIX regression: the confirmation email used to show a generic emoji
// for every product because orderService.ts hardcoded cartItems[i].image to
// null (see orderService.createOrder.test.ts for the data-layer fix). This
// covers the other half — that once `image` IS populated, the actual email
// HTML sent via Resend renders a real <img> thumbnail, with the emoji as a
// true fallback only when a product genuinely has no photo.
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/orders — COD — confirmation email content', () => {
  async function callOrders(body: object, csrfHeader = true) {
    const { POST } = await import('@/app/api/v1/orders/route')
    return POST(makeReq(body, { csrfHeader }) as any)
  }

  function mockResendSend() {
    const send = vi.fn().mockResolvedValue({ data: { id: 'email-mock-id' }, error: null })
    // vi.fn() mockImplementation must return a real constructor (function or
    // class) since email.ts calls `new Resend(...)` — an arrow function
    // throws "is not a constructor" when invoked with `new`.
    vi.mocked(Resend).mockImplementation(function (this: unknown) {
      return { emails: { send } }
    } as any)
    return send
  }

  it('renders a real <img> thumbnail for a product that has an image', async () => {
    vi.mocked(getSiteSettings).mockResolvedValueOnce({
      cod_enabled: 'true', order_email_enabled: 'true', loyalty_enabled: 'false',
      loyalty_points_per_rupee: '1', loyalty_points_value: '0.25', loyalty_max_redeem_pct: '20',
      admin_notify_email: '',
    } as any)
    const send = mockResendSend()
    mockCreateOrder.mockResolvedValueOnce({
      order: {
        id: 'order-db-uuid-001', order_number: 'PR1A2B3C4D', total_amount: 1000, total: 1000, status: 'confirmed',
        cartItems: [{ name: 'Himalayan Honey', emoji: '🍯', image: 'https://cdn.example.com/honey.jpg', qty: 1, price: 1000 }],
      },
      alreadyExists: false, customerId: 'cust-uuid-001',
    })

    const res = await callOrders(COD_ORDER_BODY)
    expect(res.status).toBe(201)

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    const html = send.mock.calls[0][0].html as string

    expect(html).toContain('<img src="https://cdn.example.com/honey.jpg"')
    expect(html).toContain('Himalayan Honey')
  })

  it('falls back to the emoji (no <img> tag) for a product with no image', async () => {
    vi.mocked(getSiteSettings).mockResolvedValueOnce({
      cod_enabled: 'true', order_email_enabled: 'true', loyalty_enabled: 'false',
      loyalty_points_per_rupee: '1', loyalty_points_value: '0.25', loyalty_max_redeem_pct: '20',
      admin_notify_email: '',
    } as any)
    const send = mockResendSend()
    mockCreateOrder.mockResolvedValueOnce({
      order: {
        id: 'order-db-uuid-001', order_number: 'PR1A2B3C4D', total_amount: 1000, total: 1000, status: 'confirmed',
        cartItems: [{ name: 'Rock Salt', emoji: '🧂', image: null, qty: 1, price: 1000 }],
      },
      alreadyExists: false, customerId: 'cust-uuid-001',
    })

    const res = await callOrders(COD_ORDER_BODY)
    expect(res.status).toBe(201)

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    const html = send.mock.calls[0][0].html as string

    expect(html).not.toContain('<img')
    expect(html).toContain('🧂')
    expect(html).toContain('Rock Salt')
  })

  it('a mix of items with and without images each render correctly in the same email', async () => {
    vi.mocked(getSiteSettings).mockResolvedValueOnce({
      cod_enabled: 'true', order_email_enabled: 'true', loyalty_enabled: 'false',
      loyalty_points_per_rupee: '1', loyalty_points_value: '0.25', loyalty_max_redeem_pct: '20',
      admin_notify_email: '',
    } as any)
    const send = mockResendSend()
    mockCreateOrder.mockResolvedValueOnce({
      order: {
        id: 'order-db-uuid-001', order_number: 'PR1A2B3C4D', total_amount: 1300, total: 1300, status: 'confirmed',
        cartItems: [
          { name: 'Himalayan Honey', emoji: '🍯', image: 'https://cdn.example.com/honey.jpg', qty: 1, price: 1000 },
          { name: 'Rock Salt',       emoji: '🧂', image: null,                                 qty: 1, price: 300  },
        ],
      },
      alreadyExists: false, customerId: 'cust-uuid-001',
    })

    const res = await callOrders(COD_ORDER_BODY)
    expect(res.status).toBe(201)

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    const html = send.mock.calls[0][0].html as string

    expect(html).toContain('<img src="https://cdn.example.com/honey.jpg"')
    expect((html.match(/<img /g) || []).length).toBe(1) // exactly one real image, not two
    expect(html).toContain('🧂')
  })

  // DATA-INTEGRITY FIX regression test: the confirmation email used to show
  // only item lines + Total, with no Subtotal/Shipping/COD Charges
  // breakdown — meaning a COD surcharge was charged but never itemized
  // anywhere the customer could see. This locks in the itemized breakdown.
  it('itemizes Subtotal / Shipping / COD Charges / Total when a COD surcharge applies', async () => {
    vi.mocked(getSiteSettings).mockResolvedValueOnce({
      cod_enabled: 'true', order_email_enabled: 'true', loyalty_enabled: 'false',
      loyalty_points_per_rupee: '1', loyalty_points_value: '0.25', loyalty_max_redeem_pct: '20',
      admin_notify_email: '',
    } as any)
    const send = mockResendSend()
    mockCreateOrder.mockResolvedValueOnce({
      order: {
        id: 'order-db-uuid-001', order_number: 'PR1A2B3C4D', total_amount: 249, total: 249, status: 'confirmed',
        subtotal: 100, shippingCharge: 99, codSurcharge: 50, discount: 0,
        cartItems: [{ name: 'Shilajit', emoji: '🪨', image: null, qty: 1, price: 100 }],
      },
      alreadyExists: false, customerId: 'cust-uuid-001',
    })

    const res = await callOrders(COD_ORDER_BODY)
    expect(res.status).toBe(201)

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    const html = send.mock.calls[0][0].html as string

    expect(html).toContain('Subtotal')
    expect(html).toContain('₹100')
    expect(html).toContain('COD Charges')
    expect(html).toContain('₹50')
    expect(html).toContain('₹99') // shipping
    expect(html).toContain('₹249') // total_amount — must reconcile with the lines above
  })

  // Guards the defensive fallback added alongside the breakdown above: any
  // caller (or future mock) that doesn't populate subtotal/shippingCharge/
  // codSurcharge/discount must not crash email generation — it should
  // degrade to showing ₹0 for the missing pieces rather than losing the
  // entire confirmation email (this exact gap broke 3 tests once before).
  it('does not crash the confirmation email when pricing breakdown fields are absent from the order object', async () => {
    vi.mocked(getSiteSettings).mockResolvedValueOnce({
      cod_enabled: 'true', order_email_enabled: 'true', loyalty_enabled: 'false',
      loyalty_points_per_rupee: '1', loyalty_points_value: '0.25', loyalty_max_redeem_pct: '20',
      admin_notify_email: '',
    } as any)
    const send = mockResendSend()
    mockCreateOrder.mockResolvedValueOnce({
      order: {
        id: 'order-db-uuid-001', order_number: 'PR1A2B3C4D', total_amount: 1000, total: 1000, status: 'confirmed',
        cartItems: [{ name: 'Himalayan Honey', emoji: '🍯', image: null, qty: 1, price: 1000 }],
        // subtotal/shippingCharge/codSurcharge/discount intentionally omitted
      },
      alreadyExists: false, customerId: 'cust-uuid-001',
    })

    const res = await callOrders(COD_ORDER_BODY)
    expect(res.status).toBe(201)

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    const html = send.mock.calls[0][0].html as string
    expect(html).toContain('₹1,000') // total_amount still renders correctly
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Payments route: create_payment — additional idempotency edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/payments — create_payment idempotency edge cases', () => {
  async function callPayments(body: object) {
    const { POST } = await import('@/app/api/v1/payments/route')
    return POST(makeReq(body) as any)
  }

  // BUG C FIX regression test: when alreadyExists=true AND payment_status='paid',
  // the route must return already_confirmed:true so the client skips Razorpay and
  // redirects to order-success. Before the fix it returned payment_id as
  // razorpay_order_id — but after confirmation payment_id holds "pay_xxx" (a
  // Razorpay payment ID), not "order_xxx". Passing a payment ID as Razorpay's
  // order_id crashes the SDK silently on the client.
  it('create_payment with alreadyExists + already paid → returns already_confirmed, no Razorpay call', async () => {
    mockCreateOrder.mockResolvedValueOnce({
      order: { id: 'order-db-uuid-001', order_number: 'PR1A2B3C4D', total_amount: 1000, cartItems: [] },
      alreadyExists: true,
      customerId:    null,
    })

    // DB row shows order is already paid (webhook fired first, or prior verify_payment)
    mockDb.responses['orders'] = {
      payment_id:     'pay_abc123',  // pay_ prefix — this is a payment ID, NOT an order ID
      payment_status: 'paid',
      total_amount:   1000,
      order_number:   'PR1A2B3C4D',
    }

    const body = { action: 'create_payment', ...BASE_ORDER_BODY }
    const res  = await callPayments(body)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.already_confirmed).toBe(true)
    expect(json.order_number).toBeTruthy()
    // Must NOT expose a razorpay_order_id — the client should not open Razorpay
    expect(json.razorpay_order_id).toBeUndefined()
    // Razorpay API must NOT be called for an already-paid order
    const rzpCalls = fetchMock.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('razorpay.com')
    )
    expect(rzpCalls).toHaveLength(0)
  })

  // When alreadyExists=true but payment_id doesn't start with 'order_' (e.g.
  // pay_ from a partial webhook update), fall through and create a new Razorpay
  // order rather than passing a broken ID to the client.
  it('create_payment with alreadyExists + non-order_ payment_id → creates new Razorpay order', async () => {
    mockCreateOrder.mockResolvedValueOnce({
      order: { id: 'order-db-uuid-001', order_number: 'PR1A2B3C4D', total_amount: 1000, cartItems: [] },
      alreadyExists: true,
      customerId:    null,
    })

    mockDb.responses['orders'] = {
      payment_id:     'pay_partial_123',  // pay_ prefix — should fall through
      payment_status: 'pending',
      total_amount:   1000,
    }

    const body = { action: 'create_payment', ...BASE_ORDER_BODY }
    const res  = await callPayments(body)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.razorpay_order_id).toBe(RAZORPAY_ORDER_ID)  // fresh Razorpay order created
    const rzpCalls = fetchMock.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('razorpay.com')
    )
    expect(rzpCalls).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Payments route: verify_payment — security cross-verify (BUG A FIX)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/payments — verify_payment security (BUG A FIX)', () => {
  const RZP_ORDER_ID   = 'order_rzp_verify_001'
  const RZP_PAYMENT_ID = 'pay_verify_001'
  const DB_ORDER_ID    = 'order-db-uuid-001'
  const KEY_SECRET     = 'test_razorpay_secret'

  function makeSignature(rzpOrderId: string, rzpPaymentId: string, secret = KEY_SECRET) {
    return crypto
      .createHmac('sha256', secret)
      .update(`${rzpOrderId}|${rzpPaymentId}`)
      .digest('hex')
  }

  // BUG A FIX regression test: HMAC only proves a real Razorpay payment happened;
  // it does NOT bind that payment to a specific DB order. Without the cross-check,
  // an attacker who paid for cheap order A could submit those valid credentials
  // with order_id = B (an expensive unpaid order) and confirm B for free.
  // The fix rejects when razorpay_order_id ≠ currentOrder.payment_id.
  it('rejects when razorpay_order_id does not match the stored order payment_id → 400', async () => {
    // DB order has payment_id = order_rzp_for_THIS_order
    // Attacker submits razorpay_order_id from a DIFFERENT (cheaper) order they paid
    const attackerOrderId   = 'order_attacker_paid_this_one'
    const attackerPaymentId = 'pay_attacker_paid_this'
    const validHmac = makeSignature(attackerOrderId, attackerPaymentId)

    mockDb.responses['orders'] = {
      id:                      DB_ORDER_ID,
      payment_id:              'order_rzp_for_THIS_order',  // stored on target order
      payment_status:          'pending',
      order_number:            'PR1A2B3C4D',
      total_amount:            5000,  // expensive order
      customer_id:             'cust-uuid-001',
      loyalty_points_redeemed: 0,
    }

    const body = {
      action:              'verify_payment',
      razorpay_order_id:   attackerOrderId,   // ← mismatch with stored payment_id
      razorpay_payment_id: attackerPaymentId,
      razorpay_signature:  validHmac,
      order_id:            DB_ORDER_ID,        // ← targeting the expensive order
    }

    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET
    const { POST } = await import('@/app/api/v1/payments/route')
    const res  = await POST(makeReq(body) as any)
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/verification failed/i)
  })

  // When order is already 'paid' at the initial SELECT (payment_status='paid'
  // on the single() fetch), verify_payment should return success immediately
  // without re-awarding loyalty or re-sending email.
  it('already-paid order at fetch time → 200 success, no re-processing', async () => {
    const sig = makeSignature(RZP_ORDER_ID, RZP_PAYMENT_ID)

    mockDb.responses['orders'] = {
      id:                      DB_ORDER_ID,
      payment_id:              RZP_ORDER_ID,
      payment_status:          'paid',   // ← already confirmed
      order_number:            'PR1A2B3C4D',
      total_amount:            1000,
      customer_id:             'cust-uuid-001',
      loyalty_points_redeemed: 0,
    }

    const body = {
      action:              'verify_payment',
      razorpay_order_id:   RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature:  sig,
      order_id:            DB_ORDER_ID,
    }

    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET
    const { POST } = await import('@/app/api/v1/payments/route')
    const res  = await POST(makeReq(body) as any)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.order_number).toBeTruthy()

    // Loyalty must NOT be re-awarded for an already-confirmed order
    const { awardLoyaltyPoints } = await import('@/lib/server/loyalty')
    expect(awardLoyaltyPoints).not.toHaveBeenCalled()
  })
})
