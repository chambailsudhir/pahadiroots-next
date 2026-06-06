'use client'

/**
 * useCartPage — all cart page state, data-fetching, and handlers in one place.
 *
 * Fixes applied (original round):
 *
 *   1. God-component smell — was 9 separate useState calls in page.tsx.
 *      All local state now lives here; page.tsx becomes a pure render shell.
 *
 *   2. `{} as SiteSettings` unsafe cast replaced with `Partial<SiteSettings>`.
 *      State is correctly typed as a partial from the start; the cast to the
 *      full type only happens at the pricingService call-site where defaults
 *      for missing keys already exist inside calcPriceSummary.
 *
 *   3. First eslint-disable (coupon pre-fill effect) removed.
 *      An initialisation ref guards the one-shot run so all true deps can be
 *      listed without causing the effect to fire on every coupon update.
 *
 *   4. Second eslint-disable (cartFingerprint effect) removed.
 *      An itemsRef always holds the latest items array, so the fetch effect
 *      can read it without listing `items` as a dep — only the stable string
 *      fingerprint (cartKey) appears in the dep array.
 *
 *   5. RawVariant / RawProduct / RawImage moved to src/types/store-data.ts.
 *
 *   6. SRP: now fetches from /api/v1/cart-settings and /api/v1/cart-upsells
 *      instead of the monolithic /api/v1/store-data.
 *
 * Bug-fixes (second round):
 *
 *   7. [CRITICAL] analytics object instability — useCartAnalytics returns a
 *      new plain-object literal on every render. Every useCallback that listed
 *      `analytics` as a dep was therefore recreated on every render, defeating
 *      React.memo on CartItemCard and CartSummary entirely.
 *      Fix: destructure the individual stable method references directly from
 *      useCartAnalytics. Each method is a useCallback(fn,[]) internally, so
 *      the references are stable for the lifetime of the hook.
 *
 *   8. [LOGIC] couponInitRef marks itself done before hydration completes.
 *      StoreHydrator uses setTimeout(0) so the first effect run always sees
 *      lastAppliedCouponCode = '' (pre-hydration). The ref was set to true
 *      immediately, so when hydration fires and the dep changes the effect
 *      returned early — coupon pre-fill never worked.
 *      Fix: only mark the ref done after we have a non-empty
 *      lastAppliedCouponCode, so the effect stays ready until hydration lands.
 *
 *   9. [MEDIUM] Missing ac.signal.aborted guard in .then() setState calls.
 *      The .finally() guard prevented setUpsellLoading on unmounted components
 *      but the preceding .then() blocks still called setSettings /
 *      setCouponHints / setUpsellItems unconditionally.
 *      Fix: added `if (ac.signal.aborted) return` at the top of every .then()
 *      handler that calls setState.
 *
 *  10. [UX] handleApplyHint set couponCode with the original (possibly
 *      lowercase) code while applyCouponCode applied the uppercased version.
 *      On a coupon error the input showed a lowercase code, visually
 *      inconsistent with the server-normalised error message.
 *      Fix: uppercase the code before both setCouponCode and applyCouponCode.
 *
 *  11. [MINOR] setQtyAnim (320 ms) and setPendingRemovals (4 000 ms) setTimeout
 *      callbacks fired on unmounted components when the user navigated away
 *      mid-countdown, causing StrictMode warnings.
 *      Fix: mountedRef guards all deferred setState calls.
 *
 *  12. [PERF] handleUpsellAdd listed `addedUpsell` (a state array) as a
 *      useCallback dep. Every upsell add changes addedUpsell → recreates
 *      handleUpsellAdd → busts UpsellSection's React.memo on every tap, even
 *      though UpsellSection's props didn't change in any meaningful way.
 *      Fix: addedUpsellRef mirrors addedUpsell via a sync useEffect. The
 *      callback reads addedUpsellRef.current at call-time (always fresh) and
 *      no longer lists addedUpsell as a dep, making it stable for the lifetime
 *      of the hook — the same pattern already used for itemsRef and subtotalRef.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useCartStore }       from '@/store/cartStore'
import { calcPriceSummary }   from '@/lib/services/pricingService'
import { useCartAnalytics }   from '@/hooks/useCheckoutAnalytics'
import type { SiteSettings, UpsellItem } from '@/types'

// ─── Retry helper ─────────────────────────────────────────────────────────────
// Retries a fetch up to `maxRetries` times on network / 5xx errors with
// exponential back-off.  4xx errors (bad request, not-found) are NOT retried.
// AbortErrors are never retried — they propagate immediately so the caller's
// .catch() can filter them out and avoid setState on unmounted components.
async function fetchWithRetry(
  input: RequestInfo,
  init?: RequestInit,
  maxRetries = 2,
): Promise<Response> {
  let attempt = 0
  while (true) {
    // Bail out immediately if already aborted before the fetch begins
    if (init?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const res = await fetch(input, init)
    if (res.ok || res.status < 500 || attempt >= maxRetries) return res
    attempt++
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 300 * 2 ** attempt) // 600 ms, 1200 ms
      // Cancel the back-off wait if aborted mid-retry
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })
  }
}

// ─── Fallback reviews ─────────────────────────────────────────────────────────
// Defined at module level — not recreated on every render.
const FALLBACK_REVIEWS: CartReview[] = [
  { name: 'Priya M.',  location: 'Delhi',     text: "Best quality rice I've ever had. Pure taste!" },
  { name: 'Rahul S.',  location: 'Mumbai',    text: 'Authentic Pahadi flavours, delivered fresh.'   },
  { name: 'Anita K.',  location: 'Bangalore', text: "Love the ghee — just like dadi's kitchen."    },
]

export interface CartReview {
  name: string
  location: string
  text: string
}

// ─────────────────────────────────────────────────────────────────────────────

export function useCartPage() {

  // ── Cart store ─────────────────────────────────────────────────────────────
  const items               = useCartStore(s => s.items)
  const coupon              = useCartStore(s => s.coupon)
  const applyCoupon         = useCartStore(s => s.applyCoupon)
  const removeCoupon        = useCartStore(s => s.removeCoupon)
  const removeItem          = useCartStore(s => s.removeItem)
  const updateQty           = useCartStore(s => s.updateQty)
  const addItem             = useCartStore(s => s.addItem)
  const lastAppliedCouponCode = useCartStore(s => s.lastAppliedCouponCode)

  // ── Local state ────────────────────────────────────────────────────────────
  const [couponCode,      setCouponCode]      = useState('')
  const [couponLoading,   setCouponLoading]   = useState(false)
  const [couponError,     setCouponError]     = useState('')
  const [couponHints,     setCouponHints]     = useState<Array<{code: string; label: string}>>([])

  const [upsellItems,     setUpsellItems]     = useState<UpsellItem[]>([])
  const [upsellLoading,   setUpsellLoading]   = useState(true)
  const [upsellError,     setUpsellError]     = useState(false)
  const [addedUpsell,     setAddedUpsell]     = useState<string[]>([])

  const [reviews,         setReviews]         = useState<CartReview[]>(FALLBACK_REVIEWS)
  const [qtyAnim,         setQtyAnim]         = useState<Record<string, 'up' | 'down' | null>>({})

  const [settings, setSettings] = useState<Partial<SiteSettings>>({})

  const [pendingRemovals, setPendingRemovals] = useState<
    Map<string, { name: string; timerId: ReturnType<typeof setTimeout> }>
  >(new Map())

  // ── Mounted guard (Fix 11) ─────────────────────────────────────────────────
  // Used to skip deferred setState calls (setQtyAnim, setPendingRemovals) after
  // the component unmounts. The removeItem Zustand action is intentionally NOT
  // guarded — it should still fire so the item is actually removed from cart
  // after the 4-second undo window expires regardless of where the user navigated.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // addedUpsellRef always holds the latest addedUpsell array so handleUpsellAdd
  // can read it without listing `addedUpsell` as a useCallback dep.
  // Without this, every upsell add recreates handleUpsellAdd (because addedUpsell
  // changes), which invalidates UpsellSection's React.memo on every add tap.
  const addedUpsellRef = useRef(addedUpsell)
  useEffect(() => { addedUpsellRef.current = addedUpsell }, [addedUpsell])

  // ── Derived / memoised values ──────────────────────────────────────────────
  const pricing = useMemo(
    () => calcPriceSummary(items, settings as SiteSettings, coupon, 'cod'),
    [items, settings, coupon],
  )

  // Fix 7: destructure individual stable method references from useCartAnalytics.
  // useCartAnalytics returns a new plain-object literal on every render, so
  // listing `analytics` as a useCallback dep caused every callback to recreate
  // on every render, defeating React.memo on CartItemCard and CartSummary.
  // Each method is a useCallback(fn, []) internally — destructuring gives us the
  // stable references we can safely list as deps without the wrapping object churn.
  const {
    trackUpsellAdded,
    trackItemRemoved,
    trackQuantityChanged,
    trackCouponApplied,
    trackCouponError,
  } = useCartAnalytics({ itemCount: items.length, subtotal: pricing.subtotal })

  const freeShipMin = useMemo(
    () => parseFloat(settings.free_shipping_min ?? '0') || 0,
    [settings.free_shipping_min],
  )

  const progressPct = useMemo(
    () => freeShipMin > 0
      ? Math.min(100, (pricing.progressBase / freeShipMin) * 100)
      : 100,
    [freeShipMin, pricing.progressBase],
  )

  const totalQty = useMemo(
    () => items.reduce((sum, i) => sum + i.qty, 0),
    [items],
  )

  // ── Stable cart fingerprint ────────────────────────────────────────────────
  // A sorted string of variantIds that only changes when items are added or
  // removed — NOT when quantities change. Used as the sole dep for the upsell
  // fetch effect so +/− taps never trigger a refetch.
  const cartKey = useMemo(
    () => items.map(i => i.variantId).sort().join(','),
    [items],
  )

  // itemsRef always holds the latest items so the fetch effect can read IDs
  // without listing `items` as a dependency.
  const itemsRef = useRef(items)
  useEffect(() => { itemsRef.current = items })

  // subtotalRef always holds the latest subtotal so applyCouponCode reads the
  // live value at call-time rather than the captured value from the last render.
  const subtotalRef = useRef(pricing.subtotal)
  useEffect(() => { subtotalRef.current = pricing.subtotal }, [pricing.subtotal])

  // ── Coupon pre-fill (runs once after store hydrates) ──────────────────────
  // Fix 8: the original code set couponInitRef.current = true unconditionally on
  // the first effect run. Because StoreHydrator uses setTimeout(0) to rehydrate,
  // the first run always saw lastAppliedCouponCode = '' (pre-hydration). The ref
  // was marked done immediately, so the effect returned early when hydration
  // fired and the dep changed — coupon pre-fill silently never worked.
  //
  // Fix: only mark the ref done after we actually have a non-empty
  // lastAppliedCouponCode value, so the effect stays ready until hydration lands.
  const couponInitRef = useRef(false)
  useEffect(() => {
    if (couponInitRef.current) return
    // Not hydrated yet — wait for the next dep change when the store rehydrates.
    if (!lastAppliedCouponCode) return
    couponInitRef.current = true
    if (!coupon) {
      setCouponCode(lastAppliedCouponCode)
    }
  }, [lastAppliedCouponCode, coupon])

  // ── Settings + reviews fetch ───────────────────────────────────────────────
  useEffect(() => {
    const ac = new AbortController()

    fetchWithRetry('/api/v1/cart-settings', { signal: ac.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`cart-settings ${r.status}`)))
      .then((data: { settings: Partial<SiteSettings> }) => {
        // Fix 9: guard against setState on unmounted component.
        // The .finally() guard in the upsells fetch prevented setUpsellLoading
        // after unmount, but the preceding .then() blocks here (and in the other
        // two fetches) had no equivalent guard.
        if (ac.signal.aborted) return

        const ss = data.settings ?? {}
        setSettings(ss)

        // Build live reviews from settings keys, falling back to module constants
        const dbRevs = ([1, 2, 3] as const)
          .map(n => ({
            name:     String(ss[`review_${n}_name`     as keyof SiteSettings] ?? '') || FALLBACK_REVIEWS[n - 1].name,
            location: String(ss[`review_${n}_location` as keyof SiteSettings] ?? '') || FALLBACK_REVIEWS[n - 1].location,
            text:     String(ss[`review_${n}_text`     as keyof SiteSettings] ?? '') || FALLBACK_REVIEWS[n - 1].text,
          }))
          .filter(r => r.name && r.text)

        if (dbRevs.length > 0) setReviews(dbRevs)
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return
        console.error('[useCartPage] cart-settings fetch failed:', err)
        // settings stay as {} — pricing service handles missing keys with defaults
      })

    return () => ac.abort()
  }, []) // settings are stable for the session lifetime; fetch once

  // ── Coupon hints fetch ─────────────────────────────────────────────────────
  useEffect(() => {
    const ac = new AbortController()

    fetchWithRetry('/api/v1/coupon-hints', { signal: ac.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`coupon-hints ${r.status}`)))
      .then((data: { hints: Array<{code: string; label: string}> }) => {
        // Fix 9 (continued): guard before setState.
        if (ac.signal.aborted) return
        setCouponHints(data.hints ?? [])
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return
        // Non-fatal — hints are a UX enhancement, not required for checkout
        console.error('[useCartPage] coupon-hints fetch failed:', err)
      })

    return () => ac.abort()
  }, [])

  // ── Upsells fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    const ac = new AbortController()
    const current    = itemsRef.current
    const variantIds = current.map(i => i.variantId).join(',')
    const productIds = [...new Set(current.map(i => i.productId))].join(',')
    const params     = new URLSearchParams({ variantIds, productIds })

    setUpsellLoading(true)
    setUpsellError(false)

    fetchWithRetry(`/api/v1/cart-upsells?${params}`, { signal: ac.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`cart-upsells ${r.status}`)))
      .then((data: { upsells: UpsellItem[] }) => {
        // Fix 9 (continued): guard before setState.
        if (ac.signal.aborted) return
        setUpsellItems(data.upsells ?? [])
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return
        console.error('[useCartPage] cart-upsells fetch failed:', err)
        setUpsellError(true)
      })
      .finally(() => {
        // Guard: don't update loading state if the effect was cleaned up
        if (!ac.signal.aborted) setUpsellLoading(false)
      })

    return () => ac.abort()
  }, [cartKey]) // stable primitive — no suppression needed

  // ── Handlers ───────────────────────────────────────────────────────────────

  // Fix 7: deps now reference the stable destructured analytics methods instead
  // of the `analytics` object, so these callbacks are stable for the lifetime of
  // the hook and do not invalidate CartItemCard / CartSummary memoisation.

  const handleQtyChange = useCallback((variantId: string, newQty: number, oldQty: number) => {
    const item = itemsRef.current.find(i => i.variantId === variantId)
    if (item) trackQuantityChanged(item.name, oldQty, newQty)
    setQtyAnim(a => ({ ...a, [variantId]: newQty > oldQty ? 'up' : 'down' }))
    updateQty(variantId, newQty)
    // Fix 11: guard the deferred setState so it doesn't fire on an unmounted
    // component if the user navigates away within the 320 ms animation window.
    setTimeout(() => {
      if (mountedRef.current) setQtyAnim(a => ({ ...a, [variantId]: null }))
    }, 320)
  }, [updateQty, trackQuantityChanged])
  // mountedRef is intentionally excluded from deps — it is a ref (stable object)
  // and mountedRef.current is always the latest value at call-time.

  const handleRemove = useCallback((variantId: string, name: string, price: number) => {
    trackItemRemoved(name, price)
    const timerId = setTimeout(() => {
      // removeItem (Zustand action) is intentionally NOT guarded by mountedRef.
      // The item must be removed after the undo window regardless of navigation.
      removeItem(variantId)
      // Fix 11: guard only the React state update — Zustand is fine to call
      // from any context, but setState on an unmounted component is noisy.
      if (mountedRef.current) {
        setPendingRemovals(prev => {
          const next = new Map(prev)
          next.delete(variantId)
          return next
        })
      }
    }, 4000)
    setPendingRemovals(prev => {
      // Clear any existing timer for this variant (double-tap guard)
      const existing = prev.get(variantId)
      if (existing) clearTimeout(existing.timerId)
      return new Map(prev).set(variantId, { name, timerId })
    })
  }, [removeItem, trackItemRemoved])

  const handleUndoRemove = useCallback((variantId: string) => {
    setPendingRemovals(prev => {
      const entry = prev.get(variantId)
      if (!entry) return prev
      clearTimeout(entry.timerId)
      const next = new Map(prev)
      next.delete(variantId)
      return next
    })
  }, [])

  const handleUpsellAdd = useCallback((p: UpsellItem) => {
    // Read the latest addedUpsell via ref — avoids listing `addedUpsell` as a dep,
    // which would recreate this callback on every add and bust UpsellSection.memo.
    if (addedUpsellRef.current.includes(p.id)) return
    addItem({
      productId:   p.productId,
      variantId:   p.id,
      name:        p.name,
      slug:        p.slug,
      image:       p.image,
      emoji:       p.emoji,
      size:        p.size,
      price:       p.price,
      mrp:         p.mrp,
      gstRate:     p.gstRate,
      maxQty:      p.maxQty,
      isOrganic:    p.isOrganic    ?? false,
      isHimalayan:  p.isHimalayan  ?? false,
      isBestseller: p.isBestseller ?? false,
    })
    trackUpsellAdded(p.name, p.price)
    setAddedUpsell(a => [...a, p.id])
  // addedUpsellRef is intentionally excluded from deps — it's a ref (stable object),
  // and addedUpsellRef.current is always the latest value at call-time.
  }, [addItem, trackUpsellAdded])

  // ── Shared coupon apply helper ─────────────────────────────────────────────
  const applyCouponCode = useCallback(async (code: string) => {
    setCouponLoading(true)
    setCouponError('')
    try {
      const res  = await fetch('/api/v1/coupons', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code, subtotal: subtotalRef.current }),
      })
      const data = await res.json()
      if (!res.ok) {
        const reason = data.error ?? 'invalid'
        setCouponError(reason)
        trackCouponError(code, reason)
        return
      }
      applyCoupon(data.coupon)
      trackCouponApplied(data.coupon.code, data.coupon.discount)
      setCouponCode('')
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : 'network_error'
      setCouponError('Failed to apply coupon')
      trackCouponError(code, reason)
    } finally {
      setCouponLoading(false)
    }
  }, [applyCoupon, trackCouponApplied, trackCouponError])
  // subtotalRef is intentionally excluded from deps — it's a ref (stable object),
  // and subtotalRef.current is always the latest value at call-time.

  const handleCoupon = useCallback(async () => {
    const trimmed = couponCode.trim().toUpperCase()
    if (!trimmed) return
    await applyCouponCode(trimmed)
  }, [couponCode, applyCouponCode])

  // Fix 10: both setCouponCode and applyCouponCode now receive the uppercased
  // code. Previously setCouponCode used the original (possibly lowercase) code
  // while applyCouponCode uppercased it. On a coupon error the input showed a
  // lowercase code inconsistent with the server-normalised error message.
  const handleApplyHint = useCallback((code: string) => {
    const upper = code.toUpperCase()
    setCouponCode(upper)
    void applyCouponCode(upper)
  }, [applyCouponCode])

  const handleRemoveCoupon = useCallback(() => {
    removeCoupon()
    setCouponCode('')
    setCouponError('')
  }, [removeCoupon])

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    // cart store slices
    items,
    coupon,
    removeCoupon: handleRemoveCoupon,

    // coupon input
    couponCode,
    setCouponCode,
    couponLoading,
    couponError,
    couponHints,

    // upsells
    upsellItems,
    upsellLoading,
    upsellError,
    addedUpsell,

    // reviews & settings
    reviews,
    settings,

    // ui state
    qtyAnim,
    pendingRemovals,

    // derived
    freeShipMin,
    pricing,
    progressPct,
    totalQty,

    // handlers
    handleQtyChange,
    handleRemove,
    handleUndoRemove,
    handleUpsellAdd,
    handleCoupon,
    handleApplyHint,
  } as const
}
