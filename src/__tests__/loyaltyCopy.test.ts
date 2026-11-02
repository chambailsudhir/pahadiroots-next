/**
 * AUDIT ACC-045 — the account page promised "Earn 1 coin per ₹1" while the real site setting was
 * loyalty_points_per_rupee = 0.01 (1 coin per ₹100). The copy is now built from the real rate.
 */
import { describe, it, expect } from 'vitest'
import { earnCopy } from '@/app/account/_sections/LoyaltySection'

describe('earnCopy', () => {
  it('states the real rate when it is below 1 coin per rupee', () => {
    expect(earnCopy(0.01)).toBe('Earn 1 coin for every ₹100 you spend')
    expect(earnCopy(0.02)).toBe('Earn 1 coin for every ₹50 you spend')
    expect(earnCopy(0.001)).toBe('Earn 1 coin for every ₹1,000 you spend')
  })
  it('states "per ₹1" only when that is actually the rate', () => {
    expect(earnCopy(1)).toBe('Earn 1 coin per ₹1 spent on every order')
    expect(earnCopy(2)).toBe('Earn 2 coins per ₹1 spent on every order')
  })
  it('falls back to the documented default (1 per ₹1) for a missing / invalid rate', () => {
    expect(earnCopy(undefined)).toBe('Earn 1 coin per ₹1 spent on every order')
    expect(earnCopy(0)).toBe('Earn 1 coin per ₹1 spent on every order')
    expect(earnCopy(NaN)).toBe('Earn 1 coin per ₹1 spent on every order')
  })
})
