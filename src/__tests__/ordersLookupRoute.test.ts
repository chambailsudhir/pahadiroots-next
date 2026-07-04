/**
 * ordersLookupRoute.test.ts
 *
 * GET /api/v1/orders/lookup replaces the dead /api/admin-api call that
 * order-success/page.tsx used to make (see db_migration_v6_order_confirmation_token.sql
 * and the route file itself for the full incident/design writeup).
 *
 * This is the single most security-sensitive new endpoint in this feature —
 * it's a PUBLIC, unauthenticated-by-default route that returns order data
 * (address, phone, items). Every test here is about proving the auth model
 * actually holds, not just that happy-path data comes back correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  sbAdmin:             vi.fn(),
  getToken:            vi.fn(),
  tryRefresh:           vi.fn(),
  sbAuth:              vi.fn(),
  syncCustomerProfile: vi.fn(),
  applyNewCookies:     vi.fn(),
  checkRateLimitKv:    vi.fn(),
}))

vi.mock('@/lib/api/serverUtils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    ok:   (data: unknown) => NextResponse.json(data),
    fail: (status: number, msg: string) => NextResponse.json({ error: msg }, { status }),
    sbAdmin:             mocks.sbAdmin,
    getToken:            mocks.getToken,
    tryRefresh:          mocks.tryRefresh,
    sbAuth:              mocks.sbAuth,
    syncCustomerProfile: mocks.syncCustomerProfile,
    applyNewCookies:     mocks.applyNewCookies,
  }
})

vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: mocks.checkRateLimitKv }))

function makeRequest(query: string) {
  return new NextRequest(`https://pahadiroots.com/api/v1/orders/lookup${query}`, {
    headers: { 'x-forwarded-for': '1.2.3.4' },
  })
}

const VALID_TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const SAMPLE_ORDER_ROW = {
  order_number: 'PRMR4OEQ',
  order_status: 'confirmed',
  payment_status: 'cod_pending',
  payment_method: 'cod',
  total_amount: 262,
  subtotal: 235,
  coupon_discount: 0,
  shipping_charge: 0,
  tax: 27,
  created_at: '2026-07-01T10:00:00Z',
  tracking_number: null,
  courier: null,
  customer_id: 'cust-1',
  shipping_address: { address_line1: 'Flat 4B, Green Valley', city: 'Dehradun', state: 'Uttarakhand', pincode: '248001' },
  order_items: [
    { quantity: 1, price_at_time: 143, product_name_snapshot: null, variant_value_snapshot: '500ml', product_id: 'p1', products: { name: 'Mustard Oil', emoji: '🫒', image_url: 'oil.jpg' } },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkRateLimitKv.mockResolvedValue(true)
  mocks.getToken.mockReturnValue(null)
  mocks.tryRefresh.mockResolvedValue(null)
})

describe('GET /api/v1/orders/lookup — input validation', () => {
  it('400s when order_number is missing', async () => {
    const { GET } = await import('@/app/api/v1/orders/lookup/route')
    const res = await GET(makeRequest('?token=' + VALID_TOKEN))
    expect(res.status).toBe(400)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })

  it('404s (not 500) for an order_number containing characters outside the expected format, without ever querying the DB', async () => {
    const { GET } = await import('@/app/api/v1/orders/lookup/route')
    const res = await GET(makeRequest("?order_number=1' OR '1'='1&token=" + VALID_TOKEN))
    expect(res.status).toBe(404)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/orders/lookup — rate limiting', () => {
  it('429s when the per-IP rate limit is exceeded, before touching the DB', async () => {
    mocks.checkRateLimitKv.mockResolvedValue(false)
    const { GET } = await import('@/app/api/v1/orders/lookup/route')
    const res = await GET(makeRequest('?order_number=PRMR4OEQ&token=' + VALID_TOKEN))
    expect(res.status).toBe(429)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/orders/lookup — guest token auth', () => {
  it('returns the order when order_number AND token both match the same row', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([SAMPLE_ORDER_ROW]) // order+items query
    mocks.sbAdmin.mockResolvedValueOnce([{ first_name: 'Sudhir', last_name: 'Chambail', phone: '9717255662' }]) // customer query

    const { GET } = await import('@/app/api/v1/orders/lookup/route')
    const res  = await GET(makeRequest('?order_number=PRMR4OEQ&token=' + VALID_TOKEN))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.order.order_number).toBe('PRMR4OEQ')
    expect(body.order.items).toHaveLength(1)
    expect(body.order.items[0]).toMatchObject({ name: 'Mustard Oil', qty: 1, price: 143 })
    expect(body.order.customer_name).toBe('Sudhir Chambail')
    expect(body.order.delivery_address).toBe('Flat 4B, Green Valley')
  })

  it('never returns internal-only fields (customer_id, confirmation_token, payment_id)', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([SAMPLE_ORDER_ROW])
    mocks.sbAdmin.mockResolvedValueOnce([])

    const { GET } = await import('@/app/api/v1/orders/lookup/route')
    const res  = await GET(makeRequest('?order_number=PRMR4OEQ&token=' + VALID_TOKEN))
    const body = await res.json()

    expect(body.order.customer_id).toBeUndefined()
    expect(body.order.confirmation_token).toBeUndefined()
    expect(body.order.payment_id).toBeUndefined()
  })

  it('404s uniformly when the token does not match — does NOT distinguish "wrong token" from "order does not exist"', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([]) // token query finds nothing
    // No session either — getToken/tryRefresh already return null by default.

    const { GET } = await import('@/app/api/v1/orders/lookup/route')
    const res = await GET(makeRequest('?order_number=PRMR4OEQ&token=' + VALID_TOKEN))
    expect(res.status).toBe(404)
  })

  it('rejects a malformed token (not a UUID) without ever querying the DB for it', async () => {
    const { GET } = await import('@/app/api/v1/orders/lookup/route')
    const res = await GET(makeRequest('?order_number=PRMR4OEQ&token=not-a-real-token'))
    expect(res.status).toBe(404)
    expect(mocks.sbAdmin).not.toHaveBeenCalled()
  })

  it('never leaks one order by presenting a token that is only valid for a different order_number', async () => {
    // The mocked sbAdmin call receives BOTH order_number and token in the
    // filter string — assert both are present together, proving the query
    // can't match token alone against any row.
    mocks.sbAdmin.mockResolvedValueOnce([])
    const { GET } = await import('@/app/api/v1/orders/lookup/route')
    await GET(makeRequest('?order_number=SOMEOTHERORD&token=' + VALID_TOKEN))

    const [, path] = mocks.sbAdmin.mock.calls[0]
    expect(path).toContain('order_number=eq.SOMEOTHERORD')
    expect(path).toContain(`confirmation_token=eq.${VALID_TOKEN}`)
  })
})

describe('GET /api/v1/orders/lookup — logged-in session auth (no token needed)', () => {
  it("returns the order when the session's customer_id matches, even with no token", async () => {
    mocks.getToken.mockReturnValue('valid-access-token')
    mocks.sbAuth.mockResolvedValue({ id: 'auth-user-1' })
    mocks.syncCustomerProfile.mockResolvedValue({ id: 'cust-1' })
    mocks.sbAdmin.mockResolvedValueOnce([SAMPLE_ORDER_ROW])
    mocks.sbAdmin.mockResolvedValueOnce([])

    const { GET } = await import('@/app/api/v1/orders/lookup/route')
    const res  = await GET(makeRequest('?order_number=PRMR4OEQ'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.order.order_number).toBe('PRMR4OEQ')

    // IDOR guard: the session's own profile id must be in the filter.
    const [, path] = mocks.sbAdmin.mock.calls[0]
    expect(path).toContain('customer_id=eq.cust-1')
  })

  it("404s when logged in but the order belongs to a DIFFERENT customer (IDOR guard)", async () => {
    mocks.getToken.mockReturnValue('valid-access-token')
    mocks.sbAuth.mockResolvedValue({ id: 'auth-user-1' })
    mocks.syncCustomerProfile.mockResolvedValue({ id: 'cust-1' })
    // Query correctly scoped to cust-1, but this order belongs to someone
    // else — the (mocked) DB legitimately returns no rows.
    mocks.sbAdmin.mockResolvedValueOnce([])

    const { GET } = await import('@/app/api/v1/orders/lookup/route')
    const res = await GET(makeRequest('?order_number=SOMEONEELSES'))
    expect(res.status).toBe(404)
  })

  it('falls through to session auth when a token is present but wrong, for a logged-in user', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([]) // token path: no match
    mocks.getToken.mockReturnValue('valid-access-token')
    mocks.sbAuth.mockResolvedValue({ id: 'auth-user-1' })
    mocks.syncCustomerProfile.mockResolvedValue({ id: 'cust-1' })
    mocks.sbAdmin.mockResolvedValueOnce([SAMPLE_ORDER_ROW]) // session path: match
    mocks.sbAdmin.mockResolvedValueOnce([])                 // customer fetch

    const { GET } = await import('@/app/api/v1/orders/lookup/route')
    const res = await GET(makeRequest('?order_number=PRMR4OEQ&token=' + VALID_TOKEN))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/v1/orders/lookup — graceful degradation', () => {
  it('still returns the order (without customer_name) if the customer sub-fetch fails', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([SAMPLE_ORDER_ROW])
    mocks.sbAdmin.mockRejectedValueOnce(new Error('customers table timeout'))

    const { GET } = await import('@/app/api/v1/orders/lookup/route')
    const res  = await GET(makeRequest('?order_number=PRMR4OEQ&token=' + VALID_TOKEN))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.order.customer_name).toBeUndefined()
    expect(body.order.items).toHaveLength(1) // the important part still worked
  })

  it('returns 404 (not 500) when neither auth path is present at all', async () => {
    const { GET } = await import('@/app/api/v1/orders/lookup/route')
    const res = await GET(makeRequest('?order_number=PRMR4OEQ'))
    expect(res.status).toBe(404)
  })
})
