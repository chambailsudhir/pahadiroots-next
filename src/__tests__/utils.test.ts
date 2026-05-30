/**
 * utils.test.ts
 * Tests for pure utility functions: calcGST, asNumber, formatPrice, etc.
 */

import { describe, it, expect } from 'vitest'
import { calcGST, asNumber, formatPrice, savingsPercent, slugify } from '@/lib/utils'

// ─── calcGST ──────────────────────────────────────────────────────────────────

describe('calcGST', () => {
  it('computes GST for a single item at 5% rate (inclusive)', () => {
    // price=100, gstRate=5, qty=1 → GST = 100*1*5/(100+5) = 500/105 ≈ 4.76 → rounds to 5
    expect(calcGST(100, 5, 1)).toBe(5)
  })

  it('computes GST for a single item at 12% rate', () => {
    // price=112, gstRate=12, qty=1 → 112*12/112 = 12
    expect(calcGST(112, 12, 1)).toBe(12)
  })

  it('scales with quantity — formula is round(price*qty*rate/(100+rate))', () => {
    // calcGST computes round(price*qty*rate/(100+rate)) in a single pass.
    // Do not compare to single*3 — rounding happens once on the full qty, not per unit.
    // price=100, qty=3, rate=5 → round(100*3*5/105) = round(14.28) = 14
    expect(calcGST(100, 5, 3)).toBe(14)
    // Proportional: larger qty always produces >= single-unit result
    expect(calcGST(100, 5, 2)).toBeGreaterThanOrEqual(calcGST(100, 5, 1))
    expect(calcGST(100, 5, 3)).toBeGreaterThanOrEqual(calcGST(100, 5, 2))
  })

  it('returns 0 for 0% GST rate', () => {
    expect(calcGST(500, 0, 2)).toBe(0)
  })

  it('defaults qty to 1 when omitted', () => {
    expect(calcGST(100, 18)).toBe(calcGST(100, 18, 1))
  })

  it('rounds to nearest integer — no fractional paise', () => {
    // price=99, rate=5, qty=1 → 99*5/105 = 4.714... → rounds to 5
    const result = calcGST(99, 5, 1)
    expect(Number.isInteger(result)).toBe(true)
  })

  it('handles higher-priced items accurately at 18%', () => {
    // price=1180, rate=18, qty=1 → 1180*18/118 = 180
    expect(calcGST(1180, 18, 1)).toBe(180)
  })
})

// ─── asNumber ─────────────────────────────────────────────────────────────────

describe('asNumber', () => {
  it('parses a valid numeric string', () => {
    expect(asNumber('799', 0)).toBe(799)
  })

  it('returns defaultValue for undefined', () => {
    expect(asNumber(undefined, 99)).toBe(99)
  })

  it('returns defaultValue for empty string', () => {
    expect(asNumber('', 50)).toBe(50)
  })

  it('returns defaultValue for non-numeric string', () => {
    expect(asNumber('abc', 42)).toBe(42)
  })

  it('parses decimal values', () => {
    expect(asNumber('5.5', 0)).toBe(5.5)
  })
})

// ─── formatPrice ──────────────────────────────────────────────────────────────

describe('formatPrice', () => {
  it('prefixes with ₹', () => {
    expect(formatPrice(100).startsWith('₹')).toBe(true)
  })

  it('rounds fractional values before formatting', () => {
    // Should not show decimals
    const result = formatPrice(99.6)
    expect(result).toBe('₹100')
  })

  it('formats 0 correctly', () => {
    expect(formatPrice(0)).toBe('₹0')
  })
})

// ─── savingsPercent ───────────────────────────────────────────────────────────

describe('savingsPercent', () => {
  it('returns 0 when mrp equals price', () => {
    expect(savingsPercent(100, 100)).toBe(0)
  })

  it('returns 0 when mrp is 0 (no data)', () => {
    expect(savingsPercent(0, 80)).toBe(0)
  })

  it('calculates correct % discount', () => {
    // mrp=200, price=150 → 25% off
    expect(savingsPercent(200, 150)).toBe(25)
  })

  it('rounds to nearest integer', () => {
    // mrp=300, price=200 → 33.33...% → rounds to 33
    expect(savingsPercent(300, 200)).toBe(33)
  })
})

// ─── slugify ──────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Himalayan Wild Honey')).toBe('himalayan-wild-honey')
  })

  it('removes special characters', () => {
    expect(slugify('Ghee (A2)')).toMatch(/^[a-z0-9-]+$/)
  })
})
