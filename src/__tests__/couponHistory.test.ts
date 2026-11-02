import { describe, it, expect } from 'vitest'
import { countPriorCouponUse, couponReuseProblem, COUPON_USED_BY_PERSON, COUPON_USED_AT_ADDRESS } from '@/lib/couponHistory'

type Row = Record<string, unknown>
function fakeDb(tables: Record<string, Row[]>, fail?: string) {
  return { from: (t: string) => {
    const f: Array<(r: Row) => boolean> = []; let max = Infinity
    const b: any = {
      select: () => b, eq: (c: string, v: unknown) => { f.push(r => r[c] === v); return b },
      in: (c: string, v: unknown[]) => { f.push(r => v.map(String).includes(String(r[c]))); return b },
      limit: (n: number) => { max = n; return b },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(fail === t ? { data: null, error: { message: 'down' } } : { data: (tables[t] ?? []).filter(r => f.every(x => x(r))).slice(0, max), error: null }).then(res, rej),
    }
    return b
  } } as never
}
const order = (id: number, customer_id: number | null, pincode: string, line: string) =>
  ({ id, customer_id, shipping_address: { pincode, address_line1: line } })

describe('countPriorCouponUse', () => {
  it('no uses at all → zero, without reading orders', async () => {
    expect(await countPriorCouponUse(fakeDb({ coupon_usage: [] }), 1, { customerIds: [1] })).toEqual({ byPerson: 0, byAddress: 0 })
  })
  it('only counts uses of THIS coupon', async () => {
    const db = fakeDb({ coupon_usage: [{ id: 1, coupon_id: 2, order_id: 9, customer_id: 1 }], orders: [] })
    expect(await countPriorCouponUse(db, 1, { customerIds: [1] })).toEqual({ byPerson: 0, byAddress: 0 })
  })
  it('person via the usage row (signed-in claim) and via the order (guest claim)', async () => {
    const db = fakeDb({
      coupon_usage: [
        { id: 1, coupon_id: 1, order_id: null, customer_id: 5 },       // signed-in claim still in flight
        { id: 2, coupon_id: 1, order_id: 11,  customer_id: null },      // guest use — only the order links it
      ],
      orders: [order(11, 5, '110001', 'A-5 Connaught Place')],
    })
    expect(await countPriorCouponUse(db, 1, { customerIds: ['5'] })).toEqual({ byPerson: 2, byAddress: 0 })
  })
  it('address: another person, same address → counted by address, not by person', async () => {
    const db = fakeDb({ coupon_usage: [{ id: 1, coupon_id: 1, order_id: 11, customer_id: null }], orders: [order(11, 8, '176082', '12 Main Road')] })
    expect(await countPriorCouponUse(db, 1, { customerIds: [5], pincode: '176082', addressLine: 'Flat 12, Main Rd' })).toEqual({ byPerson: 0, byAddress: 1 })
  })
  it('a person match is not double counted as an address match', async () => {
    const db = fakeDb({ coupon_usage: [{ id: 1, coupon_id: 1, order_id: 11, customer_id: null }], orders: [order(11, 5, '176082', '12 Main Road')] })
    expect(await countPriorCouponUse(db, 1, { customerIds: [5], pincode: '176082', addressLine: '12 Main Road' })).toEqual({ byPerson: 1, byAddress: 0 })
  })
  it('throws when the history cannot be read (the order path must fail closed)', async () => {
    await expect(countPriorCouponUse(fakeDb({ coupon_usage: [] }, 'coupon_usage'), 1, { customerIds: [] })).rejects.toThrow(/history read failed/)
  })
})

describe('couponReuseProblem', () => {
  it('no per-customer limit → never a problem', () => { expect(couponReuseProblem({ byPerson: 9, byAddress: 9 }, null)).toBeNull() })
  it('person message wins, then address, else null; honours the limit', () => {
    expect(couponReuseProblem({ byPerson: 1, byAddress: 1 }, 1)).toBe(COUPON_USED_BY_PERSON)
    expect(couponReuseProblem({ byPerson: 0, byAddress: 1 }, 1)).toBe(COUPON_USED_AT_ADDRESS)
    expect(couponReuseProblem({ byPerson: 1, byAddress: 1 }, 2)).toBeNull()
    expect(couponReuseProblem({ byPerson: 0, byAddress: 0 }, 1)).toBeNull()
  })
})
