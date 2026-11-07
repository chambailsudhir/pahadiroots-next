import { describe, it, expect } from 'vitest'
import { earnCopy } from '@/app/account/_sections/LoyaltySection'

// Owner rule (Nov 2026, second revision): 5 coins for every full ₹500, nothing below ₹500, no per-order limit.
describe('earnCopy', () => {
  it('states the per-₹500 rule, that smaller orders earn none, and the delivery / return rule', () => {
    expect(earnCopy(5, 500)).toBe('Earn 5 coins for every ₹500 of your order, once it is delivered (orders below ₹500 earn none; coins are taken back if you return the order). Coins expire 4 months after you earn them.')
    expect(earnCopy(1, 1000)).toContain('Earn 1 coin for every ₹1,000')
  })
  it('mentions a per-order limit only when one is set', () => {
    expect(earnCopy(5, 500, null)).not.toContain('up to')
    expect(earnCopy(5, 500, 50)).toContain('up to 50 coins per order')
  })
  it('falls back to 5 coins / ₹500 for missing or invalid values', () => {
    expect(earnCopy(undefined)).toContain('Earn 5 coins for every ₹500')
    expect(earnCopy(Number.NaN, 0)).toContain('₹500')
  })
})

import { expiryCopy } from '@/app/account/_sections/LoyaltySection'
describe('expiryCopy', () => {
  it('follows loyalty_expiry_days', () => {
    expect(expiryCopy(120)).toBe(' Coins expire 4 months after you earn them.')
    expect(expiryCopy(365)).toBe(' Coins expire 12 months after you earn them.')
    expect(expiryCopy(30)).toBe(' Coins expire 1 month after you earn them.')
    expect(expiryCopy(45)).toBe(' Coins expire 45 days after you earn them.')
    expect(expiryCopy(0)).toBe('')
    expect(expiryCopy(undefined)).toBe(' Coins expire 4 months after you earn them.')
  })
})
