'use client'

import './checkout.css'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'
import { useCartStore } from '@/store/cartStore'
import { useUserStore } from '@/store/userStore'
import { formatPrice } from '@/lib/utils'
import { calcPriceSummary } from '@/lib/services/pricingService'
import type { SiteSettings, OrderAddress, SavedAddress, RawProfile } from '@/types'

import CheckoutSkeleton     from '@/components/checkout/CheckoutSkeleton'
import ShippingProgress     from '@/components/checkout/ShippingProgress'
import SavedAddressSelector from '@/components/checkout/SavedAddressSelector'
import AddressForm          from '@/components/checkout/AddressForm'
import PaymentSection       from '@/components/checkout/PaymentSection'
import OrderSummary, { type LoyaltyRedemption } from '@/components/checkout/OrderSummary'
import { useCheckoutAnalytics } from '@/hooks/useCheckoutAnalytics'
import {
  readProfileCache  as _readProfileCache,
  writeProfileCache as _writeProfileCache,
} from '@/lib/profileCache'
// CODE QUALITY: import from single source of truth — INDIA_STATES was duplicated
// verbatim in AddressForm, CheckoutClient, and lib/account/constants.ts.
import { INDIA_STATES } from '@/lib/account/constants'

/** Minimal Razorpay options type — avoids `window as any` at the call site. */
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

// PERF: module-level constant — was an inline array literal inside JSX, which
// created a new array on every render. Hoisting it prevents the allocation
// and makes the intent clear (static content).
// CODE QUALITY: moved after imports — placing a const before import statements
// is technically valid JS (imports are hoisted) but violates ES module convention
// and breaks static analysis tools that expect imports first.
const CHECKOUT_TRUST_ITEMS = [
  { icon: '🚚', t: '3–5 Day Delivery', d: 'Pan-India Himalayan dispatch' },
  { icon: '🔄', t: '7-Day Returns',    d: 'Hassle-free, no questions'   },
  { icon: '🌿', t: '100% Authentic',   d: 'Straight from the mountains' },
  { icon: '💬', t: 'WhatsApp Support', d: 'Real humans, always here'    },
] as const

function matchState(stored: string | undefined | null): string {
  if (!stored) return 'Uttarakhand'
  const s = stored.trim()
  const exact = INDIA_STATES.find(st => st === s); if (exact) return exact
  const ci    = INDIA_STATES.find(st => st.toLowerCase() === s.toLowerCase()); if (ci) return ci
  const lower = s.toLowerCase()
  const prefix = INDIA_STATES.find(st => st.toLowerCase().startsWith(lower) || lower.startsWith(st.toLowerCase()))
  if (prefix) return prefix
  const word = lower.split(' ')[0]
  const has  = INDIA_STATES.find(st => st.toLowerCase().includes(word) && word.length > 3)
  return has || s
}

function parseSavedAddresses(raw: string | undefined | null): SavedAddress[] {
  if (!raw) return []
  try { return JSON.parse(raw) as SavedAddress[] } catch { return [] }
}

export function CheckoutClient({ settings }: { settings: SiteSettings }) {
  const router = useRouter()
  // Single hydration guard — storeReady gates both the skeleton render and
  // the empty-cart redirect. Two separate useState+useEffect with identical
  // timing (both fire on mount) was redundant; merged into one.
  const [storeReady, setStoreReady] = useState(false)

  const items              = useCartStore(s => s.items)
  const coupon             = useCartStore(s => s.coupon)
  const idempotencyKey     = useCartStore(s => s.idempotencyKey)
  const ensureIdempotencyKey = useCartStore(s => s.ensureIdempotencyKey)
  const clearCart          = useCartStore(s => s.clearCart)
  const applyCoupon        = useCartStore(s => s.applyCoupon)
  const removeCoupon       = useCartStore(s => s.removeCoupon)
  const user               = useUserStore(s => s.user)

  const s = settings

  const codEnabled      = s.cod_enabled  !== 'false'
  const upiAdminOn      = s.upi_enabled  !== 'false'
  const razorpayKeyId   = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || ''
  const razorpayEnabled = !!razorpayKeyId && upiAdminOn
  const codMax          = parseFloat(s.cod_max_value        || '3000')
  const prepaidPct      = parseInt(s.prepaid_discount_pct   || '5')
  const freeShipMin     = parseFloat(s.free_shipping_min    || '0')
  const minOrderAmt     = parseFloat(s.min_order_amount     || '0')

  const [payMethod, setPayMethod]   = useState<'razorpay' | 'cod'>('cod')
  const [placing,        setPlacing]       = useState(false)
  const [razorpayLoaded, setRazorpayLoaded] = useState(false)
  const [error,     setError]       = useState('')
  const [couponCode,    setCouponCode]    = useState('')
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError,   setCouponError]   = useState('')
  const [couponHints,   setCouponHints]   = useState<Array<{code:string,label:string}>>([]  )

  // ── Loyalty state ─────────────────────────────────────────────
  const [loyaltyBalance,    setLoyaltyBalance]    = useState(0)
  const [loyaltyRedemption, setLoyaltyRedemption] = useState<LoyaltyRedemption | null>(null)
  const [loyaltyLoading,    setLoyaltyLoading]    = useState(false)
  const [loyaltyError,      setLoyaltyError]      = useState('')

  const [savedAddrs,       setSavedAddrs]       = useState<SavedAddress[]>(() => {
    if (typeof window === 'undefined') return []
    try { return readProfileCache()?.addresses || [] } catch { return [] }
  })
  const [selectedSavedIdx, setSelectedSavedIdx] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    try { return (readProfileCache()?.addresses?.length || 0) > 0 ? 0 : null } catch { return null }
  })
  const [summaryOpen,      setSummaryOpen]       = useState(true)
  const [touched,          setTouched]           = useState<Record<string, boolean>>({})

  function readProfileCache() { return _readProfileCache() }
  function writeProfileCache(profile: RawProfile, addresses: SavedAddress[]) {
    _writeProfileCache({ ts: Date.now(), profile, addresses })
  }

  function applyProfileData(prof: RawProfile, allAddrs: SavedAddress[], setAddrFn: typeof setAddr, setEmailFn: typeof setEmail, setSavedFn: typeof setSavedAddrs) {
    if (!prof) return
    const fullName   = [prof.first_name, prof.last_name].filter(Boolean).join(' ')
    const cleanPhone = (prof.phone || '').replace(/^\+91/, '').replace(/\D/g, '').slice(-10)
    setAddrFn(prev => {
      if (prev.flat || prev.city || prev.pincode) return prev
      if (allAddrs.length > 0) {
        const a = allAddrs[0]
        const validLabels = ['Home','Office','Parents','Friends','Others'] as const
        const lbl = validLabels.find(l => l === a.label) || 'Home'
        return { ...prev, name: a.name||fullName||prev.name, phone: a.phone||cleanPhone||prev.phone,
          flat: a.flat||'', area: a.area||'', city: a.city||'',
          state: matchState(a.state), pincode: a.pincode||'', label: lbl }
      }
      return { ...prev, name: prev.name||fullName, phone: prev.phone||cleanPhone }
    })
    setEmailFn(prev => prev || prof.email || '')
    setSavedFn(allAddrs)
  }

  const [addr, setAddr] = useState<OrderAddress>(() => {
    const base: OrderAddress = { name:'', phone:'', flat:'', area:'', city:'', state:'Uttarakhand', pincode:'', label:'Home' }
    if (typeof window === 'undefined') return base
    try {
      const cache = readProfileCache()
      if (!cache) {
        const raw = localStorage.getItem('pr-user')
        if (!raw) return base
        const u = JSON.parse(raw)?.state?.user
        if (!u) return base
        const cleanPhone = (u.phone || '').replace(/^\+91/, '').replace(/\D/g, '').slice(-10)
        return { ...base, name: u.name || '', phone: cleanPhone }
      }
      const { profile: prof, addresses: allAddrs } = cache
      const fullName   = [prof.first_name, prof.last_name].filter(Boolean).join(' ')
      const cleanPhone = (prof.phone || '').replace(/^\+91/, '').replace(/\D/g, '').slice(-10)
      if (allAddrs.length > 0) {
        const a = allAddrs[0]
        const validLabels = ['Home','Office','Parents','Friends','Others'] as const
        const lbl = validLabels.find(l => l === a.label) || 'Home'
        return { ...base, name: a.name||fullName, phone: a.phone||cleanPhone,
          flat: a.flat||'', area: a.area||'', city: a.city||'',
          state: matchState(a.state), pincode: a.pincode||'', label: lbl }
      }
      return { ...base, name: fullName, phone: cleanPhone }
    } catch { return base }
  })
  const [email, setEmail] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    try {
      const cache = readProfileCache()
      if (cache?.profile?.email) return cache.profile.email
      const raw = localStorage.getItem('pr-user')
      return JSON.parse(raw || '{}')?.state?.user?.email || ''
    } catch { return '' }
  })

  // PERF FIX: wrap in useMemo — calcPriceSummary was called inline on every render.
  // CheckoutClient has many state fields (placing, error, touched, couponCode, etc.)
  // so renders are frequent. Memoising means the heavy reduce/Math.round chain only
  // runs when items, coupon, payMethod, or loyalty actually changes.
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

  // Destructure individual stable useCallback refs — the analytics object itself
  // is a new reference each render, so adding `analytics` to a useCallback dep
  // would defeat memoization. Each method is stable (useCallback with []).
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

  // Primitive snapshots used inside placeOrder — stable values to include in dep array
  const pricingShipping  = pricing.shipping
  const pricingTotal     = pricing.total
  // SEC-FIX: strip non-digit characters (spaces, dashes, brackets, leading +)
  // before injecting into the wa.me URL. wa.me expects digits only; an admin
  // who saves "+91 98765-43210" would otherwise produce a broken link, and a
  // malformed value could inject unexpected path segments.
  // Also validate minimum length — an empty post-sanitization string would
  // produce `https://wa.me/` pointing to an unrelated page.
  const _waRaw    = (s.whatsapp_number || '919899984895').replace(/\D/g, '')
  const waNumber  = _waRaw.length >= 7 ? _waRaw : '919899984895'

  const orderPlacedRef = useRef(false)
  useEffect(() => { setStoreReady(true) }, [])

  // Redirect to cart only after hydration — prevents false redirect on SSR
  useEffect(() => {
    if (items.length === 0 && storeReady && !orderPlacedRef.current) router.replace('/cart')
  }, [items, storeReady, router])
  useEffect(() => {
    if (payMethod === 'cod' && !codOk && razorpayEnabled) setPayMethod('razorpay')
    if (payMethod === 'razorpay' && !razorpayEnabled && codOk) setPayMethod('cod')
  }, [codOk, payMethod, razorpayEnabled])

  // ── Fetch loyalty balance (logged-in users only) ─────────────
  useEffect(() => {
    if (s.loyalty_enabled !== 'true') return
    // BUG FIX: AbortController added — the original fetch had no cleanup.
    // If s.loyalty_enabled changes or the component unmounts while the request
    // is in-flight, the .then() setState calls would fire on the unmounted
    // component, causing React StrictMode warnings and potential stale updates.
    const ac = new AbortController()
    fetch('/api/v1/loyalty', { signal: ac.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.points) setLoyaltyBalance(d.points) })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return
      })
    return () => ac.abort()
  }, [s.loyalty_enabled])

  // Background profile refresh — runs once on mount.
  // applyProfileDataRef holds the latest applyProfileData so the effect
  // doesn't need to list it as a dep (it's stable in practice but defined
  // inside the component, so this avoids the suppression cleanly).
  const applyProfileDataRef = useRef(applyProfileData)
  useEffect(() => { applyProfileDataRef.current = applyProfileData })

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
          id: 'default', is_default: true, label:'Home' as const, name:fullName||'', flat:prof.address_line1||'',
          area:'', city:prof.city||'', state:prof.state||'', pincode:prof.pincode||'', phone:cleanPhone||'',
        }] : []
        const validLabels = new Set(['Home','Office','Parents','Friends','Others'])
        const saved = parseSavedAddresses(prof.saved_addresses).filter((a: SavedAddress) => validLabels.has(a.label ?? ''))
        const all   = [...defaultAddr, ...saved]
        writeProfileCache(prof, all)
        applyProfileDataRef.current(prof, all, setAddr, setEmail, setSavedAddrs)
        if (all.length > 0) setSelectedSavedIdx(0)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, []) // intentionally mount-only — background profile prefill

  useEffect(() => {
    // BUG FIX: AbortController added — the original fetch had no cleanup.
    // Without abort, if CheckoutClient unmounts before the response arrives
    // (fast back-navigation), setCouponHints fires on an unmounted component.
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

  function setAddrField(field: keyof OrderAddress, value: string) {
    setAddr(prev => ({ ...prev, [field]: value }))
    if (field !== 'label') setSelectedSavedIdx(null)
  }
  function touchField(field: string) { setTouched(prev => ({ ...prev, [field]: true })) }

  function applySaved(saved: SavedAddress, idx: number) {
    const validLabels = ['Home','Office','Parents','Friends','Others'] as const
    const lbl = validLabels.find(l => l === saved.label) || 'Home'
    setAddr(prev => ({
      ...prev, name:saved.name||prev.name, phone:saved.phone||prev.phone,
      flat:saved.flat||'', area:saved.area||'', city:saved.city||'',
      state:matchState(saved.state), pincode:saved.pincode||'', label:lbl,
    }))
    setSelectedSavedIdx(idx)
    setTouched({ name:true, phone:true, flat:true, city:true, state:true, pincode:true })
  }

  async function handleCoupon() {
    if (!couponCode.trim()) return
    setCouponLoading(true); setCouponError('')
    try {
      const res  = await fetch('/api/v1/coupons', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ code:couponCode.trim().toUpperCase(), subtotal:pricing.subtotal }),
      })
      const data = await res.json()
      if (!res.ok) { setCouponError(data.error || 'Invalid coupon'); trackCouponError(couponCode, data.error || 'invalid'); return }
      applyCoupon(data.coupon); setCouponCode('')
      trackCouponApplied(data.coupon.code, data.coupon.discount)
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : 'network_error'
      setCouponError('Failed to apply coupon')
      trackCouponError(couponCode, reason)
    }
    finally  { setCouponLoading(false) }
  }

  // BUG FIX: separate hint handler that takes the code as a direct argument.
  // handleCoupon reads couponCode from state — calling it via setTimeout after
  // setCouponCode() would see the *old* couponCode value because React state
  // updates are asynchronous and the component hasn't re-rendered yet.
  // This handler bypasses state entirely by receiving the code as a parameter,
  // matching the same pattern used in useCartPage.handleApplyHint.
  async function handleApplyCouponHint(code: string) {
    const upper = code.trim().toUpperCase()
    if (!upper) return
    setCouponLoading(true); setCouponError('')
    try {
      const res  = await fetch('/api/v1/coupons', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ code: upper, subtotal: pricing.subtotal }),
      })
      const data = await res.json()
      if (!res.ok) { setCouponError(data.error || 'Invalid coupon'); trackCouponError(upper, data.error || 'invalid'); return }
      applyCoupon(data.coupon); setCouponCode('')
      trackCouponApplied(data.coupon.code, data.coupon.discount)
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : 'network_error'
      setCouponError('Failed to apply coupon')
      trackCouponError(upper, reason)
    }
    finally { setCouponLoading(false) }
  }

  // ── Loyalty redemption handlers ──────────────────────────────
  async function handleApplyLoyalty(ptsToRedeem: number) {
    if (loyaltyLoading) return
    setLoyaltyLoading(true); setLoyaltyError('')
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
      const data = await res.json()
      if (!res.ok) { setLoyaltyError(data.error || 'Invalid redemption'); return }
      setLoyaltyRedemption({ points: data.points, discount_inr: data.discount_inr })
    } catch { setLoyaltyError('Failed to apply coins') }
    finally  { setLoyaltyLoading(false) }
  }

  function handleRemoveLoyalty() {
    setLoyaltyRedemption(null)
    setLoyaltyError('')
  }

  const handlePlace = useCallback(async () => {
    const required = ['name','phone','flat','city','state','pincode'] as const
    setTouched(prev => { const n={...prev}; required.forEach(f=>{n[f]=true}); return n })
    const fieldLabels: Record<string,string> = {
      name:'Full Name', phone:'Mobile Number', flat:'Address',
      city:'City', state:'State', pincode:'Pincode',
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
        customer_email:         email || user?.email || '',
        items:                  items.map(i => ({ productId:i.productId, variantId:i.variantId, qty:i.qty })),
        payment_method:         payMethod,
        coupon_code:            coupon?.code,
        idempotency_key:        orderKey,
        // ── Loyalty ──────────────────────────────────────────
        loyalty_points_redeemed: loyaltyRedemption?.points ?? 0,
      }
      if (payMethod === 'cod') {
        // waNumber comes from stable primitive extracted above the callback
        const itemLines  = items.map(i => `• ${i.name} ×${i.qty} = ₹${(i.price * i.qty).toFixed(0)}`).join('\n')
        const couponLine = coupon ? `\n🎟️ Coupon ${coupon.code}: -₹${coupon.discount}` : ''
        const coinsLine  = loyaltyRedemption ? `\n🪙 Coins redeemed: -₹${loyaltyRedemption.discount_inr}` : ''
        const shipLine   = pricingShipping > 0 ? `\n🚚 Shipping: ₹${pricingShipping}` : '\n🚚 Shipping: FREE'
        const waMsg = `*New Order — 5 Pahadi Roots* 🌿\n\n` +
          `👤 *${addr.name}*\n` +
          `📱 ${addr.phone}\n` +
          (email ? `📧 ${email}\n` : '') +
          `\n📍 *Delivery Address*\n${addr.flat}, ${addr.city}, ${addr.state} — ${addr.pincode}\n\n` +
          `🛒 *Items*\n${itemLines}` +
          couponLine + coinsLine + shipLine +
          `\n\n*Total: ₹${pricingTotal}*\n\n💵 *Payment: Cash on Delivery*\n\nPlease confirm my order!`

        // ── Save to DB BEFORE touching cart state ─────────────────────────────
        // Previous code swallowed DB errors and cleared the cart anyway — orders
        // were silently lost on stock conflicts, COD-limit rejections, or network
        // failures. Now: throw on any failure so the outer try/catch surfaces the
        // error to the user and setPlacing(false) keeps the form intact.
        const dbRes  = await fetch('/api/v1/orders', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const dbData = await dbRes.json()
        if (!dbRes.ok) {
          // Real server message (e.g. "out of stock", "COD not available for this amount")
          throw new Error(dbData.error || `Order save failed (${dbRes.status})`)
        }
        const orderNumber = dbData.order_number || ''
        trackOrderPlaced(orderNumber, pricingTotal, 'cod')

        // ── DB confirmed — open WhatsApp, clear cart, redirect ────────────────
        window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(waMsg)}`, '_blank')
        orderPlacedRef.current = true
        clearCart()
        router.replace(`/order-success?id=${orderNumber}&method=cod&total=${pricingTotal}`)
      } else {
        const RZP = (window as Window & { Razorpay?: new (opts: RazorpayOptions) => { open(): void } }).Razorpay
        if (!RZP) throw new Error('Payment gateway not loaded. Please refresh.')
        const res  = await fetch('/api/v1/payments', {
          method:'POST', headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ ...payload, action:'create_payment' }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Payment initiation failed')

        // BUG C FIX: already_confirmed means the server detected this order is already
        // paid (webhook or prior verify_payment beat this retry). Don't open Razorpay —
        // passing a Razorpay payment ID ("pay_xxx") as order_id crashes the SDK.
        if (data.already_confirmed) {
          orderPlacedRef.current = true
          clearCart()
          router.replace(`/order-success?id=${data.order_number || ''}&method=razorpay&total=${pricingTotal}`)
          return
        }

        const rzp = new RZP({
          key:       razorpayKeyId,
          amount:    data.amount,
          currency:  data.currency || 'INR',
          order_id:  data.razorpay_order_id,
          name:      'Pahadi Roots',
          description: 'Natural Himalayan Products',
          image:     'https://pahadiroots.com/favicon.ico',
          prefill:   { name: addr.name, email: email || user?.email || '', contact: addr.phone },
          notes:     { db_order_id: data.order_id },
          theme:     { color: '#2C4A2E' },
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

              // waNumber comes from stable primitive extracted above the callback
              const itemLines = items.map(i => `• ${i.name} ×${i.qty} = ₹${(i.price * i.qty).toFixed(0)}`).join('\n')
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
          modal: { ondismiss: () => { setPlacing(false); ensureIdempotencyKey() } },
        })
        trackPaymentInitiated(pricingTotal)
        rzp.open(); return
      }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Something went wrong.'); setPlacing(false) }
  }, [addr, email, items, coupon, loyaltyRedemption, idempotencyKey, ensureIdempotencyKey, payMethod, user, clearCart, router, razorpayKeyId, trackOrderPlaced, trackPaymentInitiated, trackPaymentVerified, pricingShipping, pricingTotal, waNumber])

  if (!storeReady) return <CheckoutSkeleton />
  if (items.length === 0) return null

  return (
    <>
      {/* Razorpay checkout.js — loaded via Next.js Script so we get an onLoad
          callback. Previously a raw <script async> tag gave no signal when the
          library was ready, so clicking Pay Now on a slow connection threw
          "Payment gateway not loaded" with no retry path.
          razorpayLoaded gates the Pay Now button until the script is ready. */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onLoad={() => setRazorpayLoaded(true)}
        onError={() => console.error('[checkout] Razorpay script failed to load')}
      />

      <ShippingProgress
        progressBase={pricing.progressBase}
        freeShipMin={freeShipMin}
        isFreeShipping={pricing.isFreeShipping}
        remainingForFreeShip={pricing.remainingForFreeShip}
      />

      {/* Breadcrumb */}
      <nav className="ck-nav">
        <div className="ck-nav-inner">
          <div className="ck-crumb ck-crumb--done">
            <div className="ck-crumb-dot ck-crumb-dot--done">✓</div>
            <span>Cart</span>
          </div>
          <div className="ck-crumb-line ck-crumb-line--done" />
          <div className="ck-crumb ck-crumb--active">
            <div className="ck-crumb-dot ck-crumb-dot--active">2</div>
            <span>Checkout</span>
          </div>
          <div className="ck-crumb-line" />
          <div className="ck-crumb">
            <div className="ck-crumb-dot">3</div>
            <span>Confirmation</span>
          </div>
        </div>
      </nav>

      {bothPayOff && (
        <div className="ck-alert">⚠ Checkout temporarily unavailable. Please contact support.</div>
      )}

      <div className="ck-page">
        <div className="ck-grid">

          {/* ── LEFT COLUMN ── */}
          <div className="ck-left">

            <section className="ck-section">
              <div className="ck-section-header">
                <div className="ck-step-badge">01</div>
                <div>
                  <h2 className="ck-section-title">Delivery Details</h2>
                  <p className="ck-section-desc">Where should we send your order?</p>
                </div>
              </div>
              <div className="ck-section-body">
                <SavedAddressSelector
                  addresses={savedAddrs}
                  selectedIdx={selectedSavedIdx}
                  onSelect={applySaved}
                  indiaStates={INDIA_STATES}
                />
                <AddressForm
                  addr={addr}
                  email={email}
                  touched={touched}
                  onChange={setAddrField}
                  onEmailChange={setEmail}
                  onTouch={touchField}
                  selectedSavedIdx={selectedSavedIdx}
                />
              </div>
            </section>

            <section className="ck-section">
              <div className="ck-section-header">
                <div className="ck-step-badge">02</div>
                <div>
                  <h2 className="ck-section-title">Payment Method</h2>
                  <p className="ck-section-desc">Secure, encrypted &amp; instant</p>
                </div>
              </div>
              <div className="ck-section-body">
                <PaymentSection
                  payMethod={payMethod}
                  onChange={setPayMethod}
                  razorpayEnabled={razorpayEnabled}
                  codOk={codOk}
                  codEnabled={codEnabled}
                  prepaidPct={prepaidPct}
                  prepaidDiscount={pricing.prepaidDiscount}
                  codMax={codMax}
                  total={pricing.total}
                />
              </div>
            </section>

            {/* Trust strip — emojis are decorative; aria-hidden prevents screen readers
                from announcing emoji names (e.g. "delivery truck", "sparkles") */}
            <div className="ck-trust">
              {CHECKOUT_TRUST_ITEMS.map(({ icon, t, d }) => (
                <div key={t} className="ck-trust-card">
                  <div className="ck-trust-icon" aria-hidden="true">{icon}</div>
                  <div className="ck-trust-text">
                    <strong>{t}</strong>
                    <span>{d}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT COLUMN ── */}
          <aside className="ck-sidebar">
            <OrderSummary
              items={items}
              pricing={pricing}
              coupon={coupon}
              settings={s}
              couponCode={couponCode}
              couponLoading={couponLoading}
              couponError={couponError}
              couponHints={couponHints}
              onCouponCodeChange={setCouponCode}
              onApplyCoupon={handleCoupon}
              onRemoveCoupon={removeCoupon}
              onApplyHint={handleApplyCouponHint}
              loyaltyBalance={loyaltyBalance}
              loyaltyRedemption={loyaltyRedemption}
              onApplyLoyalty={handleApplyLoyalty}
              onRemoveLoyalty={handleRemoveLoyalty}
              loyaltyLoading={loyaltyLoading}
              loyaltyError={loyaltyError}
              error={error}
              placing={placing}
              bothPaymentsOff={bothPayOff}
              belowMinOrder={belowMinOrder}
              razorpayLoaded={razorpayLoaded}
              minOrderAmt={minOrderAmt}
              onPlaceOrder={handlePlace}
              payMethod={payMethod}
              summaryOpen={summaryOpen}
              onToggleSummary={() => setSummaryOpen(o => !o)}
            />
          </aside>
        </div>
      </div>

      {/* Mobile sticky footer */}
      <div className="ck-mob-bar">
        <div className="ck-mob-info">
          <span className="ck-mob-total">{formatPrice(pricing.total)}</span>
          <span className="ck-mob-sub">incl. all taxes</span>
        </div>
        <button className="ck-mob-cta" onClick={() => {
          setSummaryOpen(true)
          handlePlace().then(() => {
            setTimeout(() => {
              const errEl = document.querySelector('.os-error-box')
              if (errEl) errEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }, 100)
          })
        }}
          disabled={placing || bothPayOff || belowMinOrder || (payMethod === 'razorpay' && !razorpayLoaded)} type="button">
          {placing ? 'Placing…' : payMethod === 'razorpay' && !razorpayLoaded ? 'Loading…' : payMethod === 'razorpay' ? '⚡ Pay Now' : 'Place Order →'}
        </button>
      </div>

    </>
  )
}

