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

import { splitGST } from '@/lib/utils'

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
  taxableValue:      number
  cgst:              number
  sgst:              number
  igst:              number
  totalTax:          number
  grandTotal:        number
  // COD Charges broken out separately so the invoice can show it as its
  // own line (taxable value + tax), the way Myntra shows "Platform Fee"
  // as its own taxed line rather than folding it silently into the total.
  codSurchargeTaxable: number
  codSurchargeTax:     number
}

// GST rate applied to the COD handling fee. Treated as a taxable service
// charge (not a non-taxable pass-through like shipping) — cash-on-delivery
// convenience fees are standard-rated services under GST, and 18% is the
// standard slab e-commerce platforms apply to service/handling fees (see
// Myntra's own Platform Fee invoice: ₹23 = ₹19.49 taxable + ₹3.51 IGST,
// i.e. 18%). Confirm the exact rate/HSN with your CA before relying on
// this for filing — this is the standard default, not a certified rate
// for your specific registration.
export const COD_SURCHARGE_GST_RATE = 18

export function computeInvoiceTotals(
  lines: InvoiceLineResult[],
  supplyType: SupplyType,
  shippingCharge = 0,
  codSurcharge = 0,
): InvoiceTotals {
  const taxableValue = lines.reduce((s, l) => s + l.lineTaxableTotal, 0)
  const itemTax       = lines.reduce((s, l) => s + l.lineTaxTotal, 0)

  // codSurcharge (e.g. ₹50) is GST-inclusive, same as item prices — back
  // calculate its taxable value and tax the same way computeInvoiceLine
  // does for products, instead of treating it as an untaxed flat add-on.
  const codSurchargeTaxable = codSurcharge > 0
    ? codSurcharge / (1 + COD_SURCHARGE_GST_RATE / 100)
    : 0
  const codSurchargeTax = codSurcharge - codSurchargeTaxable

  const totalTax = itemTax + codSurchargeTax

  // AUDIT F2-03: halves computed with the paise-safe splitGST (floor + remainder) so
  // CGST + SGST always equals the total tax, even on odd paise (332.31 → 166.15 + 166.16).
  const split = splitGST(Math.round(totalTax * 100), supplyType === 'inter')

  return {
    taxableValue,
    cgst:       split.cgst / 100,
    sgst:       split.sgst / 100,
    igst:       split.igst / 100,
    totalTax,
    codSurchargeTaxable,
    codSurchargeTax,
    // Shipping is not tax-split here — the site advertises free shipping
    // sitewide, and on the rare non-free order this matches how tax/total
    // are already computed and displayed elsewhere (shipping added after
    // the taxed subtotal, not itself broken into CGST/SGST/IGST).
    // codSurcharge IS tax-split (see codSurchargeTaxable/codSurchargeTax
    // above) — only its taxable portion is added here, since its tax
    // portion is already folded into totalTax. Adding the full
    // (GST-inclusive) codSurcharge here as well would double-count that tax.
    grandTotal: taxableValue + codSurchargeTaxable + totalTax + shippingCharge,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT S1-009 / S2-015 / S3-006 / F2-02 / F2-03 — ONE invoice computation
// shared by the HTML invoice route, the order-success "TAX INVOICE" and the
// account "Price Details" card. Everything below is derived ONLY from the
// stored order row (never from live products.gst_rate / live settings for
// money), in integer paise, and every output reconciles to total_amount:
//
//   Σ lines + round_off − coupon − loyalty − prepaid + shipping + cod (− other) = total
//
// The orders RPC does not persist the prepaid % discount or the loyalty ₹
// discount, so they are DERIVED as the residual of the stored columns; the
// loyalty part is points × loyalty_points_value (when the caller can supply
// it) and the remainder is the prepaid discount. GST is read from the stored
// tax / cgst / sgst / igst columns; when the split columns are absent the
// stored tax is split with the paise-safe splitGST (F2-03).
// ─────────────────────────────────────────────────────────────────────────────

export interface StoredOrderLine {
  name:     string
  variant?: string | null
  hsnCode?: string | null
  qty:      number
  price:    number   // price_at_time, GST-inclusive, rupees (may carry paise)
}

export interface StoredOrderMoney {
  items:                    StoredOrderLine[]
  total_amount:             number
  subtotal?:                number | null
  coupon_discount?:         number | null
  shipping_charge?:         number | null
  cod_surcharge?:           number | null
  tax?:                     number | null
  cgst?:                    number | null
  sgst?:                    number | null
  igst?:                    number | null
  round_off?:               number | null
  loyalty_points_redeemed?: number | null
  /** Buyer's state (shipping_address.state) — decides CGST/SGST vs IGST when split columns are missing. */
  state?:                   string | null
}

export interface InvoiceReconciliation {
  lines: Array<StoredOrderLine & { lineTotal: number }>
  linesTotal:          number
  roundOff:            number   // + when the stored subtotal is above Σ lines (F2-02 "Round off" line)
  subtotal:            number   // Σ lines + roundOff (== stored subtotal when present)
  couponDiscount:      number
  loyaltyDiscount:     number   // derived: min(residual, points × pointValue) — 0 when value unknown
  prepaidDiscount:     number   // derived: residual − loyaltyDiscount
  /** True when the residual could not be split (no point value) — label it "Prepaid/loyalty discount". */
  discountSplitKnown:  boolean
  otherAdjustment:     number   // negative residual (should never happen) — shown so the sum still ties
  shipping:            number
  codSurcharge:        number
  total:               number
  tax:                 number
  cgst:                number
  sgst:                number
  igst:                number
  supplyType:          SupplyType
  /** Invariant checked in tests: every displayed line sums to `total`. */
  reconciles:          boolean
}

const toPaise = (v: number | null | undefined): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
const toRupees = (p: number): number => p / 100

export interface InvoiceOptions {
  /** ₹ value of one loyalty point from settings (loyalty_points_value). Omit when unknown. */
  loyaltyPointValue?: number | null
}

export function computeOrderInvoice(order: StoredOrderMoney, opts: InvoiceOptions = {}): InvoiceReconciliation {
  const lines = (order.items || []).map(l => {
    const qty = Number(l.qty) || 0
    return { ...l, qty, lineTotal: toRupees(toPaise(l.price) * qty) }
  })
  const linesTotalP = lines.reduce((s, l) => s + toPaise(l.lineTotal), 0)

  // Stored subtotal is the whole-rupee figure the customer was charged on; Σ lines may carry paise.
  const storedSubP  = order.subtotal != null && Number.isFinite(Number(order.subtotal)) ? toPaise(order.subtotal) : null
  const roundOffP   = storedSubP != null ? storedSubP - linesTotalP : toPaise(order.round_off)
  const subtotalP   = linesTotalP + roundOffP

  const couponP   = Math.max(0, toPaise(order.coupon_discount))
  const shippingP = Math.max(0, toPaise(order.shipping_charge))
  const codP      = Math.max(0, toPaise(order.cod_surcharge))
  const totalP    = toPaise(order.total_amount)

  // Unexplained residual = prepaid % + loyalty ₹ (neither is stored by the RPC).
  const residualP = subtotalP - couponP + shippingP + codP - totalP

  let loyaltyP = 0, prepaidP = 0, otherP = 0, splitKnown = false
  if (residualP >= 0) {
    const points = Math.max(0, Number(order.loyalty_points_redeemed) || 0)
    const value  = Number(opts.loyaltyPointValue)
    if (Number.isFinite(value) && value > 0) {
      splitKnown = true
      // The storefront FLOORS points × value to whole rupees (orderService) — mirror that.
      loyaltyP = Math.min(residualP, Math.floor(points * value) * 100)
    }
    prepaidP = residualP - loyaltyP
  } else {
    otherP = -residualP
  }

  const taxP = Math.max(0, toPaise(order.tax))
  const supplyType = getSupplyType(order.state)
  let cgstP = toPaise(order.cgst), sgstP = toPaise(order.sgst), igstP = toPaise(order.igst)
  const storedSplitValid =
    (order.cgst != null || order.sgst != null || order.igst != null) && cgstP + sgstP + igstP === taxP
  if (!storedSplitValid) {
    ({ cgst: cgstP, sgst: sgstP, igst: igstP } = splitGST(taxP, supplyType === 'inter'))
  }

  const sumP = subtotalP - couponP - loyaltyP - prepaidP + shippingP + codP + otherP

  return {
    lines,
    linesTotal:         toRupees(linesTotalP),
    roundOff:           toRupees(roundOffP),
    subtotal:           toRupees(subtotalP),
    couponDiscount:     toRupees(couponP),
    loyaltyDiscount:    toRupees(loyaltyP),
    prepaidDiscount:    toRupees(prepaidP),
    discountSplitKnown: splitKnown,
    otherAdjustment:    toRupees(otherP),
    shipping:           toRupees(shippingP),
    codSurcharge:       toRupees(codP),
    total:              toRupees(totalP),
    tax:                toRupees(taxP),
    cgst:               toRupees(cgstP),
    sgst:               toRupees(sgstP),
    igst:               toRupees(igstP),
    supplyType,
    reconciles:         sumP === totalP,
  }
}

/** Display rows for the totals block — same order and labels on every surface. */
export interface InvoiceRow { key: string; label: string; amount: number; kind: 'plain' | 'discount' | 'total' }

export function invoiceRows(inv: InvoiceReconciliation): InvoiceRow[] {
  const rows: InvoiceRow[] = [{ key: 'subtotal', label: 'Subtotal', amount: inv.linesTotal, kind: 'plain' }]
  if (inv.roundOff !== 0)       rows.push({ key: 'round_off', label: 'Round off', amount: inv.roundOff, kind: 'plain' })
  if (inv.couponDiscount > 0)   rows.push({ key: 'coupon',    label: 'Coupon discount', amount: -inv.couponDiscount, kind: 'discount' })
  if (inv.discountSplitKnown) {
    if (inv.loyaltyDiscount > 0) rows.push({ key: 'loyalty', label: 'Loyalty discount', amount: -inv.loyaltyDiscount, kind: 'discount' })
    if (inv.prepaidDiscount > 0) rows.push({ key: 'prepaid', label: 'Prepaid discount', amount: -inv.prepaidDiscount, kind: 'discount' })
  } else if (inv.prepaidDiscount > 0) {
    rows.push({ key: 'prepaid_loyalty', label: 'Prepaid/loyalty discount', amount: -inv.prepaidDiscount, kind: 'discount' })
  }
  if (inv.shipping > 0)         rows.push({ key: 'shipping', label: 'Shipping', amount: inv.shipping, kind: 'plain' })
  if (inv.codSurcharge > 0)     rows.push({ key: 'cod',      label: 'COD Charges', amount: inv.codSurcharge, kind: 'plain' })
  if (inv.otherAdjustment > 0)  rows.push({ key: 'other',    label: 'Other adjustment', amount: inv.otherAdjustment, kind: 'plain' })
  rows.push({ key: 'total', label: 'Total', amount: inv.total, kind: 'total' })
  return rows
}
