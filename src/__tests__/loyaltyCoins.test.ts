import { describe, it, expect } from 'vitest'
import { coinsForOrderValue, coinsMaxPerOrder, coinStepRupees, coinsPerStep, coinNudge, maxCoinDiscountInr } from '@/lib/loyaltyCoins'

// Owner rule (Nov 2026, second revision): no coins below ₹500; 5 coins for every full ₹500; no per-order limit. Paid on delivery.
// The SQL function delivery_coins_for (db_migration_v36) holds the same formula and gave these exact numbers on production.
describe('coinsForOrderValue', () => {
  it('₹2 → 0, ₹499 → 0, ₹500 → 5, ₹999 → 5, ₹1,000 → 10, ₹2,999 → 25, ₹3,000 → 30, ₹10,000 → 100 (no limit)', () => {
    const cases: Array<[number, number]> = [[2, 0], [499, 0], [500, 5], [999, 5], [1000, 10], [2999, 25], [3000, 30], [10_000, 100]]
    for (const [value, coins] of cases) expect(coinsForOrderValue(value, {}), `₹${value}`).toBe(coins)
  })
  it('all three numbers are admin settings; junk falls back to the defaults', () => {
    expect(coinStepRupees({})).toBe(500)
    expect(coinsPerStep({})).toBe(5)
    expect(coinsMaxPerOrder({})).toBeNull()
    expect(coinStepRupees({ loyalty_coin_step_rupees: '0' })).toBe(500)
    expect(coinStepRupees({ loyalty_coin_step_rupees: 'abc' })).toBe(500)
    expect(coinsForOrderValue(1000, { loyalty_coin_step_rupees: '250', loyalty_coins_per_step: '2' })).toBe(8)
  })
  it('an optional per-order maximum caps it; 0 switches earning off', () => {
    expect(coinsForOrderValue(10_000, { loyalty_coins_per_order: '50' })).toBe(50)
    expect(coinsForOrderValue(1000, { loyalty_coins_per_order: '50' })).toBe(10)
    expect(coinsForOrderValue(5000, { loyalty_coins_per_order: '0' })).toBe(0)
  })
  it('never NaN or negative for a junk order value', () => {
    expect(coinsForOrderValue(Number.NaN, {})).toBe(0)
    expect(coinsForOrderValue(-5, {})).toBe(0)
  })
})

describe('coinNudge — "add ₹X more to earn N coins"', () => {
  it('below ₹500: how much to reach the first 5 coins', () => {
    expect(coinNudge(380, {})).toEqual({ addRupees: 120, coins: 5, more: false })
    expect(coinNudge(0, {})).toEqual({ addRupees: 500, coins: 5, more: false })
  })
  it('above ₹500: how much to reach the next step ("more")', () => {
    expect(coinNudge(750, {})).toEqual({ addRupees: 250, coins: 5, more: true })
    expect(coinNudge(1000, {})).toEqual({ addRupees: 500, coins: 5, more: true })
    expect(coinNudge(999.4, {})).toEqual({ addRupees: 1, coins: 5, more: true })
  })
  it('nothing when coins are off, or when a set maximum is already reached; a partial last step is honest', () => {
    expect(coinNudge(300, { loyalty_coins_per_order: '0' })).toBeNull()
    expect(coinNudge(2000, { loyalty_coins_per_order: '20' })).toBeNull()
    expect(coinNudge(1600, { loyalty_coins_per_order: '18' })).toEqual({ addRupees: 400, coins: 3, more: true })
  })
})

// Owner rule (Nov 2026): coupon + coins together may not exceed loyalty_max_redeem_pct (default 20%) of the subtotal.
describe('maxCoinDiscountInr — coupon and coins share one cap', () => {
  it('₹500 order: 20% = ₹100; with WELCOME50 (₹50) coins can take ₹50; a ₹100+ coupon leaves nothing', () => {
    expect(maxCoinDiscountInr(500, 0, {})).toBe(100)
    expect(maxCoinDiscountInr(500, 50, {})).toBe(50)
    expect(maxCoinDiscountInr(500, 120, {})).toBe(0)
  })
  it('follows the admin percentage; junk input never goes negative or NaN', () => {
    expect(maxCoinDiscountInr(1000, 50, { loyalty_max_redeem_pct: '10' })).toBe(50)
    expect(maxCoinDiscountInr(Number.NaN, 50, {})).toBe(0)
    expect(maxCoinDiscountInr(1000, Number.NaN, {})).toBe(200)
  })
})
