import { describe, it, expect } from 'vitest'
import { earnCopy } from '@/app/account/_sections/LoyaltySection'

describe('earnCopy', () => {
  it('states the per-₹ rule, the per-order maximum and the delivery / return rule', () => {
    expect(earnCopy(5, 200)).toBe('Earn 1 coin for every ₹200 of your order, up to 5 coins per order, once it is delivered (taken back if you return it)')
    expect(earnCopy(1, 1000)).toContain('for every ₹1,000')
    expect(earnCopy(1, 1000)).toContain('up to 1 coin per order')
  })
  it('falls back to 5 coins / ₹200 for missing or invalid values', () => {
    expect(earnCopy(undefined)).toContain('up to 5 coins')
    expect(earnCopy(undefined)).toContain('₹200')
    expect(earnCopy(Number.NaN, 0)).toContain('₹200')
  })
})
