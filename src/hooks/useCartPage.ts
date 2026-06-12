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
 *
 * Bug-fixes (third round):
 *
 *  13. [MEDIUM] applyCouponCode missing mountedRef guard.
 *      The setState / store-action calls inside applyCouponCode that execute
 *      after `await fetch(...)` — setCouponError, applyCoupon, setCouponCode,
 *      setCouponLoading (finally) — had no mountedRef guard. Fix 9 addressed
 *      the three background fetch effects, but applyCouponCode (a user-triggered
 *      async function) was missed. If the user navigates away while a coupon
 *      request is in-flight, all these setters fire on an unmounted component,
 *      producing React StrictMode warnings and potential state corruption on
 *      re-mount.
 *      Fix: check mountedRef.current before every setState/store call after the
 *      first await. The finally block also checks before setCouponLoading(false).
 *
 *  14. [PERF] Upsell fetch fires when the cart is empty.
 *      cartKey = '' when items is empty. On first render (pre-hydration) and
 *      on an empty-cart page, the effect still fired a request to
 *      /api/v1/cart-upsells?variantIds=&productIds= — a wasted round-trip that
 *      returns an empty list and triggers an unnecessary loading state.
 *      Fix: early-return in the upsell effect when itemsRef.current is empty.
 *      The effect will re-run once hydration lands and cartKey changes to a
 *      non-empty value.
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

  // ── Mounted guard (Fix 11 + Fix 13) ───────────────────────────────────────
  // Used to skip deferred setState calls after the component unmounts.
  // Fix 13: also guards applyCouponCode's post-await setState calls.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // addedUpsellRef always holds the latest addedUpsell array so handleUpsellAdd
  // can read it without listing `addedUpsell` as a useCallback dep.
  const addedUpsellRef = useRef(addedUpsell)
  useEffect(() => { addedUpsellRef.current = addedUpsell }, [addedUpsell])

  // ── Visible items (excludes pending removals) ─────────────────────────────
  //
  // BUG FIX: pricing/totalQty/progressPct were previously derived from the raw
  // `items` array, while cart/page.tsx rendered `visibleItems` (items minus
  // anything in `pendingRemovals`) for the "Your Items (N)" list.
  //
  // Repro: user clicks "Remove" on an item. handleRemove adds it to
  // pendingRemovals and shows an undo toast for 4 seconds — the item
  // immediately disappears from the "Your Items (N)" list (count drops,
  // e.g. 3 -> 2). But CartSummary's "Subtotal (N items)" and the sticky
  // bottom-bar total were still computed from the full `items` array, so
  // they continued to include that item's price/qty until the deferred
  // removeItem() actually fired 4 seconds later.
  //
  // Net effect: for ~4 seconds the page showed "Your Items (2)" on the left
  // while the order summary said "Subtotal (3 items) ₹XXX" on the right —
  // a directly visible self-contradiction, and the total shown to the user
  // didn't match the cart contents they could see.
  //
  // Fix: compute visibleItems here (single source of truth) and derive
  // pricing / totalQty / progressPct from it. cart/page.tsx now consumes
  // visibleItems from this hook instead of re-deriving it independently.
  const visibleItems = useMemo(
    () => items.filter(item => !pendingRemovals.has(item.variantId)),
    [items, pendingRemovals],
  )

  // ── Derived / memoised values ──────────────────────────────────────────────
  const pricing = useMemo(
    () => calcPriceSummary(visibleItems, settings as SiteSettings, coupon, 'cod'),
    [visibleItems, settings, coupon],
  )

  // Fix 7: destructure individual stable method references from useCartAnalytics.
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
    () => visibleItems.reduce((sum, i) => sum + i.qty, 0),
    [visibleItems],
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
  // Fix 8: only mark the ref done after we actually have a non-empty
  // lastAppliedCouponCode value, so the effect stays ready until hydration lands.
  const couponInitRef = useRef(false)
  useEffect(() => {
    if (couponInitRef.current) return
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
        if (ac.signal.aborted) return

        const ss = data.settings ?? {}
        setSettings(ss)

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
      })

    return () => ac.abort()
  }, [])

  // ── Coupon hints fetch ─────────────────────────────────────────────────────
  useEffect(() => {
    const ac = new AbortController()

    fetchWithRetry('/api/v1/coupon-hints', { signal: ac.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`coupon-hints ${r.status}`)))
      .then((data: { hints: Array<{code: string; label: string}> }) => {
        if (ac.signal.aborted) return
        setCouponHints(data.hints ?? [])
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return
        console.error('[useCartPage] coupon-hints fetch failed:', err)
      })

    return () => ac.abort()
  }, [])

  // ── Upsells fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Fix 14: skip the fetch entirely when the cart is empty.
    // cartKey is '' on an empty cart and during pre-hydration. Firing the
    // request with ?variantIds=&productIds= wastes a round-trip and triggers
    // a loading spinner the user will never see resolve into anything useful.
    // The effect will re-fire once cartKey becomes non-empty (after hydration
    // adds items to the store).
    if (!cartKey) {
      setUpsellLoading(false)
      setUpsellError(false)
      setUpsellItems([])
      return
    }

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
        if (ac.signal.aborted) return
        setUpsellItems(data.upsells ?? [])
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return
        console.error('[useCartPage] cart-upsells fetch failed:', err)
        setUpsellError(true)
      })
      .finally(() => {
        if (!ac.signal.aborted) setUpsellLoading(false)
      })

    return () => ac.abort()
  }, [cartKey])

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleQtyChange = useCallback((variantId: string, newQty: number, oldQty: number) => {
    const item = itemsRef.current.find(i => i.variantId === variantId)
    if (item) trackQuantityChanged(item.name, oldQty, newQty)
    setQtyAnim(a => ({ ...a, [variantId]: newQty > oldQty ? 'up' : 'down' }))
    updateQty(variantId, newQty)
    setTimeout(() => {
      if (mountedRef.current) setQtyAnim(a => ({ ...a, [variantId]: null }))
    }, 320)
  }, [updateQty, trackQuantityChanged])

  const handleRemove = useCallback((variantId: string, name: string, price: number) => {
    trackItemRemoved(name, price)
    const timerId = setTimeout(() => {
      removeItem(variantId)
      if (mountedRef.current) {
        setPendingRemovals(prev => {
          const next = new Map(prev)
          next.delete(variantId)
          return next
        })
      }
    }, 4000)
    setPendingRemovals(prev => {
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
  }, [addItem, trackUpsellAdded])

  // ── Shared coupon apply helper ─────────────────────────────────────────────
  // Fix 13: all post-await setState / store-action calls now check mountedRef.current
  // before firing. If the component unmounts while a coupon request is in-flight
  // (e.g. user navigates away), none of these setters reach a stale component.
  const applyCouponCode = useCallback(async (code: string) => {
    setCouponLoading(true)
    setCouponError('')
    try {
      const res  = await fetch('/api/v1/coupons', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code, subtotal: subtotalRef.current }),
      })
      // Guard: component may have unmounted while the request was in-flight.
      if (!mountedRef.current) return
      const data = await res.json()
      if (!mountedRef.current) return
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
      if (!mountedRef.current) return
      const reason = e instanceof Error ? e.message : 'network_error'
      setCouponError('Failed to apply coupon')
      trackCouponError(code, reason)
    } finally {
      // Guard the finally block too — it always runs, even after early returns.
      if (mountedRef.current) setCouponLoading(false)
    }
  }, [applyCoupon, trackCouponApplied, trackCouponError])

  const handleCoupon = useCallback(async () => {
    const trimmed = couponCode.trim().toUpperCase()
    if (!trimmed) return
    await applyCouponCode(trimmed)
  }, [couponCode, applyCouponCode])

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
    visibleItems,
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
