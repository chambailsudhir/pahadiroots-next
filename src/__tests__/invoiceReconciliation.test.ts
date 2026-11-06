/**
 * AUDIT S1-009 / S2-015 / S3-006 / F2-02 / F2-03 — one invoice computation, reconciling to the paid total.
 * F2 TV13 numbers: 249.50×3 + 1199 = 1947.50 lines, subtotal 1948 (round_off 0.50), coupon 195,
 * 100 pts × ₹0.25 = 25 loyalty, prepaid 86, total 1642.
 */
import { describe, it, expect } from 'vitest'
import { computeOrderInvoice, invoiceRows } from '@/lib/invoiceGst'

const TV13 = {
  items: [
    { name: 'Wild Honey', qty: 3, price: 249.5 },
    { name: 'Shilajit',   qty: 1, price: 1199 },
  ],
  total_amount: 1642, subtotal: 1948, coupon_discount: 195, shipping_charge: 0, cod_surcharge: 0,
  tax: 219, loyalty_points_redeemed: 100, state: 'Delhi',
}

describe('computeOrderInvoice (TV13)', () => {
  it('derives round-off, loyalty and prepaid so the lines sum to the paid total', () => {
    const inv = computeOrderInvoice(TV13, { loyaltyPointValue: 0.25 })
    expect(inv.linesTotal).toBe(1947.5)
    expect(inv.roundOff).toBe(0.5)
    expect(inv.subtotal).toBe(1948)
    expect(inv.couponDiscount).toBe(195)
    expect(inv.loyaltyDiscount).toBe(25)
    expect(inv.prepaidDiscount).toBe(86)
    expect(inv.total).toBe(1642)
    expect(inv.reconciles).toBe(true)
    const rows = invoiceRows(inv)
    const sum = rows.filter(r => r.kind !== 'total').reduce((s, r) => s + Math.round(r.amount * 100), 0)
    expect(sum / 100).toBe(1642)
    expect(rows.at(-1)).toMatchObject({ label: 'Total', amount: 1642 })
    expect(rows.map(r => r.label)).toEqual(['Subtotal', 'Round off', 'Coupon discount', 'Loyalty discount', 'Prepaid discount', 'Total'])
  })

  it('without a point value the residual is one "Prepaid/loyalty discount" line and still reconciles', () => {
    const inv = computeOrderInvoice(TV13)
    expect(inv.discountSplitKnown).toBe(false)
    expect(inv.prepaidDiscount).toBe(111)
    expect(inv.loyaltyDiscount).toBe(0)
    expect(inv.reconciles).toBe(true)
    expect(invoiceRows(inv).map(r => r.label)).toContain('Prepaid/loyalty discount')
  })

  it('GST comes from the stored tax, split paise-safe for intra-state (F2-03) — never live gst_rate', () => {
    const inv = computeOrderInvoice({ ...TV13, state: 'Himachal Pradesh', tax: 332.31 })
    expect(inv.supplyType).toBe('intra')
    expect(inv.cgst).toBe(166.15)
    expect(inv.sgst).toBe(166.16)
    expect(inv.cgst + inv.sgst).toBeCloseTo(332.31, 9)
    expect(inv.igst).toBe(0)
    const inter = computeOrderInvoice(TV13)
    expect(inter.igst).toBe(219); expect(inter.cgst).toBe(0)
  })

  it('prefers stored cgst/sgst/igst columns when they sum to tax, ignores them when they do not', () => {
    const good = computeOrderInvoice({ ...TV13, state: 'Himachal Pradesh', cgst: 109.5, sgst: 109.5, igst: 0 })
    expect(good.cgst).toBe(109.5)
    const bad = computeOrderInvoice({ ...TV13, state: 'Himachal Pradesh', cgst: 1, sgst: 1, igst: 0 })
    expect(bad.cgst + bad.sgst).toBe(219)
  })

  it('COD order with shipping: no derived discount, rows still tie', () => {
    const inv = computeOrderInvoice({ items: [{ name: 'A', qty: 1, price: 210 }], total_amount: 349, subtotal: 210, shipping_charge: 99, cod_surcharge: 40, tax: 10 })
    expect(inv.prepaidDiscount).toBe(0)
    expect(inv.reconciles).toBe(true)
    expect(invoiceRows(inv).map(r => r.label)).toEqual(['Subtotal', 'Shipping', 'COD Charges', 'Total'])
  })

  it('a negative residual is surfaced as "Other adjustment" rather than hidden', () => {
    const inv = computeOrderInvoice({ items: [{ name: 'A', qty: 1, price: 100 }], total_amount: 120, subtotal: 100 })
    expect(inv.otherAdjustment).toBe(20)
    expect(inv.reconciles).toBe(true)
  })
})

// Nov 2026: marketplace layout — gross → discount → TAXABLE VALUE → tax. Seller discounts (coupon, prepaid) reduce the taxable value;
// loyalty-coin redemption is payment, not a price reduction, so it does not.
describe('computeOrderInvoice — taxable value', () => {
  const honey = { items: [{ name: 'Wild Honey', qty: 2, price: 350 }], subtotal: 700, shipping_charge: 0, cod_surcharge: 0, state: 'Delhi' }

  it('audited cart: ₹700, ₹50 coupon, GST ₹31 → taxable ₹619, and taxable + GST = goods payable ₹650', () => {
    const inv = computeOrderInvoice({ ...honey, total_amount: 650, coupon_discount: 50, tax: 31 })
    expect(inv.taxableValue).toBe(619)
    expect(inv.taxableValue! + inv.tax).toBe(650)
    expect(inv.reconciles).toBe(true)
  })
  it('a prepaid discount reduces the taxable value too', () => {
    const inv = computeOrderInvoice({ ...honey, total_amount: 630, coupon_discount: 0, tax: 30 }, { loyaltyPointValue: 1 })
    expect(inv.prepaidDiscount).toBe(70)
    expect(inv.taxableValue).toBe(600)            // 700 − 70 − 30
  })
  it('redeemed loyalty coins do NOT reduce the taxable value', () => {
    const inv = computeOrderInvoice({ ...honey, total_amount: 550, coupon_discount: 50, tax: 31, loyalty_points_redeemed: 100 }, { loyaltyPointValue: 1 })
    expect(inv.loyaltyDiscount).toBe(100)
    expect(inv.taxableValue).toBe(619)            // same as without coins
    expect(inv.reconciles).toBe(true)
  })
  it('is not stated when coins were redeemed but their value is unknown (cannot be exact)', () => {
    const inv = computeOrderInvoice({ ...honey, total_amount: 550, coupon_discount: 50, tax: 31, loyalty_points_redeemed: 100 })
    expect(inv.taxableValue).toBeNull()
  })
  it('is null when there is no tax (nothing to split)', () => {
    expect(computeOrderInvoice({ ...honey, total_amount: 700, coupon_discount: 0, tax: 0 }).taxableValue).toBeNull()
  })
})
