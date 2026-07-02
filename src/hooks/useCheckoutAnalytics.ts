'use client'

/**
 * useCheckoutAnalytics — lightweight checkout funnel tracker
 *
 * Works with ANY analytics provider by firing events through a single
 * dispatch function. Currently wires to:
 *   1. window.gtag (Google Analytics 4) — if GA is loaded in layout
 *   2. window.dataLayer (GTM) — if GTM is loaded
 *   3. Console in development — always visible for debugging
 *
 * To add Mixpanel / PostHog / Amplitude: add a case in `dispatch()`.
 * No provider decision is forced — drop in whichever SDK you prefer.
 *
 * EVENTS TRACKED:
 *   checkout_started         — user lands on /checkout with items
 *   coupon_applied           — coupon code successfully applied
 *   coupon_error             — invalid coupon attempted
 *   payment_method_changed   — switched between COD / Razorpay
 *   address_autofilled       — pincode API returned city/state
 *   order_placed             — COD order confirmed
 *   payment_initiated        — Razorpay modal opened
 *   payment_verified         — Razorpay payment verified
 *   checkout_abandoned       — user leaves page without ordering
 *   shipping_threshold_hit   — free shipping unlocked
 *
 * CART EVENTS:
 *   cart_viewed              — user lands on /cart with items
 *   upsell_added             — upsell product added to cart
 *   item_removed             — item removed from cart
 *   quantity_changed         — item qty changed
 *
 * PDP EVENTS (BUG FIX – HIGH, audit finding #4: no PDP conversion tracking
 * existed anywhere in the codebase — no view_item/add_to_cart events fired,
 * so there was no funnel data and no Meta/Google Ads remarketing audience):
 *   view_item                — product page viewed
 *   add_to_cart               — Add to Cart / Buy Now pressed on the PDP
 */

import { useEffect, useRef, useCallback } from 'react'

type AnalyticsEvent =
  | 'checkout_started'
  | 'coupon_applied'
  | 'coupon_error'
  | 'payment_method_changed'
  | 'address_autofilled'
  | 'order_placed'
  | 'payment_initiated'
  | 'payment_verified'
  | 'checkout_abandoned'
  | 'shipping_threshold_hit'
  | 'cart_viewed'
  | 'upsell_added'
  | 'item_removed'
  | 'quantity_changed'
  | 'view_item'
  | 'add_to_cart'

/** GA4 Enhanced-Ecommerce line item shape (view_item / add_to_cart). */
interface GA4Item {
  item_id:        string
  item_name:      string
  item_category?: string
  price:          number
  quantity:       number
}

interface EventPayload {
  [key: string]: string | number | boolean | undefined | GA4Item[]
}

/** Typed extension of Window for analytics SDKs loaded via CDN snippets. */
interface AnalyticsWindow extends Window {
  gtag?:      (...args: unknown[]) => void
  dataLayer?: Record<string, unknown>[]
  posthog?:   { capture: (event: string, props?: Record<string, unknown>) => void }
  mixpanel?:  { track:   (event: string, props?: Record<string, unknown>) => void }
}

function dispatch(event: AnalyticsEvent, payload: EventPayload = {}) {
  const isDev = process.env.NODE_ENV === 'development'

  // Always log in dev
  if (isDev) {
    console.groupCollapsed(`[Analytics] ${event}`)
    console.table(payload)
    console.groupEnd()
  }

  // Google Analytics 4
  if (typeof window !== 'undefined') {
    const win = window as AnalyticsWindow
    if (typeof win.gtag === 'function') {
      win.gtag('event', event, payload)
    }
    // Google Tag Manager
    if (Array.isArray(win.dataLayer)) {
      win.dataLayer.push({ event, ...payload })
    }
    // PostHog — if loaded via their CDN snippet
    if (win.posthog?.capture) {
      win.posthog.capture(event, payload)
    }
    // Mixpanel — if loaded via their CDN snippet
    if (win.mixpanel?.track) {
      win.mixpanel.track(event, payload)
    }
  }
}

// ─── Checkout funnel hook ─────────────────────────────────────────────────────
interface CheckoutAnalyticsOptions {
  itemCount:    number
  subtotal:     number
  payMethod:    'cod' | 'razorpay'
  isFreeShipping: boolean
}

export function useCheckoutAnalytics({
  itemCount, subtotal, payMethod, isFreeShipping,
}: CheckoutAnalyticsOptions) {
  const startedRef     = useRef(false)
  const prevPayMethod  = useRef(payMethod)
  const prevFreeShip   = useRef(isFreeShipping)
  // BUG FIX (React 19 / react-hooks/purity lint rule): Date.now() is impure
  // — calling it as a useRef initializer means it executes on every render
  // even though React only keeps the result from the very first call. The
  // initial value here is never actually read: the only read-site (in
  // handleUnload below) is gated by startedRef.current, which only becomes
  // true inside the effect that also overwrites startTime.current right
  // after — so by the time it's ever read, it's always already been set to
  // a real timestamp. A pure literal is therefore a safe, fully
  // behavior-equivalent replacement.
  const startTime      = useRef(0)

  // Fire checkout_started once
  useEffect(() => {
    if (startedRef.current || itemCount === 0) return
    startedRef.current = true
    dispatch('checkout_started', { item_count: itemCount, subtotal, currency: 'INR' })
    startTime.current = Date.now()
  }, [itemCount, subtotal])

  // Track payment method changes
  useEffect(() => {
    if (!startedRef.current) return
    if (prevPayMethod.current !== payMethod) {
      dispatch('payment_method_changed', { from: prevPayMethod.current, to: payMethod })
      prevPayMethod.current = payMethod
    }
  }, [payMethod])

  // Track free shipping threshold hit
  useEffect(() => {
    if (!prevFreeShip.current && isFreeShipping) {
      dispatch('shipping_threshold_hit', { subtotal, currency: 'INR' })
    }
    prevFreeShip.current = isFreeShipping
  }, [isFreeShipping, subtotal])

  // Track checkout_abandoned on page unload
  useEffect(() => {
    function handleUnload() {
      if (!startedRef.current) return
      const timeSpentSec = Math.round((Date.now() - startTime.current) / 1000)
      dispatch('checkout_abandoned', {
        item_count: itemCount,
        subtotal,
        time_spent_sec: timeSpentSec,
        payment_method: payMethod,
      })
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [itemCount, subtotal, payMethod])

  const trackCouponApplied = useCallback((code: string, discount: number) => {
    dispatch('coupon_applied', { coupon_code: code, discount_amount: discount, currency: 'INR' })
  }, [])

  const trackCouponError = useCallback((code: string, reason: string) => {
    dispatch('coupon_error', { coupon_code: code, reason })
  }, [])

  const trackOrderPlaced = useCallback((orderNumber: string, total: number, method: string) => {
    dispatch('order_placed', { order_number: orderNumber, total, method, currency: 'INR' })
  }, [])

  const trackPaymentInitiated = useCallback((total: number) => {
    dispatch('payment_initiated', { total, currency: 'INR' })
  }, [])

  const trackPaymentVerified = useCallback((orderNumber: string, total: number) => {
    dispatch('payment_verified', { order_number: orderNumber, total, currency: 'INR' })
  }, [])

  const trackAddressAutofilled = useCallback((pincode: string, city: string, state: string) => {
    dispatch('address_autofilled', { pincode, city, state })
  }, [])

  return {
    trackCouponApplied,
    trackCouponError,
    trackOrderPlaced,
    trackPaymentInitiated,
    trackPaymentVerified,
    trackAddressAutofilled,
  }
}

// ─── Cart funnel hook ─────────────────────────────────────────────────────────
interface CartAnalyticsOptions {
  itemCount: number
  subtotal:  number
}

export function useCartAnalytics({ itemCount, subtotal }: CartAnalyticsOptions) {
  const viewedRef = useRef(false)

  // Fire cart_viewed once
  useEffect(() => {
    if (viewedRef.current || itemCount === 0) return
    viewedRef.current = true
    dispatch('cart_viewed', { item_count: itemCount, subtotal, currency: 'INR' })
  }, [itemCount, subtotal])

  const trackUpsellAdded = useCallback((productName: string, price: number) => {
    dispatch('upsell_added', { product_name: productName, price, currency: 'INR' })
  }, [])

  const trackItemRemoved = useCallback((productName: string, price: number) => {
    dispatch('item_removed', { product_name: productName, price, currency: 'INR' })
  }, [])

  const trackQuantityChanged = useCallback((productName: string, oldQty: number, newQty: number) => {
    dispatch('quantity_changed', { product_name: productName, old_qty: oldQty, new_qty: newQty })
  }, [])

  const trackCouponApplied = useCallback((code: string, discount: number) => {
    dispatch('coupon_applied', { coupon_code: code, discount_amount: discount, currency: 'INR' })
  }, [])

  const trackCouponError = useCallback((code: string, reason: string) => {
    dispatch('coupon_error', { coupon_code: code, reason })
  }, [])

  return { trackUpsellAdded, trackItemRemoved, trackQuantityChanged, trackCouponApplied, trackCouponError }
}

// ─── PDP funnel hook (BUG FIX – HIGH, audit finding #4) ───────────────────────
// There was a real, well-built analytics pipeline (this file) wired only into
// checkout/cart — view_item and add_to_cart were never fired anywhere,
// including on the actual Add to Cart button. Without these there's no PDP
// funnel data, no Meta/Google Ads remarketing audiences, and no way to measure
// add-to-cart rate per product.
export interface PDPAnalyticsItem {
  itemId:    string
  itemName:  string
  category?: string
  price:     number
}

export function usePDPAnalytics(item: PDPAnalyticsItem | null) {
  const viewedRef = useRef(false)

  // Fire view_item once per product mount
  useEffect(() => {
    if (viewedRef.current || !item) return
    viewedRef.current = true
    dispatch('view_item', {
      currency: 'INR',
      value:    item.price,
      items: [{
        item_id:       item.itemId,
        item_name:     item.itemName,
        item_category: item.category,
        price:         item.price,
        quantity:      1,
      }],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.itemId])

  const trackAddToCart = useCallback((it: PDPAnalyticsItem, quantity: number) => {
    dispatch('add_to_cart', {
      currency: 'INR',
      value:    it.price * quantity,
      items: [{
        item_id:       it.itemId,
        item_name:     it.itemName,
        item_category: it.category,
        price:         it.price,
        quantity,
      }],
    })
  }, [])

  return { trackAddToCart }
}
