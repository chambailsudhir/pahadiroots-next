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
 *      Fix (superseded by Fix 15 below): originally addedUpsellRef mirrored
 *      addedUpsell via a sync useEffect so the callback could read a fresh
 *      value without listing addedUpsell as a dep.
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
 *
 * Bug-fixes (fourth round):
 *
 *  15. [STATE DESYNC — CRITICAL] `addedUpsell` was a standalone, append-only
 *      `useState<string[]>([])` that was NEVER reconciled with the cart.
 *      handleUpsellAdd pushed `p.id` onto it and it was never removed.
 *
 *      Repro: add an upsell product to the cart -> its card shows "✓" and is
 *      disabled. Now remove that same item from the cart (Remove button +
 *      4s undo-timeout removal, or clearCart at checkout, or it simply drops
 *      out of items for any reason). The item is gone from `items`, but
 *      `addedUpsell` still contains its id — UpsellSection still renders "✓"
 *      / disabled for that product, even across an upsell refetch (cartKey
 *      changes and re-fetches the suggestion list, but addedUpsell — a
 *      separate piece of state — survives unchanged). The user can no longer
 *      re-add a product they don't have in their cart via the upsell rail.
 *
 *      Fix: `addedUpsell` is now DERIVED from `items` (`items.map(i =>
 *      i.variantId)`), since handleUpsellAdd always uses `p.id` as the cart
 *      item's `variantId`. "Added" status is therefore always a live
 *      reflection of the cart — add it, see "✓"; remove it by any code path,
 *      the card automatically reverts to "+ Add". The old addedUpsellRef
 *      sync-effect is replaced by itemVariantIdsRef (same stable-callback
 *      pattern, now sourced from `items` instead of the removed state).
 *
 * Bug-fixes (fifth round — cart performance pass):
 *
 *  16. [PERF] `addedUpsell` (Fix 15) derived directly from `items`, which gets
 *      a brand-new array reference on EVERY cart mutation — including pure
 *      qty +/- taps (updateQty does `state.items.map(i => i.variantId === id
 *      ? {...i, qty} : i)`, a new array even though the variantId SET is
 *      unchanged). Every qty +/- click therefore produced a new `addedUpsell`
 *      array, busting UpsellSection's React.memo and re-rendering its whole
 *      grid (up to 4 product cards + <Image>s) for no reason.
 *      Fix: `addedUpsell` is now derived from `cartKey` (already memoized to
 *      change only when the variantId SET changes) via `cartKey.split(',')`,
 *      restoring a stable reference across qty-only updates. `cartKey`'s
 *      useMemo was moved above `addedUpsell` to support this.
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
  // Shared exponential-backoff wait, cancellable via the same AbortSignal
  // the caller passed in. Factored out so both the network-error path and
  // the 5xx-response path use identical timing/cancellation behavior.
  const backoff = (attempt: number) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 300 * 2 ** attempt) // 600 ms, 1200 ms
    // Cancel the back-off wait if aborted mid-retry
    init?.signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })

  let attempt = 0
  while (true) {
    // Bail out immediately if already aborted before the fetch begins
    if (init?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    try {
      const res = await fetch(input, init)
      if (res.ok || res.status < 500 || attempt >= maxRetries) return res
      attempt++
      await backoff(attempt)
    } catch (err) {
      // BUG FIX [ERROR HANDLING]: this catch block did not exist before — a
      // genuine network-level failure (offline, DNS failure, connection
      // reset, CORS error — i.e. fetch() REJECTING rather than resolving
      // with a 5xx status) propagated immediately with zero retry, despite
      // this function's own docstring promising "Retries ... on network /
      // 5xx errors". Only the less common HTTP-5xx-response case was ever
      // actually retried. The more common real-world case — a mobile user's
      // connection blipping mid-request — bypassed retry entirely and went
      // straight to the caller's fallback/error state. Now genuine network
      // errors get the same exponential-backoff retry treatment as 5xx
      // responses, up to maxRetries.
      //
      // AbortError is intentional cancellation (component unmounted, or a
      // newer request superseded this one) — it must still propagate
      // immediately rather than being retried.
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      if (attempt >= maxRetries) throw err
      attempt++
      await backoff(attempt)
    }
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

  const [reviews,         setReviews]         = useState<CartReview[]>(FALLBACK_REVIEWS)
  const [qtyAnim,         setQtyAnim]         = useState<Record<string, 'up' | 'down' | null>>({})

  const [settings, setSettings] = useState<Partial<SiteSettings>>({})

  const [pendingRemovals, setPendingRemovals] = useState<
    Map<string, { name: string; timerId: ReturnType<typeof setTimeout> }>
  >(new Map())

  // Mirrors `pendingRemovals` so flushPendingRemovals can read the current
  // keys AFTER calling setPendingRemovals, without listing `pendingRemovals`
  // itself as a useCallback dep (same stable-callback pattern as itemsRef /
  // subtotalRef / itemVariantIdsRef elsewhere in this file).
  const pendingRemovalsRef = useRef(pendingRemovals)
  useEffect(() => { pendingRemovalsRef.current = pendingRemovals }, [pendingRemovals])

  // ── Mounted guard (Fix 11 + Fix 13) ───────────────────────────────────────
  // Used to skip deferred setState calls after the component unmounts.
  // Fix 13: also guards applyCouponCode's post-await setState calls.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── Stable cart fingerprint ────────────────────────────────────────────────
  // A sorted string of variantIds that only changes when items are added or
  // removed — NOT when quantities change. Used as the sole dep for the upsell
  // fetch effect so +/− taps never trigger a refetch, and (below) as the basis
  // for `addedUpsell` so qty-only changes don't bust UpsellSection's memo either.
  const cartKey = useMemo(
    () => items.map(i => i.variantId).sort().join(','),
    [items],
  )

  // ── addedUpsell (derived, not standalone state) ───────────────────────────
  //
  // BUG FIX: addedUpsell used to be its own `useState<string[]>([])`, appended
  // to (never removed from) every time handleUpsellAdd fired. Once a user
  // added an upsell product to the cart, its card stayed permanently marked
  // "✓ Added" / disabled in UpsellSection — even if the user later removed
  // that exact item from the cart (Remove button, undo-timeout removal,
  // clearCart, or the item dropping out of a refreshed upsell list and being
  // re-suggested later). The user had no way to re-add a product they no
  // longer had in their cart, because addedUpsell never reconciled with the
  // actual cart contents.
  //
  // handleUpsellAdd uses `p.id` as the cart item's `variantId` (see addItem
  // call below), so "is this upsell item in the cart" is exactly
  // `items.some(i => i.variantId === p.id)`. Deriving addedUpsell from the
  // cart makes the UI always reflect the true cart state — add it, see "✓";
  // remove it (by any path), the card goes back to "+ Add" automatically.
  //
  // PERF FIX: this used to derive directly from `items`
  // (`items.map(i => i.variantId)`). `items` gets a brand-new array reference
  // on EVERY cart store mutation — including pure qty +/- taps, where
  // updateQty does `state.items.map(i => i.variantId === id ? {...i, qty} : i)`.
  // So every qty +/- click produced a brand-new `addedUpsell` array (same
  // string contents, new reference) → UpsellSection's `addedIds` prop changed
  // reference → React.memo on UpsellSection bailed out → the entire upsell
  // grid (up to 4 cards + their <Image>s) re-rendered on every qty tap, even
  // though which products are "in the cart" hadn't actually changed.
  //
  // Fix: derive from `cartKey` instead — a sorted, comma-joined string of
  // variantIds that's memoized to only change when the variantId SET changes
  // (items added/removed), not when an existing item's qty changes. Splitting
  // that string back into an array gives the same membership information as
  // before, but with a stable reference across qty-only updates, so
  // UpsellSection no longer re-renders on +/- taps.
  const addedUpsell = useMemo(
    () => cartKey ? cartKey.split(',') : [],
    [cartKey],
  )

  // itemVariantIdsRef always holds the latest set of cart variantIds so
  // handleUpsellAdd can check membership without listing `items` (or the
  // derived `addedUpsell`) as a useCallback dep — same stable-callback
  // pattern as itemsRef / subtotalRef / addedUpsellRef previously used.
  const itemVariantIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    itemVariantIdsRef.current = new Set(items.map(i => i.variantId))
  }, [items])

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

  // DATA INTEGRITY BUG FIX: pending removals weren't flushed before checkout.
  //
  // handleRemove hides an item from `visibleItems` immediately (so "Your
  // Items (N)", CartSummary's subtotal, and the sticky bar all update at
  // once — see the visibleItems BUG FIX above) but defers the actual
  // `removeItem()` store call for 4 seconds to allow Undo. That 4-second
  // timer is a plain setTimeout, independent of this component's lifecycle.
  //
  // "Proceed to Checkout" (CartSummary) and the sticky "Checkout" CTA
  // (StickyCartCTA) are plain <Link href="/checkout"> with no handler. If a
  // user clicks Remove and immediately proceeds to checkout (well within the
  // 4-second window), `cartStore.items` STILL contains the "removed" item —
  // useCheckoutPage reads `items` directly (not visibleItems), so:
  //
  //   - Checkout's pricing.total INCLUDES an item the cart page just showed
  //     as removed (the cart page displayed a lower total moments earlier —
  //     a direct, visible inconsistency between the two pages).
  //   - If the user places the order before the 4s timer fires, the order
  //     includes an item they explicitly removed.
  //   - If they don't, the timer fires mid-checkout, removeItem() mutates
  //     the shared store, and the checkout page's items/pricing change out
  //     from under the user while they're filling in their address.
  //
  // Fix: flush every pending removal synchronously — clear each timer and
  // call removeItem() immediately — before navigating to /checkout. Wired as
  // an onClick on both checkout links (see CartSummary.tsx, CartUIComponents.tsx).
  // After this runs, cartStore.items === visibleItems, so checkout starts
  // from exactly what the cart page displayed.
  // BUG FIX [REACT PURITY]: the previous version called removeItem(variantId)
  // — a side effect mutating a DIFFERENT store (cartStore) — directly inside
  // the setPendingRemovals updater function. React requires updater functions
  // passed to setState to be pure; calling another store's setState from
  // inside one fires "Cannot update a component while rendering a different
  // component" and, more importantly, is unsafe under React 18 strict mode /
  // concurrent rendering, where an updater function may be invoked more than
  // once (e.g. for offscreen pre-rendering) — which would call removeItem()
  // twice for the same variantId.
  // Fix: read `prev` out of the updater (pure, no side effects), then run the
  // removeItem side effects AFTER setPendingRemovals has been called, not from
  // inside its updater.
  const flushPendingRemovals = useCallback(() => {
    setPendingRemovals(prev => {
      if (prev.size === 0) return prev
      for (const entry of prev.values()) clearTimeout(entry.timerId)
      return new Map()
    })
    for (const variantId of pendingRemovalsRef.current.keys()) {
      removeItem(variantId)
    }
  }, [removeItem])

  const handleUpsellAdd = useCallback((p: UpsellItem) => {
    if (itemVariantIdsRef.current.has(p.id)) return
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
  }, [addItem, trackUpsellAdded])

  // ── Coupon revalidation tracking ───────────────────────────────────────────
  // Tracks the subtotal value the currently-applied coupon's discount was last
  // validated against. Seeded by applyCouponCode on a successful manual apply
  // (so the revalidation effect below doesn't immediately re-fire for the
  // subtotal that was just validated), and read/updated by that effect.
  const lastValidatedSubtotalRef = useRef<number | null>(null)

  // ── Shared coupon apply helper ─────────────────────────────────────────────
  // Fix 13: all post-await setState / store-action calls now check mountedRef.current
  // before firing. If the component unmounts while a coupon request is in-flight
  // (e.g. user navigates away), none of these setters reach a stale component.
  const applyCouponCode = useCallback(async (code: string) => {
    setCouponLoading(true)
    setCouponError('')
    // DATA INTEGRITY BUG FIX: capture the subtotal THIS REQUEST is validated
    // against, before the await. Previously `lastValidatedSubtotalRef.current`
    // was set to `subtotalRef.current` AFTER the await — i.e. whatever the
    // subtotal happened to be when the response arrived, not the subtotal the
    // server actually computed `data.coupon.discount` for.
    //
    // Repro: subtotal = ₹1000 when Apply is clicked → request sent with
    // subtotal=1000 → server returns discount=100 (10% of 1000). While the
    // request is in flight, the user bumps a qty so pricing.subtotal becomes
    // ₹1500. On response, applyCoupon sets discount=100 (still for ₹1000),
    // but the old code then set lastValidatedSubtotalRef.current = 1500 (the
    // POST-await value) — which now happens to equal pricing.subtotal (1500).
    // The revalidation effect's guard `lastValidatedSubtotalRef.current ===
    // pricing.subtotal` is true, so it SKIPS revalidation — the stale ₹100
    // discount (computed for a ₹1000 cart) is permanently displayed against
    // the ₹1500 cart with no re-check.
    //
    // Fix: seed the ref with the subtotal the request was actually sent for.
    // If the cart changed mid-flight, this value will differ from the current
    // pricing.subtotal, so the revalidation effect fires on its next run and
    // recomputes the discount for the cart's true current subtotal.
    const requestSubtotal = subtotalRef.current
    try {
      const res  = await fetch('/api/v1/coupons', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code, subtotal: requestSubtotal }),
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
      // Seed revalidation tracking with the subtotal this discount was just
      // computed against (request-time, not response-time — see comment
      // above), so the revalidation effect doesn't immediately re-fire a
      // redundant request for that same subtotal, but DOES fire if the cart
      // changed while this request was in flight.
      lastValidatedSubtotalRef.current = requestSubtotal
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


  // ── Coupon revalidation on subtotal change ─────────────────────────────────
  //
  // BUG FIX [STATE DESYNC]: `coupon.discount` is a frozen ₹ amount computed by
  // validateCouponServer() at the moment the coupon was applied — for
  // percent-type coupons it's `round(subtotal_at_apply_time * percent / 100)`,
  // capped by the coupon's (server-only) max_discount. Nothing in the client
  // ever recomputed it afterwards.
  //
  // Repro: apply a 10% coupon on a ₹1000 cart -> coupon.discount = 100.
  // Then change quantities:
  //   - Remove items so subtotal drops to ₹400. CartSummary still shows
  //     "Discount (CODE) −₹100" and Total = afterDiscount + shipping, where
  //     afterDiscount = max(0, 400 - 100) = 300 — a stale 25%-equivalent
  //     discount being displayed as if the coupon were still "10% off ₹400".
  //     If the coupon also has min_order (say ₹500), the coupon is now
  //     INVALID but the UI keeps showing it applied with a discount, right up
  //     until the order-creation step on the server rejects it — the user
  //     only discovers their coupon doesn't apply at the final step.
  //   - Add items so subtotal rises to ₹3000. coupon.discount is still ₹100
  //     (10% of the OLD ₹1000), so the user effectively gets ~3.3% off
  //     instead of the 10% the coupon code implies — understating savings.
  //
  // Fix: whenever `pricing.subtotal` changes while a coupon is applied,
  // silently re-POST /api/v1/coupons with the new subtotal (debounced, since
  // the route is rate-limited to 5/min/IP — see coupons/route.ts). On success,
  // applyCoupon() is called again with the freshly recomputed discount, so
  // coupon.discount always reflects the current cart. On failure (min_order no
  // longer met, coupon expired, usage limit hit since it was applied), the
  // coupon is removed via removeCoupon() and a user-facing message explains
  // why — instead of silently showing a number that checkout will reject.
  //
  // Guards:
  //   - Skipped entirely when no coupon is applied (coupon === null).
  //   - Skipped while a manual apply/hint request is in flight (couponLoading)
  //     to avoid two concurrent /api/v1/coupons calls racing each other.
  //   - Skipped when pricing.subtotal <= 0 — see "ghost subtotal" bug fix below.
  //   - lastValidatedSubtotalRef avoids re-validating against a subtotal we've
  //     already confirmed (e.g. effect re-running due to an unrelated dep
  //     change without subtotal actually moving).
  //   - mountedRef guards every post-await setState/store call, matching the
  //     pattern used by applyCouponCode.
  //
  // DATA INTEGRITY BUG FIX [GHOST SUBTOTAL]: `pricing.subtotal` is derived from
  // `visibleItems` (items minus anything in `pendingRemovals`), NOT `items`.
  //
  // Repro: a coupon is applied to a single-item cart. The user clicks "Remove"
  // on that item. handleRemove immediately adds it to `pendingRemovals` (for
  // the 4 s Undo toast) WITHOUT calling cartStore.removeItem() yet — so
  // `items` (and therefore `coupon`, which cartStore only nulls out once
  // `items` itself becomes empty — see removeItem/clearCart) is still
  // non-empty, but `visibleItems` is now `[]`, so `pricing.subtotal` is 0.
  //
  // This effect re-runs (pricing.subtotal changed), `coupon` is still
  // non-null, so after the debounce it POSTs `{ subtotal: 0 }` to
  // /api/v1/coupons. validateCouponSchema requires `subtotal` to be positive,
  // so the request fails with a generic 400 "Invalid request". The `!ok`
  // branch below then calls removeCoupon() — wiping `coupon` AND
  // `lastAppliedCouponCode` — even though the cart isn't actually empty. If
  // the user then clicks "Undo" within the 4 s window, `visibleItems` /
  // `pricing.subtotal` revert to their prior values, but the coupon the user
  // applied is permanently gone and must be manually re-entered.
  //
  // A *real* (non-transient) subtotal of 0 can't reach this branch: cartStore
  // sets `coupon: null` the instant `items` becomes empty, so `coupon !== null`
  // guarantees `items.length > 0` and therefore a positive subtotal under
  // normal pricing. `pricing.subtotal <= 0` while `coupon` is still set is
  // therefore always this transient pending-removal ("ghost") state.
  //
  // Fix: skip silently (without touching lastValidatedSubtotalRef) when
  // pricing.subtotal <= 0. The effect re-fires once `visibleItems` is
  // non-empty again — either because the user clicked Undo (subtotal returns
  // to its prior, already-validated value, so the ref comparison below
  // correctly suppresses a redundant call) or because the 4 s timer elapsed
  // and `items` truly emptied (in which case `coupon` is already null and the
  // first guard above handles it).
  useEffect(() => {
    if (!coupon) {
      lastValidatedSubtotalRef.current = null
      return
    }
    if (couponLoading) return
    if (pricing.subtotal <= 0) return
    if (lastValidatedSubtotalRef.current === pricing.subtotal) return

    const ac = new AbortController()
    const timer = setTimeout(() => {
      lastValidatedSubtotalRef.current = pricing.subtotal
      fetchWithRetry('/api/v1/coupons', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: coupon.code, subtotal: pricing.subtotal }),
        signal:  ac.signal,
      }, /* maxRetries */ 1)
        .then(r => r.json().then(data => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
          if (ac.signal.aborted || !mountedRef.current) return
          if (!ok) {
            // Coupon no longer valid for the new subtotal (min_order, expiry,
            // usage limit). Remove it so the UI never shows a discount the
            // server would reject at checkout, and surface why.
            removeCoupon()
            setCouponError(data.error ?? 'Coupon no longer applies to your updated cart')
            return
          }
          // Re-apply with the recomputed discount for the current subtotal.
          // Only update if the discount actually changed, to avoid an
          // unnecessary store write (and re-render) when it didn't.
          if (data.coupon.discount !== coupon.discount) {
            applyCoupon(data.coupon)
          }
        })
        .catch((err: unknown) => {
          if ((err as { name?: string }).name === 'AbortError') return
          // Network/server error revalidating — leave the existing coupon
          // and discount as-is rather than removing a possibly-still-valid
          // coupon on a transient failure. The server re-validates again at
          // order creation regardless.
          console.error('[useCartPage] coupon revalidation failed:', err)
        })
    }, 800) // debounced — coalesces rapid +/- taps into one revalidation call

    return () => {
      clearTimeout(timer)
      ac.abort()
    }
  }, [coupon, pricing.subtotal, couponLoading, applyCoupon, removeCoupon])

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
    flushPendingRemovals,
    handleUpsellAdd,
    handleCoupon,
    handleApplyHint,
  } as const
}
