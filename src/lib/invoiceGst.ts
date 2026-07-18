// ─────────────────────────────────────────────────────────────────────────────
// lib/invoiceGst.ts
//
// GST invoice calculations for the order-success "Print Invoice" feature.
// Previously "Print Invoice" just called window.print() on the whole
// confirmation webpage (header, nav, footer and all) — not a real tax
// invoice. This module computes the actual GST breakdown needed for a
// compliant-looking invoice: per-item taxable value + tax, and the
// CGST+SGST (intra-state) vs IGST (inter-state) split based on comparing
// the buyer's delivery state to the seller's registered state.
//
// All confirmed via live schema inspection / user-provided GSTIN — nothing
// here is guessed:
//   - GSTIN 02AAWFC5939L1ZV — "02" is Himachal Pradesh's GST state code.
//   - products.hsn_code / products.gst_rate are real, confirmed columns.
//   - Prices site-wide are GST-INCLUSIVE (confirmed: PDP/checkout show
//     "Subtotal (incl. GST)" with GST broken out as a sub-line, not added
//     on top) — so taxable value must be back-calculated from the
//     inclusive price, not treated as already-exclusive.
// ─────────────────────────────────────────────────────────────────────────────

export const BUSINESS_INFO = {
  // Legal name registered against the GSTIN below — this is what must
  // appear on a GST-compliant tax invoice as the seller's legal name.
  name:      'Chambail International',
  // Brand/trade name — shown alongside the legal name, not in place of it.
  brandName: 'HimVeda by Pahadi Roots',
  gstin:     '02AAWFC5939L1ZV',
  address:   'Village Sakoh, PO Sakoh, Distt Kangra, Himachal Pradesh 176082',
  state:     'Himachal Pradesh',
  stateCode: '02',
} as const

export interface InvoiceLineItem {
  name:          string
  variant?:      string
  hsnCode?:      string
  gstRate:       number // e.g. 5, 12, 18 — percent
  quantity:      number
  priceInclGst:  number // per-unit price, GST-inclusive
}

export interface InvoiceLineResult extends InvoiceLineItem {
  taxableValuePerUnit: number
  taxAmountPerUnit:    number
  lineTaxableTotal:    number
  lineTaxTotal:        number
  lineTotal:           number
}

/**
 * Back-calculates the taxable value and tax amount from a GST-inclusive
 * per-unit price. A missing/zero gst_rate is treated as 0% (taxable value
 * == price) rather than throwing — some products (or the "Test" product
 * seen in the DB) may not have a rate set, and an invoice should still
 * render rather than crash on one bad line item.
 */
export function computeInvoiceLine(item: InvoiceLineItem): InvoiceLineResult {
  const rate = item.gstRate > 0 ? item.gstRate : 0
  const taxableValuePerUnit = rate > 0 ? item.priceInclGst / (1 + rate / 100) : item.priceInclGst
  const taxAmountPerUnit    = item.priceInclGst - taxableValuePerUnit

  return {
    ...item,
    taxableValuePerUnit,
    taxAmountPerUnit,
    lineTaxableTotal: taxableValuePerUnit * item.quantity,
    lineTaxTotal:     taxAmountPerUnit * item.quantity,
    lineTotal:        item.priceInclGst * item.quantity,
  }
}

export type SupplyType = 'intra' | 'inter'

/**
 * Intra-state (buyer in the same state as the business → CGST + SGST) vs
 * inter-state (different state → IGST). Defaults to inter-state when the
 * buyer's state is unknown/missing — never assume same-state without
 * confirmation, since that would understate IGST liability.
 */
export function getSupplyType(buyerState: string | null | undefined): SupplyType {
  if (!buyerState) return 'inter'
  const normalize = (s: string) => s.trim().toLowerCase()
  return normalize(buyerState) === normalize(BUSINESS_INFO.state) ? 'intra' : 'inter'
}

export interface InvoiceTotals {
  taxableValue: number
  cgst:         number
  sgst:         number
  igst:         number
  totalTax:     number
  grandTotal:   number
}

export function computeInvoiceTotals(
  lines: InvoiceLineResult[],
  supplyType: SupplyType,
  shippingCharge = 0,
): InvoiceTotals {
  const taxableValue = lines.reduce((s, l) => s + l.lineTaxableTotal, 0)
  const totalTax     = lines.reduce((s, l) => s + l.lineTaxTotal, 0)

  return {
    taxableValue,
    cgst:       supplyType === 'intra' ? totalTax / 2 : 0,
    sgst:       supplyType === 'intra' ? totalTax / 2 : 0,
    igst:       supplyType === 'inter' ? totalTax : 0,
    totalTax,
    // Shipping is not tax-split here — the site advertises free shipping
    // sitewide, and on the rare non-free order this matches how tax/total
    // are already computed and displayed elsewhere (shipping added after
    // the taxed subtotal, not itself broken into CGST/SGST/IGST).
    grandTotal: taxableValue + totalTax + shippingCharge,
  }
}
