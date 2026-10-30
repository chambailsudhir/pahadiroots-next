/**
 * reportCardAddToCart — card-level add-to-cart must reach GA4 + the in-house tracker (audit HOME-032),
 * and must never throw into the purchase flow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ga4AddToCart = vi.fn()
const trackAddToCart = vi.fn()
vi.mock('@/lib/analytics/ga4', () => ({ ga4AddToCart: (...a: unknown[]) => ga4AddToCart(...a) }))
vi.mock('@/lib/analytics/track', () => ({ trackAddToCart: (...a: unknown[]) => trackAddToCart(...a) }))

import { reportCardAddToCart } from '@/lib/analytics/cartEvents'

beforeEach(() => { vi.clearAllMocks() })

describe('reportCardAddToCart', () => {
  it('sends a GA4 add_to_cart item and an in-house event with the card source', () => {
    reportCardAddToCart({ id: 7, name: 'Wild Honey', price: 350, variantId: 12 }, 'product_card')
    expect(ga4AddToCart).toHaveBeenCalledWith({ productId: 7, variantId: 12, name: 'Wild Honey', price: 350, quantity: 1 })
    expect(trackAddToCart).toHaveBeenCalledWith(7, 12, 'product_card')
  })

  it('passes undefined (not NaN) when the variant id is missing or not numeric', () => {
    reportCardAddToCart({ id: 7, name: 'x', price: 1 }, 'region_card')
    reportCardAddToCart({ id: 7, name: 'x', price: 1, variantId: 'abc' }, 'quick_view')
    expect(trackAddToCart).toHaveBeenNthCalledWith(1, 7, undefined, 'region_card')
    expect(trackAddToCart).toHaveBeenNthCalledWith(2, 7, undefined, 'quick_view')
  })

  it('never throws into the cart flow when a tracker blows up — and still tries the other one', () => {
    ga4AddToCart.mockImplementationOnce(() => { throw new Error('gtag blocked') })
    trackAddToCart.mockImplementationOnce(() => { throw new Error('beacon failed') })
    expect(() => reportCardAddToCart({ id: 1, name: 'a', price: 2, variantId: 3 }, 'product_card')).not.toThrow()
    expect(trackAddToCart).toHaveBeenCalledTimes(1)
  })
})
