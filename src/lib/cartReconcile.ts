// ─────────────────────────────────────────────────────────────────────────────
// lib/cartReconcile.ts — C1 (pure; no store, no fetch)
//
// Applies the server's live view of each cart line (/api/v1/cart/validate) to the
// cart held in localStorage:
//   • unavailable / out of stock → line removed
//   • fewer units in stock than the cart holds → quantity reduced
//   • price changed → price (and mrp) refreshed
//   • stock known → maxQty restored (it is deliberately never persisted, so after a
//     reload addItem/updateQty would otherwise fall back to a blind default — C3)
// ─────────────────────────────────────────────────────────────────────────────
import type { CartItem } from '@/types'

export type LineStatus = 'ok' | 'unavailable' | 'out_of_stock' | 'insufficient_stock'

export interface LiveLineDTO {
  productId: string
  variantId: string
  status:    LineStatus
  name:      string
  price:     number
  mrp:       number
  available: number
}

export type CartChange =
  | { type: 'removed';       variantId: string; name: string; reason: 'unavailable' | 'out_of_stock' }
  | { type: 'qty_reduced';   variantId: string; name: string; from: number; to: number }
  | { type: 'price_changed'; variantId: string; name: string; from: number; to: number }

const money = (n: number) => `₹${Number.isInteger(n) ? n : n.toFixed(2)}`

export function reconcileCartLines(
  items: CartItem[],
  lines: LiveLineDTO[],
): { items: CartItem[]; changes: CartChange[] } {
  const byVariant = new Map(lines.map(l => [String(l.variantId), l]))
  const changes: CartChange[] = []
  const next: CartItem[] = []

  for (const item of items) {
    const line = byVariant.get(String(item.variantId))
    if (!line || String(line.productId) !== String(item.productId)) { next.push(item); continue }   // not covered → leave alone

    if (line.status === 'unavailable' || line.status === 'out_of_stock') {
      changes.push({ type: 'removed', variantId: item.variantId, name: item.name, reason: line.status })
      continue
    }

    let updated: CartItem = { ...item, maxQty: line.available }

    // Judged against the quantity the cart holds NOW (the customer may have edited it
    // after the request was sent), not the quantity the server was asked about.
    if (item.qty > line.available) {
      changes.push({ type: 'qty_reduced', variantId: item.variantId, name: item.name, from: item.qty, to: line.available })
      updated = { ...updated, qty: line.available }
    }

    if (Number(line.price) > 0 && Number(line.price) !== Number(item.price)) {
      changes.push({ type: 'price_changed', variantId: item.variantId, name: item.name, from: Number(item.price), to: Number(line.price) })
      updated = { ...updated, price: Number(line.price), mrp: Number(line.mrp) || Number(line.price) }
    } else if (Number(line.mrp) > 0 && Number(line.mrp) !== Number(item.mrp)) {
      updated = { ...updated, mrp: Number(line.mrp) }   // display-only: not worth interrupting the customer
    }

    next.push(updated)
  }
  return { items: next, changes }
}

/** One human sentence per change, for the notice shown to the customer. */
export function describeCartChanges(changes: CartChange[]): string[] {
  return changes.map(c => {
    switch (c.type) {
      case 'removed':
        return c.reason === 'out_of_stock'
          ? `${c.name} is out of stock and was removed from your cart.`
          : `${c.name} is no longer available and was removed from your cart.`
      case 'qty_reduced':
        return `Only ${c.to} of ${c.name} ${c.to === 1 ? 'is' : 'are'} in stock — quantity changed from ${c.from} to ${c.to}.`
      case 'price_changed':
        return `The price of ${c.name} changed from ${money(c.from)} to ${money(c.to)}.`
    }
  })
}
