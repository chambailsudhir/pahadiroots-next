import { describe, it, expect } from 'vitest'
import { computeOrderInvoice } from '@/lib/invoiceGst'

describe('invoice taxable value includes the fees that now carry GST (Nov 2026)', () => {
  it('100 goods + 50 shipping, tax 7 -> taxable value 143 and the invoice still reconciles to the total', () => {
    const inv = computeOrderInvoice({
      items: [{ name: 'P', qty: 1, price: 100 }], total_amount: 150, subtotal: 100, shipping_charge: 50, tax: 7, state: 'Uttarakhand',
    })
    expect(inv.taxableValue).toBe(143)
    expect(inv.reconciles).toBe(true)
    expect(inv.cgst + inv.sgst + inv.igst).toBeCloseTo(7, 2)
  })
  it('COD fee counts the same way', () => {
    const inv = computeOrderInvoice({
      items: [{ name: 'P', qty: 1, price: 100 }], total_amount: 150, subtotal: 100, cod_surcharge: 50, tax: 7, state: 'Himachal Pradesh',
    })
    expect(inv.taxableValue).toBe(143)
    expect(inv.supplyType).toBe('intra')
  })
})
