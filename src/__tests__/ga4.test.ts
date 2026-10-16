// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { writeConsent } from '@/lib/consent'
import {
  cartItemsToGa4, ga4AddToCart, ga4BeginCheckout, ga4Event, ga4Purchase, ga4RemoveFromCart, ga4Search, ga4ViewCart, ga4ViewItem, itemsValue, toGa4Item,
} from '@/lib/analytics/ga4'

const w = window as any
let gtag: ReturnType<typeof vi.fn>
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); gtag = vi.fn(); w.gtag = gtag; delete w.dataLayer })

const honey = { productId: 1, variantId: 1, name: 'Himalayan Wild Manali Honey', variant: '250g', price: 388.54, quantity: 2, category: 'Himalayan Honey' }

describe('consent gating', () => {
  it('sends NOTHING before analytics consent, and nothing after a rejection', () => {
    expect(ga4AddToCart(honey)).toBe(false); expect(ga4Purchase({ transactionId: 'A1', value: 1, items: [honey] })).toBe(false)
    writeConsent(false); gtag.mockClear()
    expect(ga4ViewItem(honey)).toBe(false); expect(gtag).not.toHaveBeenCalled()
  })
  it('sends once analytics consent is granted', () => {
    writeConsent(true); gtag.mockClear()
    expect(ga4Search('honey')).toBe(true)
    expect(gtag).toHaveBeenCalledWith('event', 'search', { search_term: 'honey' })
  })
  it('does nothing (no throw) when gtag is not loaded', () => {
    writeConsent(true); delete w.gtag
    expect(() => ga4Event('x')).not.toThrow(); expect(ga4Event('x')).toBe(false)
  })
})

describe('GA4 recommended-event payloads', () => {
  beforeEach(() => { writeConsent(true); gtag.mockClear() })
  it('add_to_cart: INR, value = price x quantity, item shape', () => {
    ga4AddToCart(honey)
    expect(gtag).toHaveBeenCalledWith('event', 'add_to_cart', {
      currency: 'INR', value: 777.08,
      items: [{ item_id: '1', item_name: 'Himalayan Wild Manali Honey', item_category: 'Himalayan Honey', item_variant: '250g', price: 388.54, quantity: 2 }],
    })
  })
  it('remove_from_cart, view_item, view_cart and begin_checkout use the standard names', () => {
    ga4RemoveFromCart(honey); ga4ViewItem(honey); ga4ViewCart([honey, { ...honey, productId: 2, name: 'Ghee', price: 100, quantity: 1 }]); ga4BeginCheckout([honey], 'WELCOME50')
    const names = gtag.mock.calls.map(c => c[1])
    expect(names).toEqual(['remove_from_cart', 'view_item', 'view_cart', 'begin_checkout'])
    expect(gtag.mock.calls[2][2].value).toBe(877.08)
    expect(gtag.mock.calls[3][2].coupon).toBe('WELCOME50')
  })
  it('toGa4Item sanitises: id fallback, qty >= 1, rounding, no stray fields', () => {
    expect(toGa4Item({ variantId: 7, name: 'X', price: 10.005, quantity: 0 })).toEqual({ item_id: '7', item_name: 'X', price: 10.01, quantity: 1 })
    expect(itemsValue([toGa4Item({ productId: 1, name: 'A', price: 99.99, quantity: 3 })])).toBe(299.97)
  })
  it('cartItemsToGa4 maps cart lines', () => {
    expect(cartItemsToGa4([{ productId: '1', variantId: '9', name: 'N', size: '500g', price: 5, qty: 3 }])).toEqual([{ productId: '1', variantId: '9', name: 'N', variant: '500g', price: 5, quantity: 3 }])
  })
})

describe('purchase', () => {
  beforeEach(() => { writeConsent(true); gtag.mockClear() })
  const order = { transactionId: 'ORD-2026-00200', value: 1200, tax: 57.14, shipping: 99, items: [honey] }
  it('sends transaction_id, value, tax, shipping and items', () => {
    expect(ga4Purchase(order)).toBe(true)
    const [, name, p] = gtag.mock.calls[0]
    expect(name).toBe('purchase')
    expect(p).toMatchObject({ transaction_id: 'ORD-2026-00200', currency: 'INR', value: 1200, tax: 57.14, shipping: 99 })
    expect(p.items).toHaveLength(1)
  })
  it('is sent only ONCE per order (refresh-safe)', () => {
    expect(ga4Purchase(order)).toBe(true); expect(ga4Purchase(order)).toBe(false)
    expect(gtag).toHaveBeenCalledTimes(1)
  })
  it('skips an order with no id or no items, and never carries personal data', () => {
    expect(ga4Purchase({ ...order, transactionId: '' })).toBe(false); expect(ga4Purchase({ ...order, items: [] })).toBe(false)
    ga4Purchase({ ...order, transactionId: 'Z9' })
    expect(JSON.stringify(gtag.mock.calls[0][2])).not.toMatch(/phone|email|address|customer/i)
  })
})
