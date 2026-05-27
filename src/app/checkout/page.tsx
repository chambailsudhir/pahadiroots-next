'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useCartStore } from '@/store/cartStore'
import { useUserStore } from '@/store/userStore'
import { formatPrice } from '@/lib/utils'
import { calcPriceSummary } from '@/lib/services/pricingService'
import type { SiteSettings, OrderAddress } from '@/types'
import useSWR from 'swr'
import { supabase } from '@/lib/supabase'

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

const INDIA_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir',
  'Ladakh','Lakshadweep','Puducherry',
]

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

function parseSavedAddresses(raw: string | undefined | null): any[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

const settingsFetcher = async (): Promise<SiteSettings> => {
  const { data } = await supabase.from('site_settings').select('key, value')
  return Object.fromEntries(
    (data || []).map((r: { key: string; value: string }) => [r.key, r.value])
  ) as SiteSettings
}

export default function CheckoutPage() {
  const router = useRouter()
  const [storeReady, setStoreReady] = useState(false)
  useEffect(() => { setStoreReady(true) }, [])

  const [mounted, setMounted] = useState(true)
  const _setMounted = setMounted

  const items              = useCartStore(s => s.items)
  const coupon             = useCartStore(s => s.coupon)
  const idempotencyKey     = useCartStore(s => s.idempotencyKey)
  const ensureIdempotencyKey = useCartStore(s => s.ensureIdempotencyKey)
  const clearCart          = useCartStore(s => s.clearCart)
  const applyCoupon        = useCartStore(s => s.applyCoupon)
  const removeCoupon       = useCartStore(s => s.removeCoupon)
  const user               = useUserStore(s => s.user)

  const { data: settings } = useSWR<SiteSettings>('site_settings', settingsFetcher)
  const s = settings || {} as SiteSettings

  const codEnabled      = s.cod_enabled  !== 'false'
  const upiAdminOn      = s.upi_enabled  !== 'false'
  const razorpayKeyId   = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || ''
  const razorpayEnabled = !!razorpayKeyId && upiAdminOn
  const codMax          = parseFloat(s.cod_max_value        || '3000')
  const prepaidPct      = parseInt(s.prepaid_discount_pct   || '5')
  const freeShipMin     = parseFloat(s.free_shipping_min    || '0')
  const minOrderAmt     = parseFloat(s.min_order_amount     || '0')

  const [payMethod, setPayMethod]   = useState<'razorpay' | 'cod'>('cod')
  const [placing,   setPlacing]     = useState(false)
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

  const [savedAddrs,       setSavedAddrs]       = useState<any[]>(() => {
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
  function writeProfileCache(profile: any, addresses: any[]) {
    _writeProfileCache({ ts: Date.now(), profile, addresses })
  }

  function applyProfileData(prof: any, allAddrs: any[], setAddrFn: typeof setAddr, setEmailFn: typeof setEmail, setSavedFn: typeof setSavedAddrs) {
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
          flat: a.addr||a.flat||'', area: a.area||'', city: a.city||'',
          state: matchState(a.state), pincode: a.pin||a.pincode||'', label: lbl }
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
          flat: a.addr||a.flat||'', area: a.area||'', city: a.city||'',
          state: matchState(a.state), pincode: a.pin||a.pincode||'', label: lbl }
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

  const pricing = calcPriceSummary(
    items, s, coupon, payMethod,
    loyaltyRedemption?.discount_inr ?? 0,   // ← loyalty discount
  )
  const codOk         = codEnabled && pricing.subtotal <= codMax
  const belowMinOrder = minOrderAmt > 0 && pricing.subtotal < minOrderAmt
  const bothPayOff    = !codOk && !razorpayEnabled

  const analytics = useCheckoutAnalytics({
    itemCount: items.length, subtotal: pricing.subtotal,
    payMethod, isFreeShipping: pricing.isFreeShipping,
  })

  const orderPlacedRef = useRef(false)
  useEffect(() => {
    if (items.length === 0 && mounted && !orderPlacedRef.current) router.replace('/cart')
  }, [items, mounted, router])
  useEffect(() => {
    if (payMethod === 'cod' && !codOk && razorpayEnabled) setPayMethod('razorpay')
    if (payMethod === 'razorpay' && !razorpayEnabled && codOk) setPayMethod('cod')
  }, [codOk, payMethod, razorpayEnabled])

  // ── Fetch loyalty balance (logged-in users only) ─────────────
  useEffect(() => {
    if (s.loyalty_enabled !== 'true') return
    fetch('/api/v1/loyalty')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.points) setLoyaltyBalance(d.points) })
      .catch(() => {})
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
          _isDefault:true, label:'Home' as const, name:fullName||'', addr:prof.address_line1||'',
          area:'', city:prof.city||'', state:prof.state||'', pin:prof.postal_code||'', phone:cleanPhone||'',
        }] : []
        const saved = parseSavedAddresses(prof.saved_addresses).filter((a:any) => a.label !== 'Default')
        const all   = [...defaultAddr, ...saved]
        writeProfileCache(prof, all)
        applyProfileData(prof, all, setAddr, setEmail, setSavedAddrs)
        if (all.length > 0) setSelectedSavedIdx(0)
      })
      .catch(() => {})
    return () => ctrl.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetch('/api/v1/store-data').then(async r => {
      if (!r.ok) return
      const data = await r.json()
      const now = new Date()
      const hints = (data.coupons || [])
        .filter((c:any) => {
          if (c.expires_at && new Date(c.expires_at) < now) return false
          if (c.max_uses && c.uses_count >= c.max_uses) return false
          return true
        })
        .slice(0, 3)
        .map((c:any): { code: string; label: string } => ({
          code: c.code,
          label: c.type === 'percent'
            ? `${c.value}% off${c.min_order ? ` on ₹${c.min_order}+` : ''}`
            : `₹${c.value} off${c.min_order ? ` on ₹${c.min_order}+` : ''}`,
        }))
      setCouponHints(hints)
    }).catch(() => {})
  }, [])

  function setAddrField(field: keyof OrderAddress, value: string) {
    setAddr(prev => ({ ...prev, [field]: value }))
    if (field !== 'label') setSelectedSavedIdx(null)
  }
  function touchField(field: string) { setTouched(prev => ({ ...prev, [field]: true })) }

  function applySaved(saved: any, idx: number) {
    const validLabels = ['Home','Office','Parents','Friends','Others'] as const
    const lbl = validLabels.find(l => l === saved.label) || 'Home'
    setAddr(prev => ({
      ...prev, name:saved.name||prev.name, phone:saved.phone||prev.phone,
      flat:saved.addr||saved.flat||'', area:saved.area||'', city:saved.city||'',
      state:matchState(saved.state), pincode:saved.pin||saved.pincode||'', label:lbl,
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
      if (!res.ok) { setCouponError(data.error || 'Invalid coupon'); analytics.trackCouponError(couponCode, data.error || 'invalid'); return }
      applyCoupon(data.coupon); setCouponCode('')
      analytics.trackCouponApplied(data.coupon.code, data.coupon.discount)
    } catch { setCouponError('Failed to apply coupon') }
    finally  { setCouponLoading(false) }
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
        const waNumber   = s.whatsapp_number || '919899984895'
        const itemLines  = items.map(i => `• ${i.name} ×${i.qty} = ₹${(i.price * i.qty).toFixed(0)}`).join('\n')
        const couponLine = coupon ? `\n🎟️ Coupon ${coupon.code}: -₹${coupon.discount}` : ''
        const coinsLine  = loyaltyRedemption ? `\n🪙 Coins redeemed: -₹${loyaltyRedemption.discount_inr}` : ''
        const shipLine   = pricing.shipping > 0 ? `\n🚚 Shipping: ₹${pricing.shipping}` : '\n🚚 Shipping: FREE'
        const waMsg = `*New Order — 5 Pahadi Roots* 🌿\n\n` +
          `👤 *${addr.name}*\n` +
          `📱 ${addr.phone}\n` +
          (email ? `📧 ${email}\n` : '') +
          `\n📍 *Delivery Address*\n${addr.flat}, ${addr.city}, ${addr.state} — ${addr.pincode}\n\n` +
          `🛒 *Items*\n${itemLines}` +
          couponLine + coinsLine + shipLine +
          `\n\n*Total: ₹${pricing.total}*\n\n💵 *Payment: Cash on Delivery*\n\nPlease confirm my order!`

        let orderNumber = ''
        try {
          const dbRes  = await fetch('/api/v1/orders', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          const dbData = await dbRes.json()
          if (dbRes.ok) {
            orderNumber = dbData.order_number || ''
            analytics.trackOrderPlaced(orderNumber, pricing.total, 'cod')
          }
        } catch (e) { console.error('[COD] DB save failed:', e) }

        window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(waMsg)}`, '_blank')
        orderPlacedRef.current = true
        clearCart()
        router.replace(`/order-success?id=${orderNumber}&method=cod&total=${pricing.total}`)
      } else {
        const RZP = (window as any).Razorpay
        if (!RZP) throw new Error('Payment gateway not loaded. Please refresh.')
        const res  = await fetch('/api/v1/payments', {
          method:'POST', headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ ...payload, action:'create_payment' }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Payment initiation failed')
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
          handler: async (response: any) => {
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

              const waNumber  = s.whatsapp_number || '919899984895'
              const itemLines = items.map(i => `• ${i.name} ×${i.qty} = ₹${(i.price * i.qty).toFixed(0)}`).join('\n')
              const couponLine = coupon ? `\n🎟️ Coupon ${coupon.code}: -₹${coupon.discount}` : ''
              const coinsLine  = loyaltyRedemption ? `\n🪙 Coins redeemed: -₹${loyaltyRedemption.discount_inr}` : ''
              const shipLine   = pricing.shipping > 0 ? `\n🚚 Shipping: ₹${pricing.shipping}` : '\n🚚 Shipping: FREE'
              const waMsg = `✅ *Payment Confirmed — 5 Pahadi Roots* 🌿\n\n` +
                `✅ *Payment ID:* ${response.razorpay_payment_id}\n` +
                `👤 *${addr.name}*\n📱 ${addr.phone}\n` +
                (email ? `📧 ${email}\n` : '') +
                `\n📍 ${addr.flat}, ${addr.city}, ${addr.state} — ${addr.pincode}\n\n` +
                `🛒 *Items*\n${itemLines}` + couponLine + coinsLine + shipLine +
                `\n\n*Total Paid: ₹${pricing.total}*`
              window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(waMsg)}`, '_blank')

              analytics.trackPaymentVerified(verData.order_number, pricing.total)
              orderPlacedRef.current = true
              clearCart()
              router.replace(`/order-success?id=${verData.order_number || ''}&method=razorpay&total=${pricing.total}`)
            } catch (e:any) {
              setError(e.message || 'Payment verified but order save failed. Contact support with payment ID: ' + response.razorpay_payment_id)
              setPlacing(false)
            }
          },
          modal: { ondismiss: () => { setPlacing(false); ensureIdempotencyKey() } },
        })
        analytics.trackPaymentInitiated(pricing.total)
        rzp.open(); return
      }
    } catch (e:any) { setError(e.message || 'Something went wrong.'); setPlacing(false) }
  }, [addr, email, items, coupon, loyaltyRedemption, idempotencyKey, ensureIdempotencyKey, payMethod, user, clearCart, router, razorpayKeyId])

  if (!storeReady) return <CheckoutSkeleton />
  if (items.length === 0) return null

  return (
    <>
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />

      <ShippingProgress
        subtotal={pricing.subtotal}
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

            {/* Trust strip */}
            <div className="ck-trust">
              {[
                { icon:'🚚', t:'3–5 Day Delivery', d:'Pan-India Himalayan dispatch' },
                { icon:'🔄', t:'7-Day Returns',    d:'Hassle-free, no questions' },
                { icon:'🌿', t:'100% Authentic',   d:'Straight from the mountains' },
                { icon:'💬', t:'WhatsApp Support', d:'Real humans, always here' },
              ].map(({ icon, t, d }) => (
                <div key={t} className="ck-trust-card">
                  <div className="ck-trust-icon">{icon}</div>
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
          disabled={placing || bothPayOff || belowMinOrder} type="button">
          {placing ? 'Placing…' : payMethod === 'razorpay' ? '⚡ Pay Now' : 'Place Order →'}
        </button>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=DM+Sans:wght@300;400;500;600&display=swap');

        .ck-nav { background: #FDFAF5; border-bottom: 1px solid #E8E0D5; }
        .ck-nav-inner { max-width: 1440px; margin: 0 auto; padding: 12px 40px; display: flex; align-items: center; gap: 0; }
        @media (max-width: 640px) { .ck-nav-inner { padding: 12px 16px; } }
        .ck-crumb { display: flex; align-items: center; gap: 8px; font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 500; color: #BDB5A8; letter-spacing: 0.02em; }
        .ck-crumb--done { color: #7A9A6A; }
        .ck-crumb--active { color: #2C4A2E; font-weight: 600; }
        .ck-crumb-dot { width: 24px; height: 24px; border-radius: 50%; background: #E8E0D5; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; }
        .ck-crumb-dot--done { background: #D4E8C8; color: #4A7A3A; font-size: 11px; }
        .ck-crumb-dot--active { background: #2C4A2E; color: #F5F0E8; box-shadow: 0 0 0 3px rgba(44,74,46,.15); }
        .ck-crumb-line { flex: 0 0 40px; height: 1px; background: #E0D8CE; margin: 0 8px; }
        .ck-crumb-line--done { background: #B8D4A8; }
        .ck-alert { background: #FEF0EE; border-bottom: 1px solid #F5C8C0; color: #B03020; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; padding: 10px 40px; text-align: center; }
        .ck-page { background: #F7F2EB; min-height: calc(100vh - 100px); width: 100%; }
        .ck-grid { max-width: 1440px; margin: 0 auto; display: grid; grid-template-columns: 1fr 420px; min-height: calc(100vh - 100px); }
        @media (max-width: 1200px) { .ck-grid { grid-template-columns: 1fr 380px; } }
        @media (max-width: 960px)  { .ck-grid { grid-template-columns: 1fr; padding-bottom: 80px; } }
        .ck-left { padding: 40px 48px 60px 48px; display: flex; flex-direction: column; gap: 28px; }
        @media (max-width: 1100px) { .ck-left { padding: 32px 32px 48px; } }
        @media (max-width: 640px)  { .ck-left { padding: 20px 16px 40px; gap: 20px; } }
        .ck-section { background: #FFFFFF; border-radius: 20px; overflow: hidden; box-shadow: 0 1px 2px rgba(44,30,10,.04), 0 4px 20px rgba(44,30,10,.07), inset 0 1px 0 rgba(255,255,255,.8); border: 1px solid rgba(220,210,195,.6); transition: box-shadow .3s ease; }
        .ck-section:hover { box-shadow: 0 2px 4px rgba(44,30,10,.05), 0 8px 32px rgba(44,30,10,.1), inset 0 1px 0 rgba(255,255,255,.8); }
        .ck-section-header { display: flex; align-items: flex-start; gap: 16px; padding: 24px 28px 20px; border-bottom: 1px solid #F2EDE5; background: linear-gradient(180deg, #FEFCF9 0%, #FFFFFF 100%); }
        @media (max-width: 640px) { .ck-section-header { padding: 18px 20px 16px; } }
        .ck-step-badge { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 13px; font-weight: 600; color: #F7F2EB; background: #2C4A2E; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; letter-spacing: 0.5px; box-shadow: 0 4px 12px rgba(44,74,46,.3); margin-top: 2px; }
        .ck-section-title { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 22px; font-weight: 600; color: #1C2B1E; margin: 0 0 3px; letter-spacing: -0.3px; line-height: 1.2; }
        .ck-section-desc { font-family: 'DM Sans', sans-serif; font-size: 12px; color: #9A9080; margin: 0; font-weight: 400; letter-spacing: 0.01em; }
        .ck-section-body { padding: 0; }
        .ck-trust { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 480px) { .ck-trust { grid-template-columns: 1fr; } }
        .ck-trust-card { background: #FFFFFF; border: 1px solid rgba(220,210,195,.6); border-radius: 16px; padding: 16px 18px; display: flex; align-items: flex-start; gap: 12px; box-shadow: 0 2px 8px rgba(44,30,10,.04); transition: all .25s ease; }
        .ck-trust-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(44,30,10,.09); border-color: rgba(180,210,160,.7); }
        .ck-trust-icon { font-size: 22px; flex-shrink: 0; }
        .ck-trust-text { display: flex; flex-direction: column; gap: 2px; }
        .ck-trust-text strong { font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; color: #2C3A28; }
        .ck-trust-text span { font-family: 'DM Sans', sans-serif; font-size: 11px; color: #9A9080; }
        .ck-sidebar { background: transparent; border-left: none; position: sticky; top: 0; height: 100vh; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: #D8D0C4 transparent; padding: 40px 24px 40px 20px; }
        .ck-sidebar::-webkit-scrollbar { width: 3px; }
        .ck-sidebar::-webkit-scrollbar-track { background: transparent; }
        .ck-sidebar::-webkit-scrollbar-thumb { background: #D8D0C4; border-radius: 3px; }
        @media (max-width: 960px) { .ck-sidebar { position: static; height: auto; border-left: none; padding: 0 16px 40px; } }
        .ck-mob-bar { display: none; position: fixed; bottom: 0; left: 0; right: 0; background: rgba(255,255,255,.96); backdrop-filter: blur(16px); border-top: 1px solid #E8E0D5; padding: 14px 20px; z-index: 300; align-items: center; justify-content: space-between; gap: 16px; box-shadow: 0 -8px 32px rgba(0,0,0,.08); }
        @media (max-width: 960px) { .ck-mob-bar { display: flex; } }
        .ck-mob-info { display: flex; flex-direction: column; }
        .ck-mob-total { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 22px; font-weight: 700; color: #1C2B1E; line-height: 1; }
        .ck-mob-sub { font-family: 'DM Sans', sans-serif; font-size: 10px; color: #9A9080; margin-top: 2px; font-weight: 400; }
        .ck-mob-cta { background: #2C4A2E; color: #F5F0E8; border: none; padding: 14px 24px; border-radius: 14px; font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 14px; cursor: pointer; white-space: nowrap; box-shadow: 0 4px 16px rgba(44,74,46,.35); transition: all .2s; letter-spacing: 0.02em; }
        .ck-mob-cta:hover:not(:disabled) { background: #3A6040; box-shadow: 0 8px 24px rgba(44,74,46,.45); transform: translateY(-1px); }
        .ck-mob-cta:disabled { opacity: .5; cursor: not-allowed; }
      `}</style>
    </>
  )
}
