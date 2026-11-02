/**
 * POST /api/v1/coupons — a logged-in shopper is recognised from the SESSION (read-only), so the cart can refuse a one-time coupon the
 * account has already used. Nov 2026: the cart page knows nothing else about the shopper, so this is the only way it can.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getToken = vi.fn()
const sbAuth   = vi.fn()
const sbAdmin  = vi.fn()
vi.mock('@/lib/api/serverUtils', () => ({
  checkCsrf: () => null,
  getToken:  (...a: unknown[]) => getToken(...a),
  sbAuth:    (...a: unknown[]) => sbAuth(...a),
  sbAdmin:   (...a: unknown[]) => sbAdmin(...a),
}))
vi.mock('@/lib/api/rateLimitKv', () => ({ checkRateLimitKv: async () => true }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
const validate = vi.fn()
vi.mock('@/lib/services/pricingService', () => ({ validateCouponServer: (...a: unknown[]) => validate(...a) }))

import { POST } from '@/app/api/v1/coupons/route'

const call = (body: object) =>
  POST(new Request('https://www.pahadiroots.com/api/v1/coupons', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never)
const OK = { valid: true, coupon: { code: 'WELCOME50', discount: 50, type: 'flat', oneTimeUse: true } }

beforeEach(() => {
  vi.clearAllMocks()
  validate.mockResolvedValue(OK)
})

describe('coupon pre-check identifies a signed-in customer from the session', () => {
  it('logged in: resolves the customer id from the session and hands it to the check', async () => {
    getToken.mockReturnValue('access-token'); sbAuth.mockResolvedValue({ id: 'auth-user-1' }); sbAdmin.mockResolvedValue([{ id: 26 }])
    const res = await call({ code: 'WELCOME50', subtotal: 700 })
    expect(res.status).toBe(200)
    expect(sbAuth).toHaveBeenCalledWith('/user', null, 'access-token')
    expect(validate).toHaveBeenCalledWith('WELCOME50', 700, expect.objectContaining({ customerId: '26' }))
  })

  it('logged in and the account already used the coupon → 400 with the message the cart shows', async () => {
    getToken.mockReturnValue('t'); sbAuth.mockResolvedValue({ id: 'u1' }); sbAdmin.mockResolvedValue([{ id: 26 }])
    validate.mockResolvedValue({ valid: false, error: 'You have already used this coupon' })
    const res = await call({ code: 'WELCOME50', subtotal: 700 })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'You have already used this coupon' })
  })

  it('guest (no session cookie): nothing is looked up, the check runs without an identity', async () => {
    getToken.mockReturnValue(null)
    await call({ code: 'WELCOME50', subtotal: 700 })
    expect(sbAuth).not.toHaveBeenCalled()
    expect(validate).toHaveBeenCalledWith('WELCOME50', 700, expect.objectContaining({ customerId: null }))
  })

  it('expired / rejected session token: treated as a guest, the request still succeeds', async () => {
    getToken.mockReturnValue('stale'); sbAuth.mockRejectedValue(new Error('401'))
    const res = await call({ code: 'WELCOME50', subtotal: 700 })
    expect(res.status).toBe(200)
    expect(validate).toHaveBeenCalledWith('WELCOME50', 700, expect.objectContaining({ customerId: null }))
  })

  it('valid login but no customer record yet: treated as a guest', async () => {
    getToken.mockReturnValue('t'); sbAuth.mockResolvedValue({ id: 'new-user' }); sbAdmin.mockResolvedValue([])
    await call({ code: 'WELCOME50', subtotal: 700 })
    expect(validate).toHaveBeenCalledWith('WELCOME50', 700, expect.objectContaining({ customerId: null }))
  })

  it('SECURITY: a customerId sent in the request body is ignored — only the session can say who the shopper is', async () => {
    getToken.mockReturnValue(null)
    await call({ code: 'WELCOME50', subtotal: 700, customerId: 99, customer_id: 99 })
    expect(validate).toHaveBeenCalledWith('WELCOME50', 700, expect.objectContaining({ customerId: null }))
  })

  it('the session lookup is read-only and the auth id is URL-encoded in the database filter', async () => {
    getToken.mockReturnValue('t'); sbAuth.mockResolvedValue({ id: 'a&b=c' }); sbAdmin.mockResolvedValue([{ id: 5 }])
    await call({ code: 'WELCOME50', subtotal: 700 })
    const [method, path] = sbAdmin.mock.calls[0] as [string, string]
    expect(method).toBe('GET')
    expect(path).toContain('auth_user_id=eq.a%26b%3Dc')
  })

  it('passes the typed delivery address and phone through for the address rule', async () => {
    getToken.mockReturnValue(null)
    await call({ code: 'WELCOME50', subtotal: 700, phone: '9876543210', pincode: '176082', address: '12 Main Road' })
    expect(validate).toHaveBeenCalledWith('WELCOME50', 700, { phone: '9876543210', customerId: null, pincode: '176082', address: '12 Main Road' })
  })
})
