import { describe, it, expect } from 'vitest'
import { emailTotals, formatRupees } from '@/lib/emailMoney'

describe('formatRupees', () => {
  it('whole rupees without decimals, fractions with exactly two', () => {
    expect(formatRupees(267)).toBe('₹267')
    expect(formatRupees(266.67)).toBe('₹266.67')
    expect(formatRupees(266.6)).toBe('₹266.60')
    expect(formatRupees(1234567.5)).toBe('₹12,34,567.50')
  })
  it('absorbs floating-point noise (3 × 266.67)', () => { expect(formatRupees(266.67 * 3)).toBe('₹800.01') })
  it('never prints NaN', () => { expect(formatRupees(NaN)).toBe('₹0') })
})

describe('emailTotals — the production case (item ₹266.67, total ₹267)', () => {
  it('prints the item sum as Subtotal and the 33 paise as a Round off row', () => {
    expect(emailTotals({ items: [{ price: 266.67, qty: 1 }], total: 267, storedSubtotal: 267 })).toEqual({ subtotal: 266.67, roundOff: 0.33 })
  })
  it('rounding down gives a negative Round off', () => {
    expect(emailTotals({ items: [{ price: 266.4, qty: 1 }], total: 266, storedSubtotal: 266 })).toEqual({ subtotal: 266.4, roundOff: -0.4 })
  })
  it('no Round off row when the rows already add up', () => {
    expect(emailTotals({ items: [{ price: 100, qty: 2 }], shipping: 50, total: 250 })).toEqual({ subtotal: 200, roundOff: null })
  })
  it('discount, shipping and COD charge are part of the arithmetic', () => {
    expect(emailTotals({ items: [{ price: 266.67, qty: 3 }], discount: 100, shipping: 40, codCharge: 30, total: 770, storedSubtotal: 800 }))
      .toEqual({ subtotal: 800.01, roundOff: -0.01 })
  })
  it('a gap of ₹1 or more (e.g. redeemed coins that the e-mail does not itemise) is NOT dressed up as rounding', () => {
    expect(emailTotals({ items: [{ price: 500, qty: 1 }], total: 450, storedSubtotal: 500 })).toEqual({ subtotal: 500, roundOff: null })
  })
  it('no items → falls back to the stored subtotal', () => {
    expect(emailTotals({ items: [], total: 100, storedSubtotal: 100 })).toEqual({ subtotal: 100, roundOff: null })
  })
})
