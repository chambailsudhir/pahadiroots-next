import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ sbAdmin: vi.fn() }))
vi.mock('@/lib/api/serverUtils', async (orig) => {
  const actual = await orig<typeof import('@/lib/api/serverUtils')>()
  return {
    ...actual,
    checkCsrf: () => null, getToken: () => 'jwt', tryRefresh: vi.fn(async () => null),
    sbAuth: vi.fn(async () => ({ id: 'u1' })), syncCustomerProfile: vi.fn(async () => ({ id: 5 })), sbAdmin: h.sbAdmin,
  }
})

// Owner rule (Nov 2026): the coupon and the coins together may not exceed loyalty_max_redeem_pct of the subtotal.
describe('POST /api/v1/loyalty validate — coupon and coins share the cap', () => {
  beforeEach(() => {
    h.sbAdmin.mockImplementation(async (_m: string, path: string) => path.includes('/customers?')
      ? [{ loyalty_points: 1000 }]
      : [{ key: 'loyalty_points_value', value: '1' }, { key: 'loyalty_max_redeem_pct', value: '20' }, { key: 'loyalty_min_redeem', value: '10' }])
  })
  const validate = async (body: Record<string, unknown>) => (await import('@/app/api/v1/loyalty/route')).POST(new NextRequest('https://www.pahadiroots.com/api/v1/loyalty', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://www.pahadiroots.com' }, body: JSON.stringify({ action: 'validate', ...body }),
  }))
  it('₹500 order without a coupon: 100 coins (₹100 = 20%) are fine', async () => {
    expect((await validate({ points_to_redeem: 100, order_subtotal: 500 })).status).toBe(200)
  })
  it('₹500 order with a ₹50 coupon: 100 coins are refused, 50 are fine, and the message explains why', async () => {
    const res = await validate({ points_to_redeem: 100, order_subtotal: 500, coupon_discount: 50 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/with your coupon, coins can take off at most ₹50/i)
    expect((await validate({ points_to_redeem: 50, order_subtotal: 500, coupon_discount: 50 })).status).toBe(200)
  })
})
