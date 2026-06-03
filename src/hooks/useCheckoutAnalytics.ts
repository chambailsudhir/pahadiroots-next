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

interface EventPayload {
  [key: string]: string | number | boolean | undefined
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
  const startTime      = useRef(Date.now())

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
