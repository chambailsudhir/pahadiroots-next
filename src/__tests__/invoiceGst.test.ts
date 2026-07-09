/**
 * invoiceGst.test.ts
 *
 * The GST math here is the core of the "Print Invoice" fix — this needs
 * real regression coverage since incorrect tax splits on a document a
 * customer might use for their own accounting is a compliance issue, not
 * just a cosmetic bug.
 */

import { describe, it, expect } from 'vitest'
import { computeInvoiceLine, getSupplyType, computeInvoiceTotals, BUSINESS_INFO } from '@/lib/invoiceGst'

describe('computeInvoiceLine', () => {
  it('back-calculates taxable value from a GST-inclusive price at 5%', () => {
    // ₹190.48 inclusive of 5% GST → taxable value = 190.48 / 1.05 ≈ 181.41
    const line = computeInvoiceLine({ name: 'Wild Honey', gstRate: 5, quantity: 1, priceInclGst: 190.48 })
    expect(line.taxableValuePerUnit).toBeCloseTo(181.41, 1)
    expect(line.taxAmountPerUnit).toBeCloseTo(9.07, 1)
  })

  it('multiplies per-unit values by quantity for line totals', () => {
    const line = computeInvoiceLine({ name: 'Turmeric', gstRate: 5, quantity: 3, priceInclGst: 100 })
    expect(line.lineTotal).toBe(300)
    expect(line.lineTaxableTotal).toBeCloseTo(285.71, 1)
    expect(line.lineTaxTotal).toBeCloseTo(14.29, 1)
  })

  it('treats a missing/zero gst_rate as 0% rather than throwing (e.g. the "Test" product with no rate set)', () => {
    const line = computeInvoiceLine({ name: 'Test', gstRate: 0, quantity: 1, priceInclGst: 50 })
    expect(line.taxableValuePerUnit).toBe(50)
    expect(line.taxAmountPerUnit).toBe(0)
  })

  it('a negative or NaN-like rate never gets applied (defensive floor at 0%)', () => {
    const line = computeInvoiceLine({ name: 'X', gstRate: -5, quantity: 1, priceInclGst: 100 })
    expect(line.taxableValuePerUnit).toBe(100)
    expect(line.taxAmountPerUnit).toBe(0)
  })
})

describe('getSupplyType', () => {
  it('returns intra-state when the buyer is in Himachal Pradesh (same as the business)', () => {
    expect(getSupplyType('Himachal Pradesh')).toBe('intra')
  })

  it('is case/whitespace insensitive', () => {
    expect(getSupplyType('  himachal pradesh  ')).toBe('intra')
    expect(getSupplyType('HIMACHAL PRADESH')).toBe('intra')
  })

  it('returns inter-state for any other state', () => {
    expect(getSupplyType('Delhi')).toBe('inter')
    expect(getSupplyType('Uttarakhand')).toBe('inter')
  })

  it('defaults to inter-state (never assumes same-state) when the buyer state is missing', () => {
    expect(getSupplyType(undefined)).toBe('inter')
    expect(getSupplyType(null)).toBe('inter')
    expect(getSupplyType('')).toBe('inter')
  })
})

describe('computeInvoiceTotals', () => {
  const lines = [
    computeInvoiceLine({ name: 'A', gstRate: 5, quantity: 1, priceInclGst: 210 }),
    computeInvoiceLine({ name: 'B', gstRate: 12, quantity: 1, priceInclGst: 112 }),
  ]

  it('splits tax into CGST + SGST (each exactly half) for intra-state supply', () => {
    const totals = computeInvoiceTotals(lines, 'intra')
    expect(totals.cgst).toBeCloseTo(totals.sgst, 5)
    expect(totals.cgst + totals.sgst).toBeCloseTo(totals.totalTax, 5)
    expect(totals.igst).toBe(0)
  })

  it('puts the full tax into IGST (nothing into CGST/SGST) for inter-state supply', () => {
    const totals = computeInvoiceTotals(lines, 'inter')
    expect(totals.igst).toBeCloseTo(totals.totalTax, 5)
    expect(totals.cgst).toBe(0)
    expect(totals.sgst).toBe(0)
  })

  it('grand total = taxable value + tax + shipping (shipping added, not itself GST-split)', () => {
    const totals = computeInvoiceTotals(lines, 'intra', 40)
    expect(totals.grandTotal).toBeCloseTo(totals.taxableValue + totals.totalTax + 40, 5)
  })

  it('grand total matches the sum of GST-inclusive line totals when there is no shipping', () => {
    const totals = computeInvoiceTotals(lines, 'inter', 0)
    const sumOfLineTotals = lines.reduce((s, l) => s + l.lineTotal, 0)
    expect(totals.grandTotal).toBeCloseTo(sumOfLineTotals, 5)
  })
})

describe('BUSINESS_INFO', () => {
  it('GSTIN state-code prefix (02) matches the declared business state (Himachal Pradesh)', () => {
    expect(BUSINESS_INFO.gstin.slice(0, 2)).toBe(BUSINESS_INFO.stateCode)
    expect(BUSINESS_INFO.stateCode).toBe('02') // 02 = Himachal Pradesh per GST state code list
  })
})
