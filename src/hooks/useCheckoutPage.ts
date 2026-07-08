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

// Builds the order-success redirect URL. Always includes the confirmation
// token when available — see db_migration_v6_order_confirmation_token.sql —
// so the confirmation page can look up real order data via the new
// /api/v1/orders/lookup endpoint instead of the dead /api/admin-api call it
// used to make. Falls back to a token-less URL if, for some rare reason
// (see the non-fatal catch in orderService.ts), no token came back — the
// confirmation page still degrades gracefully to its existing
// "check your email/WhatsApp" fallback state in that case, exactly as it did
// before this feature existed, so this is never a regression.
function buildOrderSuccessUrl(orderNumber: string, token: string | undefined, method: 'cod' | 'razorpay', total: number): string {
  const params = new URLSearchParams({ id: orderNumber, method, total: String(total) })
  if (token) params.set('token', token)
  return `/order-success?${params.toString()}`
}

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

// BUG FIX [ERROR HANDLING — raw parser error leaking to the customer]:
// handlePlace previously did `const data = await res.json()` unconditionally,
// BEFORE checking `res.ok`. If the server (or, more likely, the platform in
// front of it — e.g. a Vercel serverless function timeout or crash) ever
// returns a non-JSON body — an HTML error page instead of the expected JSON —
// `res.json()` throws a raw `SyntaxError` like:
//   Unexpected token 'A', "An error o"... is not valid JSON
// That exception propagated straight up to the outer catch and was shown to
// the customer verbatim via setError(e.message), right at the "Place Order"
// step. This helper reads the body as text first (never throws), then tries
// to parse it as JSON; if parsing fails, it returns `{}` instead of letting a
// raw parser error reach the UI. Callers still have `res.status` available to
// build a useful message ("Order save failed (504)") even when the body
// wasn't JSON at all.
async function safeJsonParse<T extends object = Record<string, unknown>>(
  res: Response
): Promise<Partial<T> & { error?: string }> {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as Partial<T> & { error?: string }
  } catch {
    return {}
  }
}

// Shape of /api/v1/payments responses (both create_payment and verify_payment
// actions share one endpoint/response envelope — only the populated fields differ).
interface PaymentApiResponse {
  already_confirmed?: boolean
  order_number?:       string
  order_id?:            string
  amount?:              number
  currency?:            string
  razorpay_order_id?:  string
  // Guest-safe capability token for the order-success confirmation page —
  // see db_migration_v6_order_confirmation_token.sql.
  confirmation_token?: string
}

function applyProfileData(
  prof:       RawProfile,
  allAddrs:   SavedAddress[],
  setAddrFn:  React.Dispatch<React.SetStateAction<OrderAddress>>,
  setEmailFn: React.Dispatch<React.SetStateAction<string>>,
  setSavedFn: React.Dispatch<React.SetStateAction<SavedAddress[]>>,
  // BUG FIX (Amazon/Myntra-style instant address fill): the address fields
  // are now filled INSTANTLY at mount from localStorage cache, however old
  // (see profileCache.ts) — no more waiting on a network round-trip just to
  // see a previously-known address. The background /api/profile refresh
  // below still runs afterward to keep that data correct, but the OLD guard
  // here ("if prev.flat || prev.city || prev.pincode, do nothing") assumed
  // non-empty fields only ever meant "the customer typed this — never touch
  // it" — true when fields started empty, no longer true now that they
  // start pre-filled from cache. Without this parameter, the background
  // refresh could never update anything once the instant cache-fill had
  // already populated the form, i.e. stale cached data would never
  // self-correct. allowOverwrite lets the caller say "these fields are
  // still cache-sourced, not customer-typed — safe to silently refresh."
  allowOverwrite: boolean = false,
): void {
  if (!prof) return
  const fullName   = [prof.first_name, prof.last_name].filter(Boolean).join(' ')
  const cleanPhone = (prof.phone || '').replace(/^\+91/, '').replace(/\D/g, '').slice(-10)
  setAddrFn(prev => {
    if (!allowOverwrite && (prev.flat || prev.city || prev.pincode)) return prev
    if (allAddrs.length > 0) {
      const a = allAddrs[0]
      const validLabels = ['Home','Office','Parents','Friends','Others'] as const
      const lbl = validLabels.find(l => l === a.label) || 'Home'
      return {
        ...prev, name: a.name||fullName||prev.name, phone: a.phone||cleanPhone||prev.phone,
        flat: a.flat||a.addr||'', area: a.area||'', city: a.city||'',
        state: matchState(a.state), pincode: a.pincode||a.pin||'', label: lbl,
      }
    }
    return { ...prev, name: prev.name||fullName, phone: prev.phone||cleanPhone }
  })
  setEmailFn(prev => allowOverwrite ? (prof.email || prev) : (prev || prof.email || ''))
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
  razorpayLoadFailed: boolean
  setRazorpayLoadFailed: (v: boolean) => void
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
  // True only while the background saved-address fetch is in flight AND the
  // cache was cold at mount — see the hadWarmCache comment in the hook body.
  profilePrefillLoading: boolean
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
  // PERF FIX: memoized so that a new `settings` object reference (common when
  // the parent fetches settings on every render) doesn't force recomputation
  // and new primitive values that could invalidate downstream useMemo/useCallback
  // deps unnecessarily. Each constant depends only on its specific setting key.
  const codEnabled = useMemo(() => s.cod_enabled !== 'false', [s.cod_enabled])
  const upiAdminOn = useMemo(() => s.upi_enabled !== 'false', [s.upi_enabled])
  // razorpayKeyId is a compile-time constant — no need to memoize
  const razorpayKeyId   = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || ''
  const razorpayEnabled = useMemo(() => !!razorpayKeyId && upiAdminOn, [razorpayKeyId, upiAdminOn])
  const codMax      = useMemo(() => parseFloat(s.cod_max_value      || '3000'), [s.cod_max_value])
  const prepaidPct  = useMemo(() => parseInt(s.prepaid_discount_pct || '5'),    [s.prepaid_discount_pct])
  const freeShipMin = useMemo(() => parseFloat(s.free_shipping_min  || '0'),    [s.free_shipping_min])
  const minOrderAmt = useMemo(() => parseFloat(s.min_order_amount   || '0'),    [s.min_order_amount])
  const waNumber    = useMemo(() => {
    const raw = (s.whatsapp_number || '919899984895').replace(/\D/g, '')
    return raw.length >= 7 ? raw : '919899984895'
  }, [s.whatsapp_number])

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
  // BUG FIX (CRITICAL — found via live report: "Loading payment..." stuck
  // forever): the Razorpay <Script>'s onError handler only logged to the
  // console — it never set any state, so if the script failed to load for
  // ANY reason (network hiccup, slow connection, ad-blocker, transient CDN
  // issue), razorpayLoaded stayed false permanently. The Pay button is
  // disabled whenever razorpayLoaded is false, so the customer was stuck
  // on a perma-disabled "Loading payment…" button with NO error message and
  // NO way to recover, for every single online-payment attempt hit by that
  // failure. This flag drives a real, visible fallback (see OrderSummary.tsx)
  // instead of a silent console.error nobody but a developer would ever see.
  const [razorpayLoadFailed, setRazorpayLoadFailed] = useState(false)
  const [error,          setError]          = useState('')

  const [couponCode,     setCouponCode]     = useState('')
  const [couponLoading,  setCouponLoading]  = useState(false)
  const [couponError,    setCouponError]    = useState('')
  const [couponHints,    setCouponHints]    = useState<Array<{code: string; label: string}>>([])

  const [loyaltyBalance,    setLoyaltyBalance]    = useState(0)
  const [loyaltyRedemption, setLoyaltyRedemption] = useState<LoyaltyRedemption | null>(null)
  const [loyaltyLoading,    setLoyaltyLoading]    = useState(false)
  const [loyaltyError,      setLoyaltyError]      = useState('')

  // BUG FIX (CRITICAL, companion to razorpayLoadFailed above): onError only
  // fires for a clean network-level load failure. A script that hangs
  // indefinitely (very slow connection, a CDN serving but never completing
  // the response) fires neither onLoad nor onError — the customer would
  // still be stuck forever without this timeout. 10s is generous for a
  // ~60KB script even on a slow connection, while still failing well before
  // a customer gives up and abandons the cart.
  useEffect(() => {
    if (razorpayLoaded) return
    const timer = setTimeout(() => {
      setRazorpayLoaded(loaded => {
        if (!loaded) setRazorpayLoadFailed(true)
        return loaded
      })
    }, 10_000)
    return () => clearTimeout(timer)
  }, [razorpayLoaded])

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
          flat: a.flat||a.addr||'', area: a.area||'', city: a.city||'',
          state: matchState(a.state), pincode: a.pincode||a.pin||'', label: lbl,
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

  // BUG FIX (autofill feedback): the background profile-prefill fetch below
  // previously gave the user zero indication it was even running — the
  // address fields just sat blank (or briefly showed the localStorage-only
  // fallback) until the network call resolved, however long that took. This
  // flag is surfaced to AddressForm so it can show a "Loading your saved
  // details…" status instead of looking frozen/broken.
  //
  // Only meaningful when the cache was cold at mount — if `_readProfileCache()`
  // already had data, the form was filled synchronously in the useState
  // initializers above and this background fetch is just a silent refresh;
  // showing a loading indicator in that case would be misleading (nothing is
  // actually "loading" from the user's perspective).
  // BUG FIX (lint: react-hooks/refs — "reading ref.current during render"):
  // the previous version stashed this in a ref and then read `ref.current`
  // inside the useState lazy initializer. That happened to be safe (the ref
  // was assigned earlier in the same render, before any effect could change
  // it), but it's a fragile pattern — reading a ref during render is only
  // safe by accident of ordering, and a future refactor could silently break
  // it. Computing it once as a plain const and passing that same value to
  // both useRef and useState's initializer removes the ref read entirely.
  // BUG FIX (new — dead code found while fixing the ref-read-during-render
  // lint issue above): `hadWarmCacheRef` was never actually read anywhere
  // else in this hook after this point — the ref existed solely to be read
  // once in the useState initializer below. Now that the initializer takes
  // the plain `hadWarmCache` value directly, the ref serves no purpose and
  // has been removed instead of carried forward as unused state.
  const hadWarmCache = typeof window !== 'undefined' ? !!_readProfileCache() : false
  const [profilePrefillLoading, setProfilePrefillLoading] = useState(() => !hadWarmCache)
  // Flips to true the moment the CUSTOMER actually edits an address field
  // (via setAddrField/applySaved below) — as opposed to the instant cache
  // fill at mount or the silent background refresh, neither of which go
  // through those handlers. Read by the background profile effect to decide
  // whether it's still safe to silently refresh cache-sourced fields, or
  // whether the customer has taken over and their typing must never be
  // touched again.
  const userEditedAddrRef = useRef(false)

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

  // PERF FIX: memoized — these are derived from `pricing` (already memoized)
  // and the settings constants above (also memoized). Without useMemo they
  // recompute on every render regardless of whether their inputs changed, and
  // their boolean values are passed as props to memoized child components,
  // where a spurious new primitive (same value, different render) is harmless
  // but causes the effect dep-array on [codOk, razorpayEnabled] to see a
  // "changed" value even when it hasn't — triggering the payment-method
  // correction effect more often than necessary.
  const codOk         = useMemo(() => codEnabled && pricing.subtotal <= codMax,        [codEnabled, pricing.subtotal, codMax])
  const belowMinOrder = useMemo(() => minOrderAmt > 0 && pricing.subtotal < minOrderAmt, [minOrderAmt, pricing.subtotal])
  const bothPayOff    = useMemo(() => !codOk && !razorpayEnabled,                      [codOk, razorpayEnabled])

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

  // BUG FIX (React 19 / react-hooks/set-state-in-effect lint rule): was an
  // effect depending on [codOk, payMethod, razorpayEnabled] calling
  // setPayMethod synchronously in the body. Restructured using React's
  // documented "adjusting state during render" pattern, keyed on the actual
  // availability inputs (codOk, razorpayEnabled) rather than payMethod
  // itself — payMethod is both read and written here, so tracking it as the
  // change-trigger would be self-referential. This only fires the
  // auto-swap when a payment method's availability actually flips, which is
  // the real intent; a user manually selecting an option elsewhere no
  // longer redundantly re-triggers this check (the original effect also
  // re-ran after every payMethod change, including its own corrections,
  // which was harmless but unnecessary).
  const [prevCodOk, setPrevCodOk] = useState(codOk)
  const [prevRazorpayEnabled, setPrevRazorpayEnabled] = useState(razorpayEnabled)
  if (prevCodOk !== codOk || prevRazorpayEnabled !== razorpayEnabled) {
    setPrevCodOk(codOk)
    setPrevRazorpayEnabled(razorpayEnabled)
    if (payMethod === 'cod' && !codOk && razorpayEnabled) setPayMethod('razorpay')
    if (payMethod === 'razorpay' && !razorpayEnabled && codOk) setPayMethod('cod')
  }

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
    // BUG FIX (autofill reliability): this fetch previously had NO timeout —
    // only cancelled on unmount. A slow endpoint (cold serverless start, slow
    // connection) meant the address fields could sit unfilled for however
    // long the network took, with no bound and no user-facing feedback.
    // 6s: generous enough that a normal cold start still succeeds, tight
    // enough that the user isn't left waiting indefinitely — after this the
    // user can just type their address manually; the cache write below still
    // benefits future page loads even after a timeout on this one.
    const timeoutId = setTimeout(() => ctrl.abort(), 6_000)
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
        // allowOverwrite: true unless the customer has already started typing
        // — see the userEditedAddrRef comment above. This is what makes the
        // stale-while-revalidate pattern actually work: the instant cache
        // fill (possibly hours/days old) gets silently corrected here if
        // anything changed, but ONLY while the customer hasn't taken over.
        applyProfileDataRef.current(prof, all, setAddr, setEmail, setSavedAddrs, !userEditedAddrRef.current)
        // Same guard: don't silently re-select "Home" out from under a
        // customer who's already chosen a different saved address or typed
        // their own — _writeProfileCache above still refreshes localStorage
        // regardless, which is the part that actually needs to stay current.
        if (all.length > 0 && !userEditedAddrRef.current) setSelectedSavedIdx(0)
      })
      .catch((err: unknown) => {
        // BUG FIX [ERROR HANDLING]: previously bare `.catch(() => {})` with
        // zero logging. If the profile API is broken (expired session, 500, etc.)
        // users arrive at checkout with no pre-filled address and no indication
        // why — they see blank fields with no error message. More importantly,
        // ops had no visibility that profile prefill was failing at checkout time.
        // Added console.error so the failure shows up in Vercel logs; the UX
        // behavior (blank fields, user can still fill manually) is unchanged.
        if ((err as { name?: string }).name === 'AbortError') return
        console.error('[useCheckoutPage] profile prefill failed:', err)
      })
      .finally(() => {
        // BUG FIX (autofill feedback): clear the loading flag on every exit
        // path — success, HTTP error, network error, AND timeout — so the
        // "Loading your saved details…" indicator never gets stuck on.
        clearTimeout(timeoutId)
        if (mountedRef.current) setProfilePrefillLoading(false)
      })
    return () => { clearTimeout(timeoutId); ctrl.abort() }
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
  // PERF FIX: all handlers are wrapped in useCallback so their references are
  // stable across renders. Previously they were plain `function` declarations,
  // which produce new function references on every render. Child components
  // that receive them as props (AddressForm, SavedAddressSelector, OrderSummary,
  // PaymentSection) use React.memo — but memo is defeated if any prop changes
  // identity on every render. Each handler's dep array lists only the values
  // it actually reads or calls.

  const setAddrField = useCallback((field: keyof OrderAddress, value: string) => {
    userEditedAddrRef.current = true
    setAddr(prev => ({ ...prev, [field]: value }))
    if (field !== 'label') setSelectedSavedIdx(null)
  }, [])   // setAddr / setSelectedSavedIdx are stable setState dispatchers

  const touchField = useCallback((field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }))
  }, [])   // setTouched is stable

  const applySaved = useCallback((saved: SavedAddress, idx: number) => {
    userEditedAddrRef.current = true
    const validLabels = ['Home','Office','Parents','Friends','Others'] as const
    const lbl = validLabels.find(l => l === saved.label) || 'Home'
    setAddr(prev => ({
      ...prev, name: saved.name||prev.name, phone: saved.phone||prev.phone,
      flat: saved.flat||saved.addr||'', area: saved.area||'', city: saved.city||'',
      state: matchState(saved.state), pincode: saved.pincode||saved.pin||'', label: lbl,
    }))
    setSelectedSavedIdx(idx)
    setTouched({ name:true, phone:true, flat:true, city:true, state:true, pincode:true })
  }, [])   // only uses stable state dispatchers and module-level matchState

  // BUG FIX: mountedRef guards added to both coupon handlers.
  // Previously all post-await setState/store-action calls in handleCoupon and
  // handleApplyCouponHint fired unconditionally, meaning a fast back-navigation
  // mid-request would cause setState on an unmounted component.
  // PERF FIX: wrapped in useCallback. `pricing.subtotal` is read via closure;
  // `lastValidatedCouponSubtotalRef` is a ref (stable identity), so neither
  // appears in the dep array. couponCode is read at call-time.
  const handleCoupon = useCallback(async () => {
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
  }, [couponCode, pricing.subtotal, applyCoupon, trackCouponApplied, trackCouponError])

  // PERF FIX: wrapped in useCallback. pricing.subtotal is a dep; stable
  // dispatcher/store refs and mountedRef (a ref) are not.
  const handleApplyCouponHint = useCallback(async (code: string) => {
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
  }, [pricing.subtotal, applyCoupon, trackCouponApplied, trackCouponError])

  // BUG FIX: mountedRef guards added — same class of bug as handleCoupon /
  // handleApplyCouponHint (fixed in the previous pass, Fix 13 in useCartPage).
  // handleApplyLoyalty is a user-triggered async function; all post-await
  // setState calls were unconditional. Fast back-navigation while a loyalty
  // validate request is in-flight would fire setLoyaltyError, setLoyaltyRedemption,
  // and setLoyaltyLoading on an unmounted component, producing StrictMode
  // warnings and potential state corruption on re-mount.
  // PERF FIX: wrapped in useCallback. loyaltyLoading is a dep because the
  // guard `if (loyaltyLoading) return` reads it at call-time.
  const handleApplyLoyalty = useCallback(async (ptsToRedeem: number) => {
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
  }, [loyaltyLoading, pricing.subtotal])

  // PERF FIX: wrapped in useCallback. No external deps — only calls stable
  // state dispatchers and writes to a ref.
  const handleRemoveLoyalty = useCallback(() => {
    setLoyaltyRedemption(null)
    setLoyaltyError('')
    lastValidatedLoyaltySubtotalRef.current = null
  }, [])

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
        const dbData = await safeJsonParse<{ order_number: string; confirmation_token?: string }>(dbRes)
        if (!dbRes.ok) {
          // BUG FIX: dbData.error is now only populated when the body genuinely
          // parsed as JSON with that field. When the server/platform returned
          // something else entirely (HTML error page, empty body, etc.),
          // dbData is `{}` and we fall through to a clean, actionable message
          // instead of a raw parser error.
          throw new Error(dbData.error || `Order save failed (${dbRes.status}). Please try again.`)
        }
        const orderNumber = dbData.order_number || ''
        trackOrderPlaced(orderNumber, pricingTotal, 'cod')

        window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(waMsg)}`, '_blank')
        orderPlacedRef.current = true
        clearCart()
        router.replace(buildOrderSuccessUrl(orderNumber, dbData.confirmation_token, 'cod', pricingTotal))
      } else {
        const RZP = (window as Window & { Razorpay?: new (opts: RazorpayOptions) => { open(): void } }).Razorpay
        if (!RZP) throw new Error('Payment gateway not loaded. Please refresh.')
        const res  = await fetch('/api/v1/payments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, action: 'create_payment' }),
        })
        const data = await safeJsonParse<PaymentApiResponse>(res)
        if (!res.ok) throw new Error(data.error || `Payment initiation failed (${res.status}). Please try again.`)

        if (data.already_confirmed) {
          orderPlacedRef.current = true
          clearCart()
          router.replace(buildOrderSuccessUrl(data.order_number || '', data.confirmation_token, 'razorpay', pricingTotal))
          return
        }

        // BUG FIX: res.ok being true no longer guarantees `data` has the
        // fields we need — if the body was a 200 response with a malformed
        // (non-JSON) payload, safeJsonParse silently returns `{}`. Without
        // this guard we'd have opened the Razorpay modal with amount=undefined
        // / order_id=undefined, which either crashes the SDK or (worse)
        // silently mis-charges. Fail loudly and cleanly instead.
        if (!data.razorpay_order_id || typeof data.amount !== 'number') {
          throw new Error('Payment could not be initiated — please try again or contact support.')
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
          notes:       { db_order_id: data.order_id || '' },
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
              const verData = await safeJsonParse<PaymentApiResponse>(verRes)
              if (!verRes.ok) throw new Error(verData.error || `Verification failed (${verRes.status}). Please contact support.`)
              // BUG FIX: same class of guard as create_payment above — a 200
              // response with a malformed/non-JSON body would otherwise slip
              // through as "success" with an empty order_number, sending the
              // customer to a confirmation link with a blank order ID even
              // though their payment genuinely went through.
              if (!verData.order_number) {
                throw new Error('Payment verified but the order confirmation could not be loaded.')
              }

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
              router.replace(buildOrderSuccessUrl(verData.order_number || '', verData.confirmation_token, 'razorpay', pricingTotal))
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
    razorpayLoadFailed, setRazorpayLoadFailed,
    error,
    couponCode, setCouponCode, couponLoading, couponError, couponHints,
    loyaltyBalance, loyaltyRedemption, loyaltyLoading, loyaltyError,
    addr, email, setEmail, savedAddrs, selectedSavedIdx, profilePrefillLoading,
    summaryOpen, setSummaryOpen, touched,
    codEnabled, razorpayEnabled, codMax, prepaidPct, freeShipMin, minOrderAmt, razorpayKeyId,
    pricing, codOk, belowMinOrder, bothPayOff,
    setAddrField, touchField, applySaved,
    handleCoupon, handleApplyCouponHint,
    handleApplyLoyalty, handleRemoveLoyalty,
    handlePlace,
  }
}
