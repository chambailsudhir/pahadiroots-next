'use client'

/**
 * useCartPage — all cart page state, data-fetching, and handlers in one place.
 *
 * Fixes applied:
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
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useCartStore }       from '@/store/cartStore'
import { calcPriceSummary }   from '@/lib/services/pricingService'
import { useCartAnalytics }   from '@/hooks/useCheckoutAnalytics'
import type { SiteSettings, UpsellItem } from '@/types'

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
  // Fix 1: previously 9 separate useState calls scattered across page.tsx.

  const [couponCode,      setCouponCode]      = useState('')
  const [couponLoading,   setCouponLoading]   = useState(false)
  const [couponError,     setCouponError]     = useState('')

  const [upsellItems,     setUpsellItems]     = useState<UpsellItem[]>([])
  const [upsellLoading,   setUpsellLoading]   = useState(true)
  const [upsellError,     setUpsellError]     = useState(false)
  const [addedUpsell,     setAddedUpsell]     = useState<string[]>([])

  const [reviews,         setReviews]         = useState<CartReview[]>(FALLBACK_REVIEWS)
  const [qtyAnim,         setQtyAnim]         = useState<Record<string, 'up' | 'down' | null>>({})

  // Fix 2: was `useState<SiteSettings>({} as SiteSettings)` — an unsafe cast
  // that bypasses TypeScript's required-field checks. Partial<SiteSettings> is
  // the honest type: we start with nothing and fill in as the fetch resolves.
  const [settings, setSettings] = useState<Partial<SiteSettings>>({})

  const [pendingRemovals, setPendingRemovals] = useState<
    Map<string, { name: string; timerId: ReturnType<typeof setTimeout> }>
  >(new Map())

  // ── Derived / memoised values ──────────────────────────────────────────────
  // Pass settings as SiteSettings — calcPriceSummary has fallback defaults for
  // every key it reads, so a partially-filled object is safe here.
  const pricing = useMemo(
    () => calcPriceSummary(items, settings as SiteSettings, coupon, 'cod'),
    [items, settings, coupon],
  )

  const analytics = useCartAnalytics({ itemCount: items.length, subtotal: pricing.subtotal })

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

  // Fix 4 (part A): a ref always holds the latest items so the fetch effect
  // can read IDs without listing `items` as a dependency.
  const itemsRef = useRef(items)
  useEffect(() => { itemsRef.current = items })

  // ── Coupon pre-fill (runs once after store hydrates) ──────────────────────
  // Fix 3: was using eslint-disable-next-line react-hooks/exhaustive-deps.
  // A one-shot ref lets us safely list all real dependencies — no suppression.
  const couponInitRef = useRef(false)
  useEffect(() => {
    if (couponInitRef.current) return
    couponInitRef.current = true
    if (lastAppliedCouponCode && !coupon) {
      setCouponCode(lastAppliedCouponCode)
    }
  }, [lastAppliedCouponCode, coupon])

  // ── Settings + reviews fetch ───────────────────────────────────────────────
  // Fix 6 (SRP): previously part of the monolithic store-data fetch.
  // Now a dedicated lightweight endpoint — ~15 keys instead of the full table.
  useEffect(() => {
    fetch('/api/v1/cart-settings')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`cart-settings ${r.status}`)))
      .then((data: { settings: Partial<SiteSettings> }) => {
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
        console.error('[useCartPage] cart-settings fetch failed:', err)
        // settings stay as {} — pricing service handles missing keys with defaults
      })
  }, []) // settings are stable for the session lifetime; fetch once

  // ── Upsells fetch ──────────────────────────────────────────────────────────
  // Fix 4 (part B): was using eslint-disable-next-line react-hooks/exhaustive-deps
  // because `items` was accessed inside but not listed in deps.
  // Now: itemsRef provides current item IDs without needing `items` as a dep.
  // The effect only re-runs when cartKey changes (item added/removed).
  //
  // Fix 6 (SRP): now calls /api/v1/cart-upsells — a targeted query (~80 variants
  // with exclusion filter) instead of fetching all 500 products via store-data.
  useEffect(() => {
    const current    = itemsRef.current
    const variantIds = current.map(i => i.variantId).join(',')
    const productIds = [...new Set(current.map(i => i.productId))].join(',')
    const params     = new URLSearchParams({ variantIds, productIds })

    setUpsellLoading(true)
    setUpsellError(false)

    fetch(`/api/v1/cart-upsells?${params}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`cart-upsells ${r.status}`)))
      .then((data: { upsells: UpsellItem[] }) => setUpsellItems(data.upsells ?? []))
      .catch((err: unknown) => {
        console.error('[useCartPage] cart-upsells fetch failed:', err)
        setUpsellError(true)
      })
      .finally(() => setUpsellLoading(false))
  }, [cartKey]) // stable primitive — no suppression needed

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleQtyChange = useCallback((variantId: string, newQty: number, oldQty: number) => {
    const item = itemsRef.current.find(i => i.variantId === variantId)
    if (item) analytics.trackQuantityChanged(item.name, oldQty, newQty)
    setQtyAnim(a => ({ ...a, [variantId]: newQty > oldQty ? 'up' : 'down' }))
    updateQty(variantId, newQty)
    setTimeout(() => setQtyAnim(a => ({ ...a, [variantId]: null })), 320)
  }, [updateQty, analytics])

  const handleRemove = useCallback((variantId: string, name: string, price: number) => {
    analytics.trackItemRemoved(name, price)
    const timerId = setTimeout(() => {
      removeItem(variantId)
      setPendingRemovals(prev => {
        const next = new Map(prev)
        next.delete(variantId)
        return next
      })
    }, 4000)
    setPendingRemovals(prev => {
      // Clear any existing timer for this variant (double-tap guard)
      const existing = prev.get(variantId)
      if (existing) clearTimeout(existing.timerId)
      return new Map(prev).set(variantId, { name, timerId })
    })
  }, [removeItem, analytics])

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
    if (addedUpsell.includes(p.id)) return
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
    analytics.trackUpsellAdded(p.name, p.price)
    setAddedUpsell(a => [...a, p.id])
  }, [addedUpsell, addItem, analytics])

  const handleCoupon = useCallback(async () => {
    if (!couponCode.trim()) return
    setCouponLoading(true)
    setCouponError('')
    try {
      const res  = await fetch('/api/v1/coupons', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          code:     couponCode.trim().toUpperCase(),
          subtotal: pricing.subtotal,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setCouponError(data.error ?? 'Invalid coupon'); return }
      applyCoupon(data.coupon)
      setCouponCode('')
    } catch {
      setCouponError('Failed to apply coupon')
    } finally {
      setCouponLoading(false)
    }
  }, [couponCode, pricing.subtotal, applyCoupon])

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    // cart store slices
    items,
    coupon,
    removeCoupon,

    // coupon input
    couponCode,
    setCouponCode,
    couponLoading,
    couponError,

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
  } as const
}
