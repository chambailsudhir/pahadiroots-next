// ─────────────────────────────────────────────────────────────────────────────
// lib/analytics/ga4.ts — Google Analytics 4 e-commerce events.
//
// Uses the names and parameter shapes of GA4's "recommended events" for retail
// (view_item, add_to_cart, begin_checkout, purchase, …) so Google's built-in
// Monetization / Funnel reports work with no custom setup. Rules every helper follows:
//   • nothing is sent unless the visitor granted analytics consent (lib/consent.ts)
//   • currency is always INR; `value` is what the customer pays (tax-inclusive)
//   • item_id is the catalogue product id (the same id on every page and event, so reports join up);
//     the pack size goes in item_variant; item_name is the product name
//   • never throws into the caller; no-ops on the server
//   • `purchase` is sent once per order (sessionStorage guard) so a refresh can't double revenue
// Personal data (name, phone, email, address) is NEVER put in any event.
// ─────────────────────────────────────────────────────────────────────────────

import { hasAnalyticsConsent } from '@/lib/consent'

export const GA_CURRENCY = 'INR'

export interface Ga4Item {
  item_id: string
  item_name: string
  item_category?: string
  item_variant?: string
  price: number
  quantity: number
  currency?: string
  index?: number
  item_list_id?: string
  item_list_name?: string
  coupon?: string
}

export interface ItemInput {
  productId?: string | number
  variantId?: string | number
  name: string
  category?: string | null
  variant?: string | null
  price: number
  quantity?: number
}

const num = (n: unknown): number => {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0
}

export function toGa4Item(i: ItemInput, extra: Partial<Ga4Item> = {}): Ga4Item {
  const out: Ga4Item = {
    item_id: String(i.productId ?? i.variantId ?? ''),
    item_name: String(i.name ?? '').slice(0, 100),
    price: num(i.price),
    quantity: Math.max(1, Math.floor(Number(i.quantity ?? 1)) || 1),
    ...extra,
  }
  if (i.category) out.item_category = String(i.category).slice(0, 100)
  if (i.variant) out.item_variant = String(i.variant).slice(0, 100)
  return out
}

export const itemsValue = (items: Ga4Item[]): number => num(items.reduce((s, i) => s + i.price * i.quantity, 0))

type Gtag = (...args: unknown[]) => void

/** Low-level send. Returns whether the event was handed to gtag. */
export function ga4Event(name: string, params: Record<string, unknown> = {}): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (!hasAnalyticsConsent()) return false
    const gtag = (window as unknown as { gtag?: Gtag }).gtag
    if (typeof gtag !== 'function') return false
    gtag('event', name, params)
    return true
  } catch {
    return false
  }
}

const withItems = (items: Ga4Item[], extra: Record<string, unknown> = {}) =>
  ({ currency: GA_CURRENCY, value: itemsValue(items), items, ...extra })

export const ga4ViewItem = (item: ItemInput) => { const it = [toGa4Item(item)]; return ga4Event('view_item', withItems(it)) }
export const ga4AddToCart = (item: ItemInput) => { const it = [toGa4Item(item)]; return ga4Event('add_to_cart', withItems(it)) }
export const ga4RemoveFromCart = (item: ItemInput) => { const it = [toGa4Item(item)]; return ga4Event('remove_from_cart', withItems(it)) }
export const ga4AddToWishlist = (item: ItemInput) => { const it = [toGa4Item(item)]; return ga4Event('add_to_wishlist', withItems(it)) }
export const ga4SelectItem = (item: ItemInput, listName?: string, index?: number) =>
  ga4Event('select_item', { item_list_name: listName, items: [toGa4Item(item, { item_list_name: listName, index })] })
export const ga4ViewCart = (items: ItemInput[]) => { const it = items.map(i => toGa4Item(i)); return ga4Event('view_cart', withItems(it)) }
export const ga4BeginCheckout = (items: ItemInput[], coupon?: string) => { const it = items.map(i => toGa4Item(i)); return ga4Event('begin_checkout', withItems(it, coupon ? { coupon } : {})) }
export const ga4AddPaymentInfo = (items: ItemInput[], paymentType: 'cod' | 'razorpay' | string, coupon?: string) => {
  const it = items.map(i => toGa4Item(i)); return ga4Event('add_payment_info', withItems(it, { payment_type: paymentType, ...(coupon ? { coupon } : {}) }))
}
export const ga4Search = (term: string) => ga4Event('search', { search_term: String(term).slice(0, 100) })

export interface PurchaseInput {
  transactionId: string
  items: ItemInput[]
  /** Amount charged to the customer, tax-inclusive. */
  value: number
  tax?: number
  shipping?: number
  coupon?: string
}

const PURCHASE_KEY = 'hv_ga_purchase:'

/** Sends `purchase` once per order id; returns false when skipped (no consent, no gtag, duplicate, empty). */
export function ga4Purchase(p: PurchaseInput): boolean {
  if (typeof window === 'undefined' || !p.transactionId || !p.items?.length) return false
  try {
    if (window.sessionStorage.getItem(PURCHASE_KEY + p.transactionId)) return false
  } catch { /* storage blocked: still send, GA also dedupes on transaction_id */ }
  const items = p.items.map(i => toGa4Item(i))
  const sent = ga4Event('purchase', {
    transaction_id: String(p.transactionId),
    currency: GA_CURRENCY,
    value: num(p.value),
    tax: num(p.tax ?? 0),
    shipping: num(p.shipping ?? 0),
    ...(p.coupon ? { coupon: p.coupon } : {}),
    items,
  })
  if (sent) { try { window.sessionStorage.setItem(PURCHASE_KEY + p.transactionId, '1') } catch { /* ignore */ } }
  return sent
}

/** Cart lines (store/cartStore CartItem) -> GA4 item inputs. */
export function cartItemsToGa4(items: ReadonlyArray<{ productId: string; variantId: string; name: string; size?: string; price: number; qty: number }>): ItemInput[] {
  return items.map(i => ({ productId: i.productId, variantId: i.variantId, name: i.name, variant: i.size, price: i.price, quantity: i.qty }))
}
