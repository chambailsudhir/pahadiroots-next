/**
 * validateCouponUserLimit.test.ts
 *
 * "One person / one address, one time only" for per-customer coupons (coupons.user_limit) — the early-warning check the cart and
 * checkout call (validateCouponServer). Uses a small in-memory fake of the supabase query builder so the rules are tested against
 * realistic data instead of against the exact shape of each query.
 *
 * The case that mattered (Nov 2026): a GUEST's earlier use is stored in coupon_usage with customer_id NULL (a typed phone number
 * is not proof of identity), so the old check — which looked for rows by customer_id — could never see it and the guest could use a
 * one-time coupon again and again. History is now rebuilt from the ORDER behind each use, and the delivery ADDRESS counts too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
let failTable: string | null = null

function from(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let max = Infinity
  const b: any = {
    select: () => b,
    eq:  (c: string, v: unknown)   => { filters.push(r => r[c] === v); return b },
    neq: (c: string, v: unknown)   => { filters.push(r => r[c] !== v); return b },
    in:  (c: string, v: unknown[]) => { filters.push(r => v.map(String).includes(String(r[c]))); return b },
    limit: (n: number) => { max = n; return b },
    single:      () => { const x = run(); return Promise.resolve({ data: x[0] ?? null, error: x[0] ? null : { message: 'no rows' } }) },
    maybeSingle: () => { const x = run(); return Promise.resolve({ data: x[0] ?? null, error: null }) },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (failTable === table) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej)
      return Promise.resolve({ data: run(), error: null }).then(res, rej)
    },
  }
  const run = () => (db[table] ?? []).filter(r => filters.every(f => f(r))).slice(0, max)
  return b
}

vi.mock('@/lib/supabase', () => ({
  supabase:         { from: vi.fn() },
  getServiceClient: vi.fn(() => ({ from })),
}))

import { validateCouponServer } from '@/lib/services/pricingService'

const coupon = (over: Row = {}): Row => ({
  id: 1, code: 'WELCOME50', type: 'flat', value: 50, max_uses: 100, uses_count: 1, min_order: null, expires_at: null,
  max_discount: null, user_limit: 1, first_order_only: false, is_active: true, ...over,
})
const ADDR = { pincode: '176082', address: '12 Main Road, Near Hospital' }

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  failTable = null
  db.coupons = [coupon()]
  db.customers = [
    { id: 42, normalized_phone: '9876543210' },
    { id: 77, normalized_phone: '9000000001' },
  ]
  // The earlier use: a GUEST order (usage row has NO customer_id), placed by customer 42 at 12 Main Road.
  db.coupon_usage = [{ id: 1, coupon_id: 1, order_id: 500, customer_id: null }]
  db.orders = [{
    id: 500, customer_id: 42, payment_status: 'cod_pending', order_status: 'confirmed',
    shipping_address: { pincode: '176082', address_line1: '12 Main Road, Near Hospital', city: 'Kangra', state: 'Himachal Pradesh' },
  }]
})

describe('validateCouponServer — one person / one address, one time only', () => {
  it('guest on the cart page (nothing known yet): cannot be checked, so the coupon is accepted and flagged one-time', async () => {
    const r = await validateCouponServer('WELCOME50', 700)
    expect(r.valid).toBe(true)
    expect(r.coupon?.oneTimeUse).toBe(true)
  })

  it('a coupon with no per-customer limit is never refused on history', async () => {
    db.coupons = [coupon({ user_limit: null })]
    const r = await validateCouponServer('WELCOME50', 700, { phone: '9876543210', ...ADDR })
    expect(r.valid).toBe(true)
    expect(r.coupon?.oneTimeUse).toBeUndefined()
  })

  it('THE BUG: a guest who already used it is refused by PHONE even though their usage row has no customer_id', async () => {
    const r = await validateCouponServer('WELCOME50', 700, { phone: '9876543210' })
    expect(r).toMatchObject({ valid: false, error: 'You have already used this coupon' })
  })

  it('refuses a signed-in account that has used it (identified from the session, so the CART page can refuse it)', async () => {
    db.coupon_usage = [{ id: 1, coupon_id: 1, order_id: null, customer_id: 42 }]
    db.orders = []
    const r = await validateCouponServer('WELCOME50', 700, { customerId: 42 })
    expect(r).toMatchObject({ valid: false, error: 'You have already used this coupon' })
  })

  it('refuses a DIFFERENT person / phone at the SAME address (re-typed differently)', async () => {
    const r = await validateCouponServer('WELCOME50', 700, { phone: '9000000001', pincode: '176082', address: 'Flat No. 12, Main Rd' })
    expect(r).toMatchObject({ valid: false, error: 'This coupon has already been used for this delivery address' })
  })

  it('allows a different person at a different address', async () => {
    const r = await validateCouponServer('WELCOME50', 700, { phone: '9000000001', pincode: '171001', address: '4 Mall Road, Shimla' })
    expect(r.valid).toBe(true)
  })

  it('allows a neighbour: same PIN and street but a different house number', async () => {
    const r = await validateCouponServer('WELCOME50', 700, { phone: '9000000001', pincode: '176082', address: '14 Main Road, Near Hospital' })
    expect(r.valid).toBe(true)
  })

  it('a brand-new customer with a new address is valid', async () => {
    const r = await validateCouponServer('WELCOME50', 700, { phone: '9111111111', pincode: '110001', address: 'A-5 Connaught Place' })
    expect(r.valid).toBe(true)
  })

  it('normalises +91 / punctuation in the phone before matching', async () => {
    const r = await validateCouponServer('WELCOME50', 700, { phone: '+91 98765-43210' })
    expect(r.valid).toBe(false)
  })

  it('a bare string is still accepted as the phone (legacy call shape)', async () => {
    expect((await validateCouponServer('WELCOME50', 700, '9876543210')).valid).toBe(false)
  })

  it('honours a higher limit: used once of three is still valid', async () => {
    db.coupons = [coupon({ user_limit: 3 })]
    expect((await validateCouponServer('WELCOME50', 700, { phone: '9876543210', ...ADDR })).valid).toBe(true)
  })

  it('first-order-only: a customer with an earlier non-cancelled order is refused', async () => {
    db.coupons = [coupon({ user_limit: null, first_order_only: true })]
    const r = await validateCouponServer('WELCOME50', 700, { phone: '9876543210' })
    expect(r).toMatchObject({ valid: false, error: 'This coupon is valid on your first order only' })
  })

  it('first-order-only: a cancelled earlier order does not count', async () => {
    db.coupons = [coupon({ user_limit: null, first_order_only: true })]
    ;(db.orders[0] as Row).order_status = 'cancelled'
    expect((await validateCouponServer('WELCOME50', 700, { phone: '9876543210' })).valid).toBe(true)
  })

  it('fails OPEN if the history cannot be read (cart must not block); the order path re-checks and fails closed', async () => {
    failTable = 'coupon_usage'
    expect((await validateCouponServer('WELCOME50', 700, { phone: '9876543210' })).valid).toBe(true)
  })

  // Category-limited coupons are previewed on the eligible lines only (as createOrder does), not the whole cart.
  describe('category_ids', () => {
    beforeEach(() => {
      db.coupon_usage = []; db.orders = []
      db.products = [{ id: 1, category_id: 10 }, { id: 2, category_id: 20 }]
    })
    it('percent coupon discounts only the lines in the allowed category', async () => {
      db.coupons = [coupon({ type: 'percent', value: 10, user_limit: null, category_ids: [10] })]
      const r = await validateCouponServer('WELCOME50', 1000, { lines: [{ productId: 1, amount: 400 }, { productId: 2, amount: 600 }] })
      expect(r.valid).toBe(true)
      expect(r.coupon?.discount).toBe(40)   // 10% of ₹400, not of ₹1000
    })
    it('refuses when no line is in an allowed category', async () => {
      db.coupons = [coupon({ type: 'percent', value: 10, user_limit: null, category_ids: [10] })]
      const r = await validateCouponServer('WELCOME50', 600, { lines: [{ productId: 2, amount: 600 }] })
      expect(r).toMatchObject({ valid: false, error: 'This coupon does not apply to the items in your cart' })
    })
    it('without lines (old client) the whole-cart preview is used; createOrder stays authoritative', async () => {
      db.coupons = [coupon({ type: 'percent', value: 10, user_limit: null, category_ids: [10] })]
      expect((await validateCouponServer('WELCOME50', 1000)).coupon?.discount).toBe(100)
    })
  })
})
