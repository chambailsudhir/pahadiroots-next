import { describe, it, expect } from 'vitest'
import { earnCopy } from '@/app/account/_sections/LoyaltySection'

// Owner decision (Nov 2026): a flat number of coins per DELIVERED order (default 5), taken back on return / refund.
describe('earnCopy', () => {
  it('states the flat per-order amount and the delivery / return rule', () => {
    expect(earnCopy(5)).toBe('Earn 5 coins on every order once it is delivered (taken back if you return it)')
    expect(earnCopy(1)).toBe('Earn 1 coin on every order once it is delivered (taken back if you return it)')
  })
  it('falls back to the default of 5 for a missing / invalid value, and respects 0', () => {
    expect(earnCopy(undefined)).toContain('Earn 5 coins')
    expect(earnCopy(Number.NaN)).toContain('Earn 5 coins')
    expect(earnCopy(0)).toContain('Earn 0 coins')
  })
})
