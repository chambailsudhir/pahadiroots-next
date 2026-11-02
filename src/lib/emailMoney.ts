// lib/emailMoney.ts — the money lines of an order e-mail (pure, no server imports).
//
// Nov 2026 e-mail review (screenshot of a real production confirmation): the item row said ₹266.67, the Subtotal said ₹267 and the
// Total ₹267, with nothing explaining the missing 33 paise. Prices are GST-inclusive and the payable total is rounded to a whole
// rupee (orders.round_off = 0.33), but the e-mail printed the rounded figure as "Subtotal" and never showed the rounding.
// The e-mail now prints the item sum as the Subtotal and, when the only difference to the total is rounding, an explicit
// "Round off" row — so every row adds up to the total on the page.

export function formatRupees(n: number): string {
  const v = Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })
}

export interface EmailTotals { subtotal: number; roundOff: number | null }

/**
 * `subtotal` is the sum of the item lines. `roundOff` is shown only when it is what remains between the item sum and the total
 * (items − discount + shipping + COD charge → total) and is a rounding-sized amount (under ₹1, at least 1 paisa). Anything bigger
 * means the total contains something this e-mail does not itemise (e.g. redeemed coins), so no made-up row is printed and the
 * caller falls back to the stored subtotal.
 */
export function emailTotals(input: {
  items: Array<{ price: number; qty: number }>
  discount?: number; shipping?: number; codCharge?: number
  total: number; storedSubtotal?: number
}): EmailTotals {
  const sum = Math.round(input.items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0) * 100) / 100
  const expected = sum - (input.discount ?? 0) + (input.shipping ?? 0) + (input.codCharge ?? 0)
  const diff = Math.round((input.total - expected) * 100) / 100
  if (sum > 0 && Math.abs(diff) >= 0.01 && Math.abs(diff) < 1) return { subtotal: sum, roundOff: diff }
  if (sum > 0 && Math.abs(diff) < 0.01) return { subtotal: sum, roundOff: null }
  return { subtotal: input.storedSubtotal ?? sum, roundOff: null }
}
