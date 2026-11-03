import { describe, it, expect } from 'vitest'
import { coinsForOrderValue, coinsPerOrder, coinStepRupees } from '@/lib/loyaltyCoins'

// Owner decision (Nov 2026): 1 coin per ₹200 of order value, at least 1, at most 5 per order, paid on delivery.
describe('coinsForOrderValue', () => {
  it('1 coin per ₹200, minimum 1, maximum 5', () => {
    expect(coinsForOrderValue(50, {})).toBe(1)        // minimum 1
    expect(coinsForOrderValue(199, {})).toBe(1)
    expect(coinsForOrderValue(200, {})).toBe(1)
    expect(coinsForOrderValue(399, {})).toBe(1)
    expect(coinsForOrderValue(400, {})).toBe(2)
    expect(coinsForOrderValue(800, {})).toBe(4)
    expect(coinsForOrderValue(1000, {})).toBe(5)
    expect(coinsForOrderValue(25_000, {})).toBe(5)    // the maximum per order
  })
  it('both numbers are admin settings; a bad value falls back to the defaults; 0 switches earning off', () => {
    expect(coinStepRupees({})).toBe(200)
    expect(coinStepRupees({ loyalty_coin_step_rupees: '100' })).toBe(100)
    expect(coinStepRupees({ loyalty_coin_step_rupees: '0' })).toBe(200)
    expect(coinStepRupees({ loyalty_coin_step_rupees: 'abc' })).toBe(200)
    expect(coinsPerOrder({ loyalty_coins_per_order: '10' })).toBe(10)
    expect(coinsForOrderValue(900, { loyalty_coins_per_order: '10', loyalty_coin_step_rupees: '100' })).toBe(9)
    expect(coinsForOrderValue(5000, { loyalty_coins_per_order: '0' })).toBe(0)
  })
  it('never NaN for a junk order value', () => {
    expect(coinsForOrderValue(Number.NaN, {})).toBe(1)
    expect(coinsForOrderValue(-5, {})).toBe(1)
  })
})
