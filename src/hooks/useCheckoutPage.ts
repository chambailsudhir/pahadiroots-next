'use client'

/**
 * useCheckoutPage — all CheckoutClient state, effects, and handlers extracted
 * into a single custom hook.
 *
 * Architecture fix:
 *   CheckoutClient.tsx had 17+ inline useState calls and all associated effects
 *   and handler functions living directly in the component body — a god-component
 *   anti-pattern flagged in the enterprise audit (React Architecture domain, −2 pts).
 *   Extracting into this hook reduces CheckoutClient.tsx to a pure render shell,
 *   matching the pattern already established for CartPage / useCartPage.
 *
 * Bug fixes carried in from the original CheckoutClient:
 *   • applyCouponCode / handleApplyCouponHint: no mountedRef guard for
 *     post-await setState calls (same class of bug as useCartPage Fix 13).
 *     Added mountedRef checks before every setState/store-action after await.
 *   • All effects already had AbortController cleanup — preserved as-is.
 */

import {
  useState, useEffect, useCallback, useMemo, useRef,
} from 'react'
import { useRouter }            from 'next/navigation'
import { useCartStore, selectHasHydrated } from '@/store/cartStore'
import { useUserStore }         from '@/store/userStore'
import { calcPriceSummary }     from '@/lib/services/pricingService'
import { useCheckoutAnalytics } from '@/hooks/useCheckoutAnalytics'
import {
  readProfileCache  as _readProfileCache,
  writeProfileCache as _writeProfileCache,
} from '@/lib/profileCache'
import { INDIA_STATES } from '@/lib/account/constants'
import type {
  SiteSettings, OrderAddress, SavedAddress, RawProfile,
} from '@/types'
import type { LoyaltyRedemption } from '@/components/checkout/OrderSummary'
import type { PriceSummary }      from '@/lib/services/pricingService'

// ─── Razorpay minimal types ───────────────────────────────────────────────────
interface RazorpayResponse {
  razorpay_order_id:   string
  razorpay_payment_id: string
  razorpay_signature:  string
}

interface RazorpayOptions {
  key:         string
  amount:      number
  currency:    string
  order_id:    string
  name:        string
  description: string
  image:       string
  prefill:     { name: string; email: string; contact: string }
  notes:       Record<string, string>
  theme:       { color: string }
  handler:     (response: RazorpayResponse) => void
  modal:       { ondismiss: () => void }
}

// ─── Module-level helpers ─────────────────────────────────────────────────────
// These were previously defined inside the CheckoutClient component body
// (causing them to be recreated on every render). Moving them here gives them
// stable identities and removes them from the component render cycle.

function matchState(stored: string | undefined | null): string {
  if (!stored) return 'Uttarakhand'
  const s = stored.trim()
  const exact = INDIA_STATES.find(st => st === s); if (exact) return exact
  const ci    = INDIA_STATES.find(st => st.toLowerCase() === s.toLowerCase()); if (ci) return ci
  const lower = s.toLowerCase()
  const prefix = INDIA_STATES.find(
    st => st.toLowerCase().startsWith(lower) || lower.startsWith(st.toLowerCase())
  )
  if (prefix) return prefix
  const word = lower.split(' ')[0]
  const has  = INDIA_STATES.find(st => st.toLowerCase().includes(word) && word.length > 3)
  return has || s
}

function parseSavedAddresses(raw: string | undefined | null): SavedAddress[] {
  if (!raw) return []
  try { return JSON.parse(raw) as SavedAddress[] } catch { return [] }
}

function applyProfileData(
  prof:       RawProfile,
  allAddrs:   SavedAddress[],
  setAddrFn:  React.Dispatch<React.SetStateAction<OrderAddress>>,
  setEmailFn: React.Dispatch<React.SetStateAction<string>>,
  setSavedFn: React.Dispatch<React.SetStateAction<SavedAddress[]>>,
): void {
  if (!prof) return
  const fullName   = [prof.first_name, prof.last_name].filter(Boolean).join(' ')
  const cleanPhone = (prof.phone || '').replace(/^\+91/, '').replace(/\D/g, '').slice(-10)
  setAddrFn(prev => {
    if (prev.flat || prev.city || prev.pincode) return prev
    if (allAddrs.length > 0) {
      const a = allAddrs[0]
      const validLabels = ['Home','Office','Parents','Friends','Others'] as const
      const lbl = validLabels.find(l => l === a.label) || 'Home'
      return {
        ...prev, name: a.name||fullName||prev.name, phone: a.phone||cleanPhone||prev.phone,
        flat: a.flat||'', area: a.area||'', city: a.city||'',
        state: matchState(a.state), pincode: a.pincode||'', label: lbl,
      }
    }
    return { ...prev, name: prev.name||fullName, phone: prev.phone||cleanPhone }
  })
  setEmailFn(prev => prev || prof.email || '')
  setSavedFn(allAddrs)
}

// ─── Public return type ───────────────────────────────────────────────────────
export interface CheckoutPageState {
  // hydration
  storeReady: boolean

  // cart store (read-only slices needed by JSX)
  items:    ReturnType<typeof useCartStore.getState>['items']
  coupon:   ReturnType<typeof useCartStore.getState>['coupon']
  removeCoupon: () => void

  // payment
  payMethod:       'razorpay' | 'cod'
  setPayMethod:    (m: 'razorpay' | 'cod') => void
  placing:         boolean
  razorpayLoaded:  boolean
  setRazorpayLoaded: (v: boolean) => void
  error:           string

  // coupon
  couponCode:          string
  setCouponCode:       (v: string) => void
  couponLoading:       boolean
  couponError:         string
  couponHints:         Array<{code: string; label: string}>

  // loyalty
  loyaltyBalance:    number
  loyaltyRedemption: LoyaltyRedemption | null
  loyaltyLoading:    boolean
  loyaltyError:      string

  // address
  addr:              OrderAddress
  email:             string
  setEmail:          (v: string) => void
  savedAddrs:        SavedAddress[]
  selectedSavedIdx:  number | null
  summaryOpen:       boolean
  setSummaryOpen:    (v: boolean | ((prev: boolean) => boolean)) => void
  touched:           Record<string, boolean>

  // computed from settings
  codEnabled:      boolean
  razorpayEnabled: boolean
  codMax:          number
  prepaidPct:      number
  freeShipMin:     number
  minOrderAmt:     number
  razorpayKeyId:   string

  // pricing
  pricing:         PriceSummary
  codOk:           boolean
  belowMinOrder:   boolean
  bothPayOff:      boolean

  // handlers
  setAddrField:            (field: keyof OrderAddress, value: string) => void
  touchField:              (field: string) => void
  applySaved:              (saved: SavedAddress, idx: number) => void
  handleCoupon:            () => Promise<void>
  handleApplyCouponHint:   (code: string) => Promise<void>
  handleApplyLoyalty:      (pts: number) => Promise<void>
  handleRemoveLoyalty:     () => void
  handlePlace:             () => Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
export function useCheckoutPage(settings: SiteSettings): CheckoutPageState {
  const router = useRouter()

  // ── Cart / user store ──────────────────────────────────────────────────────
  const items               = useCartStore(s => s.items)
  const coupon              = useCartStore(s => s.coupon)
  const idempotencyKey      = useCartStore(s => s.idempotencyKey)
  const ensureIdempotencyKey = useCartStore(s => s.ensureIdempotencyKey)
  const clearCart           = useCartStore(s => s.clearCart)
  const applyCoupon         = useCartStore(s => s.applyCoupon)
  const removeCouponFromStore = useCartStore(s => s.removeCoupon)
  const user                = useUserStore(s => s.user)

  const s = settings

  // ── Settings-derived constants ─────────────────────────────────────────────
  const codEnabled      = s.cod_enabled  !== 'false'
  const upiAdminOn      = s.upi_enabled  !== 'false'
  const razorpayKeyId   = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || ''
  const razorpayEnabled = !!razorpayKeyId && upiAdminOn
  const codMax          = parseFloat(s.cod_max_value        || '3000')
  const prepaidPct      = parseInt(s.prepaid_discount_pct   || '5')
  const freeShipMin     = parseFloat(s.free_shipping_min    || '0')
  const minOrderAmt     = parseFloat(s.min_order_amount     || '0')
  const _waRaw          = (s.whatsapp_number || '919899984895').replace(/\D/g, '')
  const waNumber        = _waRaw.length >= 7 ? _waRaw : '919899984895'

  // ── State ──────────────────────────────────────────────────────────────────
  // BUG FIX (hydration-race): storeReady used to be its own `useState(false)`
  // flipped by `useEffect(() => setStoreReady(true), [])`. That effect fires
  // BEFORE StoreHydrator's deferred `persist.rehydrate()` resolves (see
  // cartStore.ts), so for one tick `storeReady` was `true` while `items` was
  // still `[]` from the pre-hydration default. The redirect effect below
  // (`items.length === 0 && storeReady`) then fired on that tick and sent
  // users with a non-empty *persisted* cart back to /cart before their items
  // had a chance to load — a checkout-killing false redirect.
  // Fix: derive storeReady directly from the cart store's `_hasHydrated` flag,
  // which only becomes true once localStorage has actually been applied.
  const storeReady = useCartStore(selectHasHydrated)
  const [payMethod,      setPayMethod]      = useState<'razorpay' | 'cod'>('cod')
  const [placing,        setPlacing]        = useState(false)
  const [razorpayLoaded, setRazorpayLoaded] = useState(false)
  const [error,          setError]          = useState('')

  const [couponCode,     setCouponCode]     = useState('')
  const [couponLoading,  setCouponLoading]  = useState(false)
  const [couponError,    setCouponError]    = useState('')
  const [couponHints,    setCouponHints]    = useState<Array<{code: string; label: string}>>([])

  const [loyaltyBalance,    setLoyaltyBalance]    = useState(0)
  const [loyaltyRedemption, setLoyaltyRedemption] = useState<LoyaltyRedemption | null>(null)
  const [loyaltyLoading,    setLoyaltyLoading]    = useState(false)
  const [loyaltyError,      setLoyaltyError]      = useState('')

  const [savedAddrs, setSavedAddrs] = useState<SavedAddress[]>(() => {
    if (typeof window === 'undefined') return []
    try { return _readProfileCache()?.addresses || [] } catch { return [] }
  })
  const [selectedSavedIdx, setSelectedSavedIdx] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    try { return (_readProfileCache()?.addresses?.length || 0) > 0 ? 0 : null } catch { return null }
  })
  const [summaryOpen, setSummaryOpen] = useState(true)
  const [touched,     setTouched]     = useState<Record<string, boolean>>({})

  const BASE_ADDR: OrderAddress = {
    name: '', phone: '', flat: '', area: '', city: '',
    state: 'Uttarakhand', pincode: '', label: 'Home',
  }

  const [addr, setAddr] = useState<OrderAddress>(() => {
    if (typeof window === 'undefined') return BASE_ADDR
    try {
      const cache = _readProfileCache()
      if (!cache) {
        const raw = localStorage.getItem('pr-user')
        if (!raw) return BASE_ADDR
        const u = JSON.parse(raw)?.state?.user
        if (!u) return BASE_ADDR
        const cleanPhone = (u.phone || '').replace(/^\+91/, '').replace(/\D/g, '').slice(-10)
        return { ...BASE_ADDR, name: u.name || '', phone: cleanPhone }
      }
      const { profile: prof, addresses: allAddrs } = cache
      const fullName   = [prof.first_name, prof.last_name].filter(Boolean).join(' ')
      const cleanPhone = (prof.phone || '').replace(/^\+91/, '').replace(/\D/g, '').slice(-10)
      if (allAddrs.length > 0) {
        const a = allAddrs[0]
        const validLabels = ['Home','Office','Parents','Friends','Others'] as const
        const lbl = validLabels.find(l => l === a.label) || 'Home'
        return {
          ...BASE_ADDR, name: a.name||fullName, phone: a.phone||cleanPhone,
          flat: a.flat||'', area: a.area||'', city: a.city||'',
          state: matchState(a.state), pincode: a.pincode||'', label: lbl,
        }
      }
      return { ...BASE_ADDR, name: fullName, phone: cleanPhone }
    } catch { return BASE_ADDR }
  })

  const [email, setEmail] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    try {
      const cache = _readProfileCache()
      if (cache?.profile?.email) return cache.profile.email
      const raw = localStorage.getItem('pr-user')
      return JSON.parse(raw || '{}')?.state?.user?.email || ''
    } catch { return '' }
  })

  // ── Mounted guard ──────────────────────────────────────────────────────────
  // BUG FIX: guards post-await setState calls in coupon handlers to prevent
  // React StrictMode warnings when the component unmounts mid-request.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // orderPlacedRef prevents false "cart is empty" redirect after a successful order
  const orderPlacedRef = useRef(false)

  // applyProfileDataRef holds the latest applyProfileData helper so the profile
  // effect doesn't need to list it as a dep (it's defined at module level now,
  // but keeping the ref pattern is defensive against any future closure captures).
  const applyProfileDataRef = useRef(applyProfileData)

  // ── Revalidation tracking refs (DATA INTEGRITY FIX — see effects below) ────
  // The global CartDrawer (rendered in the root layout — see CartDrawer.tsx)
  // is reachable from every page, including /checkout. A user can open it and
  // change quantities or remove items while sitting on the checkout page.
  // `coupon.discount` and `loyaltyRedemption.discount_inr` are both ₹ snapshots
  // frozen at the subtotal they were validated against — without revalidation,
  // editing the cart from the drawer leaves both stale relative to the new
  // pricing.subtotal, exactly the class of bug already fixed for /cart in
  // useCartPage's coupon-revalidation effect. These refs mirror that pattern.
  const lastValidatedCouponSubtotalRef  = useRef<number | null>(null)
  const lastValidatedLoyaltySubtotalRef = useRef<number | null>(null)

  // ── Pricing ────────────────────────────────────────────────────────────────
  const pricing = useMemo(
    () => calcPriceSummary(
      items, s, coupon, payMethod,
      loyaltyRedemption?.discount_inr ?? 0,
    ),
    [items, s, coupon, payMethod, loyaltyRedemption],
  )

  const codOk         = codEnabled && pricing.subtotal <= codMax
  const belowMinOrder = minOrderAmt > 0 && pricing.subtotal < minOrderAmt
  const bothPayOff    = !codOk && !razorpayEnabled

  // Primitive snapshots for stable useCallback deps inside handlePlace
  const pricingShipping = pricing.shipping
  const pricingTotal    = pricing.total

  // ── Analytics ──────────────────────────────────────────────────────────────
  // Destructure individual stable refs — the analytics object itself is a new
  // reference each render, so adding it directly to useCallback deps defeats memo.
  const {
    trackOrderPlaced,
    trackPaymentInitiated,
    trackPaymentVerified,
    trackCouponApplied,
    trackCouponError,
  } = useCheckoutAnalytics({
    itemCount: items.length, subtotal: pricing.subtotal,
    payMethod, isFreeShipping: pricing.isFreeShipping,
  })

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (items.length === 0 && storeReady && !orderPlacedRef.current) {
      router.replace('/cart')
    }
  }, [items, storeReady, router])

  useEffect(() => {
    if (payMethod === 'cod' && !codOk && razorpayEnabled) setPayMethod('razorpay')
    if (payMethod === 'razorpay' && !razorpayEnabled && codOk) setPayMethod('cod')
  }, [codOk, payMethod, razorpayEnabled])

  // Loyalty balance
  useEffect(() => {
    if (s.loyalty_enabled !== 'true') return
    const ac = new AbortController()
    fetch('/api/v1/loyalty', { signal: ac.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.points) setLoyaltyBalance(d.points) })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return
      })
    return () => ac.abort()
  }, [s.loyalty_enabled])

  // Background profile refresh
  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/profile', { signal: ctrl.signal })
      .then(async r => {
        if (!r.ok || ctrl.signal.aborted) return
        const data = await r.json()
        const prof = data.profile
        if (!prof) return
        const fullName   = [prof.first_name, prof.last_name].filter(Boolean).join(' ')
        const cleanPhone = (prof.phone || '').replace(/^\+91/, '').replace(/\D/g, '').slice(-10)
        const defaultAddr = prof.address_line1 ? [{
          id: 'default', is_default: true, label: 'Home' as const,
          name: fullName||'', flat: prof.address_line1||'', area: '',
          city: prof.city||'', state: prof.state||'', pincode: prof.pincode||'',
          phone: cleanPhone||'',
        }] : []
        const validLabels = new Set(['Home','Office','Parents','Friends','Others'])
        const saved = parseSavedAddresses(prof.saved_addresses)
          .filter((a: SavedAddress) => validLabels.has(a.label ?? ''))
        const all = [...defaultAddr, ...saved]
        _writeProfileCache({ ts: Date.now(), profile: prof, addresses: all })
        applyProfileDataRef.current(prof, all, setAddr, setEmail, setSavedAddrs)
        if (all.length > 0) setSelectedSavedIdx(0)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, []) // mount-only: background profile prefill

  // Coupon hints
  useEffect(() => {
    const ac = new AbortController()
    fetch('/api/v1/coupon-hints', { signal: ac.signal })
      .then(async r => {
        if (!r.ok) return
        const data = await r.json()
        setCouponHints(data.hints || [])
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return
      })
    return () => ac.abort()
  }, [])

  // DATA INTEGRITY FIX — coupon revalidation on checkout.
  //
  // `coupon.discount` is a ₹ snapshot frozen by validateCouponServer() against
  // the subtotal at apply time. The cart page already revalidates this on
  // subtotal change (useCartPage), but the checkout page never did — even
  // though the global CartDrawer (root layout) lets the user edit quantities
  // or remove items while sitting on /checkout, changing pricing.subtotal
  // out from under the frozen discount.
  //
  // Repro without this fix: apply PAHADI10 (10% off) on a ₹1000 cart →
  // discount=₹100. Open the header's cart drawer on the checkout page and
  // remove an item, dropping the subtotal to ₹400. coupon.discount stays
  // ₹100 (10% of the OLD ₹1000), so the displayed total understates the real
  // total by ₹60 (10% of 400 = 40, not 100). createOrder() recomputes the
  // discount from the live subtotal at order time, so the *charge* is
  // correct — but the customer is shown a lower total right up until they
  // submit, and (for a flat coupon whose min_order is no longer met) the
  // server may reject the coupon entirely, producing a higher final charge
  // than what was displayed.
  //
  // Fix: debounce on pricing.subtotal change and re-POST /api/v1/coupons,
  // mirroring useCartPage's revalidation effect. If the coupon is no longer
  // valid for the new subtotal (e.g. min_order unmet), remove it and surface
  // the server's reason so the customer understands why the total changed.
  useEffect(() => {
    if (!coupon) {
      lastValidatedCouponSubtotalRef.current = null
      return
    }
    // DEFENSIVE GUARD (mirrors the "ghost subtotal" fix in useCartPage):
    // /api/v1/coupons requires subtotal > 0 (validateCouponSchema). On this
    // page `pricing` is derived from `items` directly (no pendingRemovals),
    // and cartStore nulls `coupon` the instant `items` becomes empty, so
    // `coupon !== null` should already guarantee subtotal > 0. This guard is
    // cheap insurance against ever POSTing subtotal <= 0 and having the
    // resulting generic 400 wrongly strip an otherwise-valid coupon.
    if (pricing.subtotal <= 0) return
    if (lastValidatedCouponSubtotalRef.current === pricing.subtotal) return

    const ac = new AbortController()
    const code = coupon.code
    const timer = setTimeout(() => {
      fetch('/api/v1/coupons', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code, subtotal: pricing.subtotal }),
        signal:  ac.signal,
      })
        .then(async res => {
          if (!mountedRef.current) return
          const data = await res.json()
          if (!mountedRef.current) return
          if (!res.ok) {
            // Coupon no longer valid for the new subtotal (e.g. min_order
            // unmet after items were removed) — remove it rather than leave
            // a discount on screen that the server will reject at order time.
            removeCouponFromStore()
            lastValidatedCouponSubtotalRef.current = null
            setCouponError(data.error || `Coupon ${code} no longer applies to this order`)
            return
          }
          applyCoupon(data.coupon)
          lastValidatedCouponSubtotalRef.current = pricing.subtotal
        })
        .catch((err: unknown) => {
          if ((err as { name?: string }).name === 'AbortError') return
        })
    }, 800)

    return () => { clearTimeout(timer); ac.abort() }
  }, [coupon, pricing.subtotal, applyCoupon, removeCouponFromStore])

  // DATA INTEGRITY FIX — loyalty redemption revalidation on checkout.
  //
  // `loyaltyRedemption.discount_inr` is a ₹ snapshot for a fixed number of
  // points, but /api/v1/loyalty's validate cap (`maxRedeemPct% of subtotal`)
  // depends on the *current* subtotal. If the cart shrinks via the CartDrawer
  // while loyalty coins are applied, the previously-valid redemption can
  // exceed the new cap. createOrder() clamps server-side
  // (`Math.min(requestedDiscount, maxAllowed)`), so the *charge* is correct,
  // but the client keeps showing the larger, now-invalid discount — the
  // displayed total understates the real total.
  //
  // Fix: re-run action=validate on subtotal change. If the redemption no
  // longer fits the new cap, remove it and surface why — mirroring the
  // coupon revalidation effect above.
  useEffect(() => {
    if (!loyaltyRedemption) {
      lastValidatedLoyaltySubtotalRef.current = null
      return
    }
    if (lastValidatedLoyaltySubtotalRef.current === pricing.subtotal) return

    const ac = new AbortController()
    const points = loyaltyRedemption.points
    const timer = setTimeout(() => {
      fetch('/api/v1/loyalty', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:           'validate',
          points_to_redeem: points,
          order_subtotal:   pricing.subtotal,
        }),
        signal: ac.signal,
      })
        .then(async res => {
          if (!mountedRef.current) return
          const data = await res.json()
          if (!mountedRef.current) return
          if (!res.ok) {
            setLoyaltyRedemption(null)
            lastValidatedLoyaltySubtotalRef.current = null
            setLoyaltyError(data.error || 'Coins redemption no longer applies to this order')
            return
          }
          setLoyaltyRedemption({ points: data.points, discount_inr: data.discount_inr })
          lastValidatedLoyaltySubtotalRef.current = pricing.subtotal
        })
        .catch((err: unknown) => {
          if ((err as { name?: string }).name === 'AbortError') return
        })
    }, 800)

    return () => { clearTimeout(timer); ac.abort() }
  }, [loyaltyRedemption, pricing.subtotal])

  // Wrap the store's removeCoupon to also clear revalidation tracking —
  // otherwise a stale lastValidatedCouponSubtotalRef value could suppress
  // the revalidation effect if the same coupon code is re-applied later.
  const removeCoupon = useCallback(() => {
    removeCouponFromStore()
    lastValidatedCouponSubtotalRef.current = null
  }, [removeCouponFromStore])

  // ── Handlers ───────────────────────────────────────────────────────────────

  function setAddrField(field: keyof OrderAddress, value: string) {
    setAddr(prev => ({ ...prev, [field]: value }))
    if (field !== 'label') setSelectedSavedIdx(null)
  }

  function touchField(field: string) {
    setTouched(prev => ({ ...prev, [field]: true }))
  }

  function applySaved(saved: SavedAddress, idx: number) {
    const validLabels = ['Home','Office','Parents','Friends','Others'] as const
    const lbl = validLabels.find(l => l === saved.label) || 'Home'
    setAddr(prev => ({
      ...prev, name: saved.name||prev.name, phone: saved.phone||prev.phone,
      flat: saved.flat||'', area: saved.area||'', city: saved.city||'',
      state: matchState(saved.state), pincode: saved.pincode||'', label: lbl,
    }))
    setSelectedSavedIdx(idx)
    setTouched({ name:true, phone:true, flat:true, city:true, state:true, pincode:true })
  }

  // BUG FIX: mountedRef guards added to both coupon handlers.
  // Previously all post-await setState/store-action calls in handleCoupon and
  // handleApplyCouponHint fired unconditionally, meaning a fast back-navigation
  // mid-request would cause setState on an unmounted component.
  async function handleCoupon() {
    if (!couponCode.trim()) return
    setCouponLoading(true)
    setCouponError('')
    try {
      const res  = await fetch('/api/v1/coupons', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code:     couponCode.trim().toUpperCase(),
          subtotal: pricing.subtotal,
        }),
      })
      if (!mountedRef.current) return
      const data = await res.json()
      if (!mountedRef.current) return
      if (!res.ok) {
        setCouponError(data.error || 'Invalid coupon')
        trackCouponError(couponCode, data.error || 'invalid')
        return
      }
      applyCoupon(data.coupon)
      setCouponCode('')
      trackCouponApplied(data.coupon.code, data.coupon.discount)
      // Seed revalidation tracking with the subtotal this discount was
      // computed against — see the revalidation effect below.
      lastValidatedCouponSubtotalRef.current = pricing.subtotal
    } finally {
      if (mountedRef.current) setCouponLoading(false)
    }
  }

  async function handleApplyCouponHint(code: string) {
    const upper = code.trim().toUpperCase()
    if (!upper) return
    setCouponLoading(true)
    setCouponError('')
    try {
      const res  = await fetch('/api/v1/coupons', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: upper, subtotal: pricing.subtotal }),
      })
      if (!mountedRef.current) return
      const data = await res.json()
      if (!mountedRef.current) return
      if (!res.ok) {
        setCouponError(data.error || 'Invalid coupon')
        trackCouponError(upper, data.error || 'invalid')
        return
      }
      applyCoupon(data.coupon)
      setCouponCode('')
      trackCouponApplied(data.coupon.code, data.coupon.discount)
      // Seed revalidation tracking with the subtotal this discount was
      // computed against — see the revalidation effect below.
      lastValidatedCouponSubtotalRef.current = pricing.subtotal
    } catch (e: unknown) {
      if (!mountedRef.current) return
      const reason = e instanceof Error ? e.message : 'network_error'
      setCouponError('Failed to apply coupon')
      trackCouponError(upper, reason)
    } finally {
      if (mountedRef.current) setCouponLoading(false)
    }
  }

  // BUG FIX: mountedRef guards added — same class of bug as handleCoupon /
  // handleApplyCouponHint (fixed in the previous pass, Fix 13 in useCartPage).
  // handleApplyLoyalty is a user-triggered async function; all post-await
  // setState calls were unconditional. Fast back-navigation while a loyalty
  // validate request is in-flight would fire setLoyaltyError, setLoyaltyRedemption,
  // and setLoyaltyLoading on an unmounted component, producing StrictMode
  // warnings and potential state corruption on re-mount.
  async function handleApplyLoyalty(ptsToRedeem: number) {
    if (loyaltyLoading) return
    setLoyaltyLoading(true)
    setLoyaltyError('')
    try {
      const res  = await fetch('/api/v1/loyalty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:           'validate',
          points_to_redeem: ptsToRedeem,
          order_subtotal:   pricing.subtotal,
        }),
      })
      if (!mountedRef.current) return
      const data = await res.json()
      if (!mountedRef.current) return
      if (!res.ok) { setLoyaltyError(data.error || 'Invalid redemption'); return }
      setLoyaltyRedemption({ points: data.points, discount_inr: data.discount_inr })
      // Seed revalidation tracking with the subtotal this discount was
      // computed against — see the revalidation effect below.
      lastValidatedLoyaltySubtotalRef.current = pricing.subtotal
    } catch {
      if (!mountedRef.current) return
      setLoyaltyError('Failed to apply coins')
    } finally {
      if (mountedRef.current) setLoyaltyLoading(false)
    }
  }

  function handleRemoveLoyalty() {
    setLoyaltyRedemption(null)
    setLoyaltyError('')
    lastValidatedLoyaltySubtotalRef.current = null
  }

  const handlePlace = useCallback(async () => {
    const required = ['name','phone','flat','city','state','pincode'] as const
    setTouched(prev => { const n={...prev}; required.forEach(f => { n[f]=true }); return n })
    const fieldLabels: Record<string, string> = {
      name: 'Full Name', phone: 'Mobile Number', flat: 'Address',
      city: 'City', state: 'State', pincode: 'Pincode',
    }
    for (const f of required) {
      if (!addr[f]?.toString().trim()) { setError(`Please fill in: ${fieldLabels[f]}`); return }
    }
    if (!/^[6-9]\d{9}$/.test(addr.phone)) { setError('Enter a valid 10-digit mobile number'); return }
    if (!/^\d{6}$/.test(addr.pincode))     { setError('Enter a valid 6-digit pincode'); return }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter a valid email address'); return }
    setError(''); setPlacing(true)
    try {
      const orderKey = idempotencyKey || ensureIdempotencyKey()
      const payload  = {
        address: {
          name:    addr.name,
          phone:   addr.phone,
          flat:    addr.flat,
          area:    addr.area,
          city:    addr.city,
          state:   addr.state,
          pincode: addr.pincode,
          label:   addr.label,
        },
        customer_email:          email || user?.email || '',
        items:                   items.map(i => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })),
        payment_method:          payMethod,
        coupon_code:             coupon?.code,
        idempotency_key:         orderKey,
        loyalty_points_redeemed: loyaltyRedemption?.points ?? 0,
      }

      if (payMethod === 'cod') {
        const itemLines  = items.map(i => `• ${i.name} ×${i.qty} = ₹${(i.price * i.qty).toFixed(0)}`).join('\n')
        const couponLine = coupon ? `\n🎟️ Coupon ${coupon.code}: -₹${coupon.discount}` : ''
        const coinsLine  = loyaltyRedemption ? `\n🪙 Coins redeemed: -₹${loyaltyRedemption.discount_inr}` : ''
        const shipLine   = pricingShipping > 0 ? `\n🚚 Shipping: ₹${pricingShipping}` : '\n🚚 Shipping: FREE'
        const waMsg = `*New Order — 5 Pahadi Roots* 🌿\n\n` +
          `👤 *${addr.name}*\n📱 ${addr.phone}\n` +
          (email ? `📧 ${email}\n` : '') +
          `\n📍 *Delivery Address*\n${addr.flat}, ${addr.city}, ${addr.state} — ${addr.pincode}\n\n` +
          `🛒 *Items*\n${itemLines}` + couponLine + coinsLine + shipLine +
          `\n\n*Total: ₹${pricingTotal}*\n\n💵 *Payment: Cash on Delivery*\n\nPlease confirm my order!`

        const dbRes  = await fetch('/api/v1/orders', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const dbData = await dbRes.json()
        if (!dbRes.ok) {
          throw new Error(dbData.error || `Order save failed (${dbRes.status})`)
        }
        const orderNumber = dbData.order_number || ''
        trackOrderPlaced(orderNumber, pricingTotal, 'cod')

        window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(waMsg)}`, '_blank')
        orderPlacedRef.current = true
        clearCart()
        router.replace(`/order-success?id=${orderNumber}&method=cod&total=${pricingTotal}`)
      } else {
        const RZP = (window as Window & { Razorpay?: new (opts: RazorpayOptions) => { open(): void } }).Razorpay
        if (!RZP) throw new Error('Payment gateway not loaded. Please refresh.')
        const res  = await fetch('/api/v1/payments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, action: 'create_payment' }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Payment initiation failed')

        if (data.already_confirmed) {
          orderPlacedRef.current = true
          clearCart()
          router.replace(`/order-success?id=${data.order_number || ''}&method=razorpay&total=${pricingTotal}`)
          return
        }

        const rzp = new RZP({
          key:         razorpayKeyId,
          amount:      data.amount,
          currency:    data.currency || 'INR',
          order_id:    data.razorpay_order_id,
          name:        'Pahadi Roots',
          description: 'Natural Himalayan Products',
          image:       'https://pahadiroots.com/favicon.ico',
          prefill:     { name: addr.name, email: email || user?.email || '', contact: addr.phone },
          notes:       { db_order_id: data.order_id },
          theme:       { color: '#2C4A2E' },
          handler: async (response: RazorpayResponse) => {
            try {
              const verRes = await fetch('/api/v1/payments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action:              'verify_payment',
                  razorpay_order_id:   response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature:  response.razorpay_signature,
                  order_id:            data.order_id,
                }),
              })
              const verData = await verRes.json()
              if (!verRes.ok) throw new Error(verData.error || 'Verification failed')

              const itemLines  = items.map(i => `• ${i.name} ×${i.qty} = ₹${(i.price * i.qty).toFixed(0)}`).join('\n')
              const couponLine = coupon ? `\n🎟️ Coupon ${coupon.code}: -₹${coupon.discount}` : ''
              const coinsLine  = loyaltyRedemption ? `\n🪙 Coins redeemed: -₹${loyaltyRedemption.discount_inr}` : ''
              const shipLine   = pricingShipping > 0 ? `\n🚚 Shipping: ₹${pricingShipping}` : '\n🚚 Shipping: FREE'
              const waMsg = `✅ *Payment Confirmed — 5 Pahadi Roots* 🌿\n\n` +
                `✅ *Payment ID:* ${response.razorpay_payment_id}\n` +
                `👤 *${addr.name}*\n📱 ${addr.phone}\n` +
                (email ? `📧 ${email}\n` : '') +
                `\n📍 ${addr.flat}, ${addr.city}, ${addr.state} — ${addr.pincode}\n\n` +
                `🛒 *Items*\n${itemLines}` + couponLine + coinsLine + shipLine +
                `\n\n*Total Paid: ₹${pricingTotal}*`
              window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(waMsg)}`, '_blank')

              trackPaymentVerified(verData.order_number, pricingTotal)
              orderPlacedRef.current = true
              clearCart()
              router.replace(`/order-success?id=${verData.order_number || ''}&method=razorpay&total=${pricingTotal}`)
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : 'Payment verified but order save failed.'
              setError(msg + ' Contact support with payment ID: ' + response.razorpay_payment_id)
              setPlacing(false)
            }
          },
          modal: {
            ondismiss: () => { setPlacing(false); ensureIdempotencyKey() },
          },
        })
        trackPaymentInitiated(pricingTotal)
        rzp.open()
        return
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setPlacing(false)
    }
  }, [
    addr, email, items, coupon, loyaltyRedemption,
    idempotencyKey, ensureIdempotencyKey,
    payMethod, user, clearCart, router, razorpayKeyId,
    trackOrderPlaced, trackPaymentInitiated, trackPaymentVerified,
    pricingShipping, pricingTotal, waNumber,
  ])

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    storeReady,
    items, coupon, removeCoupon,
    payMethod, setPayMethod,
    placing,
    razorpayLoaded, setRazorpayLoaded,
    error,
    couponCode, setCouponCode, couponLoading, couponError, couponHints,
    loyaltyBalance, loyaltyRedemption, loyaltyLoading, loyaltyError,
    addr, email, setEmail, savedAddrs, selectedSavedIdx,
    summaryOpen, setSummaryOpen, touched,
    codEnabled, razorpayEnabled, codMax, prepaidPct, freeShipMin, minOrderAmt, razorpayKeyId,
    pricing, codOk, belowMinOrder, bothPayOff,
    setAddrField, touchField, applySaved,
    handleCoupon, handleApplyCouponHint,
    handleApplyLoyalty, handleRemoveLoyalty,
    handlePlace,
  }
}
