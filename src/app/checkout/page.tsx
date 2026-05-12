'use client'

/**
 * checkout/page.tsx — Enterprise Checkout Page
 *
 * ADMIN SETTINGS THAT DIRECTLY AFFECT THIS PAGE:
 * ─────────────────────────────────────────────────────────────────────────────
 * From site_settings table (real keys per types/index.ts):
 *
 *   free_shipping_min      → shipping threshold bar + shipping cost calculation
 *   flat_shipping_charge   → shipping fee when below threshold
 *   prepaid_discount_pct   → % discount shown + applied when payMethod='razorpay'
 *   cod_enabled            → shows/hides COD option (Image 2: currently OFF)
 *   cod_max_value          → max order total for COD eligibility
 *   cod_max_active_orders  → fraud guard (enforced server-side in /api/v1/orders)
 *   store_open             → if 'false', middleware redirects here before reaching page
 *   whatsapp_number        → used in support link
 *   order_email_enabled    → server-side only, no UI impact here
 *   admin_notify_email     → server-side only
 *
 * PAYMENT TOGGLE NOTES (from Image 2):
 *   The admin "Orders" tab has two independent toggles:
 *   - Enable Razorpay (UPI/Cards) → maps to: we check cod_enabled='false' + razorpay key present
 *   - Enable COD + WhatsApp       → maps to: settings.cod_enabled === 'true'
 *   Both OFF = "customers cannot checkout" — we guard this case below.
 *
 * FONT: Uses CSS vars from layout.tsx next/font setup.
 *   --font-playfair = Playfair_Display (used for headings/prices)
 *   --font-dm-sans / --font-lato = body text
 *   NO @import in this file.
 *
 * HEADER HEIGHT: sticky top = 134px max (ann + ticker + nav).
 */

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useCartStore } from '@/store/cartStore'
import { useUserStore } from '@/store/userStore'
import { formatPrice } from '@/lib/utils'
import { calcPriceSummary } from '@/lib/services/pricingService'
import type { SiteSettings, OrderAddress } from '@/types'
import useSWR from 'swr'
import { supabase } from '@/lib/supabase'

// ─── Constants ────────────────────────────────────────────────────────────────

const INDIA_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir',
  'Ladakh','Lakshadweep','Puducherry',
]

const LABEL_OPTIONS = ['Home', 'Office', 'Parents', 'Friends', 'Others'] as const
const LABEL_ICONS: Record<string, string> = {
  Home: '🏠', Office: '🏢', Parents: '👨‍👩‍👦', Friends: '👫', Others: '📍',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Parse saved_addresses JSON string from the profile API response.
// Shape per useProfile.ts SavedAddress: { id, label, name, addr, city, state, pin }
// Matches getSavedAddresses() in /lib/account/utils.ts exactly.
function parseSavedAddresses(raw: string | undefined | null): any[] {
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
}

// Match stored state string to full INDIA_STATES entry.
// Handles short names ("Himachal" → "Himachal Pradesh"), case differences, prefix matches.
function matchState(stored: string | undefined | null): string {
  if (!stored) return 'Uttarakhand'
  const s = stored.trim()
  const exact = INDIA_STATES.find(st => st === s)
  if (exact) return exact
  const ci = INDIA_STATES.find(st => st.toLowerCase() === s.toLowerCase())
  if (ci) return ci
  const lower = s.toLowerCase()
  const prefix = INDIA_STATES.find(st =>
    st.toLowerCase().startsWith(lower) || lower.startsWith(st.toLowerCase())
  )
  if (prefix) return prefix
  const word = lower.split(' ')[0]
  const contains = INDIA_STATES.find(st => st.toLowerCase().includes(word) && word.length > 3)
  if (contains) return contains
  return s  // fallback — won't crash, just won't match in <select>
}

const settingsFetcher = async (): Promise<SiteSettings> => {
  const { data } = await supabase.from('site_settings').select('key, value')
  return Object.fromEntries(
    (data || []).map((r: { key: string; value: string }) => [r.key, r.value])
  ) as SiteSettings
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CheckoutPage() {
  const router = useRouter()

  // ── Hydration guard ──────────────────────────────────────────────────────────
  // cartStore and userStore use skipHydration:true — start empty on SSR + first render.
  // Rehydration fires in StoreHydrator useEffect (providers.tsx) after mount.
  // We must suppress rendering until mounted to prevent React #425/#418/#423.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Cart store
  const items              = useCartStore(s => s.items)
  const coupon             = useCartStore(s => s.coupon)
  const idempotencyKey     = useCartStore(s => s.idempotencyKey)
  const ensureIdempotencyKey = useCartStore(s => s.ensureIdempotencyKey)
  const clearCart          = useCartStore(s => s.clearCart)
  const applyCoupon        = useCartStore(s => s.applyCoupon)
  const removeCoupon       = useCartStore(s => s.removeCoupon)

  // User store
  const user = useUserStore(s => s.user)

  // Settings
  const { data: settings } = useSWR<SiteSettings>('site_settings', settingsFetcher)
  const s = settings || {} as SiteSettings

  // ── Derived from admin settings ──
  // DEFAULT RULE: when a key is missing from the DB (undefined), default to ENABLED.
  // This prevents fresh installs from showing "checkout unavailable".
  // Admin must explicitly save 'false' to disable — which only happens after visiting the Orders tab.
  // s.cod_enabled === 'true' would be false for undefined (wrong). !== 'false' is true for undefined (correct).
  const codEnabled      = s.cod_enabled  !== 'false'   // true unless admin explicitly turned OFF
  const upiAdminOn      = s.upi_enabled  !== 'false'   // true unless admin explicitly turned OFF
  const codMax          = parseFloat(s.cod_max_value || '3000')
  const prepaidPct      = parseInt(s.prepaid_discount_pct || '5')
  const freeShipMin     = parseFloat(s.free_shipping_min || '0')
  // min_order_amount — evaluated after pricing is declared below
  const minOrderAmt     = parseFloat(s.min_order_amount || '0')
  const razorpayKeyId   = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || ''
  // Razorpay: env key must exist AND admin must not have disabled it in Orders tab
  const razorpayEnabled = !!razorpayKeyId && upiAdminOn

  // ── Local state ──
  const [payMethod, setPayMethod] = useState<'razorpay' | 'cod'>('cod')
  const [placing,   setPlacing]   = useState(false)
  const [error,     setError]     = useState('')

  const [couponCode,    setCouponCode]    = useState('')
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError,   setCouponError]   = useState('')

  const [savedAddrs,       setSavedAddrs]       = useState<any[]>([])
  const [selectedSavedIdx, setSelectedSavedIdx] = useState<number | null>(null)
  const [summaryOpen,      setSummaryOpen]       = useState(true)   // open by default on mobile
  const [touched,          setTouched]           = useState<Record<string, boolean>>({})

  // Address state — all fields match OrderAddress type exactly
  const [addr, setAddr] = useState<OrderAddress>({
    name: '', phone: '', flat: '', area: '',
    city: '', state: 'Uttarakhand', pincode: '', label: 'Home',
  })
  // Email is NOT in OrderAddress type — stored separately
  const [email, setEmail] = useState('')

  // ── Pricing — recalculates when payMethod changes (prepaid discount) ──
  const pricing       = calcPriceSummary(items, s, coupon, payMethod)
  const codOk         = codEnabled && pricing.total <= codMax
  // belowMinOrder declared here — after pricing — to avoid "used before declaration" TS error
  const belowMinOrder = minOrderAmt > 0 && pricing.subtotal < minOrderAmt

  // ── Effects ──

  // Redirect if cart becomes empty
  useEffect(() => {
    if (items.length === 0) router.replace('/cart')
  }, [items, router])

  // Fetch saved addresses and pre-fill name/phone/email from /api/profile.
  // userStore.setAddresses() is NEVER called at checkout (only in /account/addresses).
  // Addresses live in profile.saved_addresses (JSON string in Supabase profiles table).
  // This is identical to how /account/addresses/page.tsx loads its addresses.
  useEffect(() => {
    if (!user) return
    const ctrl = new AbortController()
    fetch('/api/profile', { signal: ctrl.signal })
      .then(async r => {
        if (!r.ok || ctrl.signal.aborted) return
        const data = await r.json()
        const prof = data.profile
        if (!prof) return
        // Pre-fill name/phone/email from profile scalar fields
        const fullName = [prof.first_name, prof.last_name].filter(Boolean).join(' ')
        const cleanPhone = (prof.phone || '').replace(/^\+91/, '').replace(/\D/g, '').slice(-10)
        setAddr(prev => ({
          ...prev,
          name:  prev.name  || fullName    || '',
          phone: prev.phone || cleanPhone  || '',
        }))
        setEmail(prev => prev || data.user?.email || '')

        // Build complete address list:
        //
        // 1. DEFAULT address = scalar fields on customers table (shown as PRIMARY in account)
        //    Fields: address_line1, city, state, postal_code, first_name, last_name, phone
        const defaultAddr = prof.address_line1 ? [{
          _isDefault: true,
          label:  'Home' as const,
          name:   fullName   || '',
          addr:   prof.address_line1 || '',
          area:   '',
          city:   prof.city          || '',
          state:  prof.state         || '',
          pin:    prof.postal_code   || '',
          phone:  cleanPhone         || '',
        }] : []

        // 2. SAVED addresses = saved_addresses table rows (normalized, NOT the JSON blob)
        //    The API returns them JSON-stringified in prof.saved_addresses
        //    Filter out any legacy 'Default' label entries (replaced by scalar fields above)
        const saved = parseSavedAddresses(prof.saved_addresses)
          .filter((a: any) => a.label !== 'Default')

        const allAddrs = [...defaultAddr, ...saved]
        setSavedAddrs(allAddrs)

        // Auto-apply address[0] (default) if form is still empty on load
        if (allAddrs.length > 0) {
          const a = allAddrs[0]
          setAddr(prev => {
            const formIsEmpty = !prev.flat && !prev.city && !prev.pincode
            if (!formIsEmpty) return prev  // user already typed — don't overwrite
            return {
              ...prev,
              name:    a.name  || prev.name  || '',
              phone:   a.phone || prev.phone || '',
              flat:    a.addr  || a.flat     || '',
              area:    a.area  || '',
              city:    a.city  || '',
              state:   matchState(a.state),
              pincode: a.pin   || a.pincode  || '',
              label:   (a.label as OrderAddress['label']) || 'Home',
            }
          })
          setSelectedSavedIdx(0)
        }
      })
      .catch(() => { /* non-critical — user can still type manually */ })
    return () => ctrl.abort()
  }, [user])

  // Auto-switch payment if COD becomes unavailable after settings load
  useEffect(() => {
    if (payMethod === 'cod' && !codOk && razorpayEnabled) {
      setPayMethod('razorpay')
    }
  }, [codOk, payMethod, razorpayEnabled])

  // ── Field helpers ──

  function setField(field: keyof OrderAddress, value: string) {
    setAddr(prev => ({ ...prev, [field]: value }))
    setSelectedSavedIdx(null)
  }

  function touch(field: string) {
    setTouched(prev => ({ ...prev, [field]: true }))
  }

  function fieldErr(field: keyof OrderAddress): string {
    if (!touched[field]) return ''
    const val = addr[field]?.toString().trim()
    if (!val) return 'Required'
    if (field === 'phone'   && !/^[6-9]\d{9}$/.test(addr.phone))  return 'Invalid mobile number'
    if (field === 'pincode' && !/^\d{6}$/.test(addr.pincode))      return 'Invalid 6-digit pincode'
    return ''
  }

  // applySaved maps SavedAddress → OrderAddress.
  // DB columns: addr→flat, pin→pincode, state via matchState() (handles short names)
  // NOTE: saved_addresses table has NO 'area' field — leave blank for user to fill.
  function applySaved(saved: any, idx: number) {
    setAddr(prev => ({
      ...prev,
      name:    saved.name  || prev.name,
      phone:   saved.phone || prev.phone,
      flat:    saved.addr  || saved.flat    || '',
      area:    '',                                // no area in saved_addresses table
      city:    saved.city  || '',
      state:   matchState(saved.state),           // handles "Himachal" → "Himachal Pradesh"
      pincode: saved.pin   || saved.pincode || '',
      label:   (saved.label as OrderAddress['label']) || 'Home',
    }))
    setSelectedSavedIdx(idx)
    setTouched({ name: true, phone: true, flat: true, city: true, state: true, pincode: true })
  }

  // ── Coupon ──
  async function handleCoupon() {
    if (!couponCode.trim()) return
    setCouponLoading(true)
    setCouponError('')
    try {
      const res  = await fetch('/api/v1/coupons', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: couponCode.trim().toUpperCase(), subtotal: pricing.subtotal }),
      })
      const data = await res.json()
      if (!res.ok) { setCouponError(data.error || 'Invalid coupon'); return }
      applyCoupon(data.coupon)
      setCouponCode('')
    } catch {
      setCouponError('Failed to apply coupon')
    } finally {
      setCouponLoading(false)
    }
  }

  // ── Place order ──
  const handlePlace = useCallback(async () => {
    const required = ['name', 'phone', 'flat', 'area', 'city', 'state', 'pincode'] as const

    // Touch all required fields (merge, don't replace)
    setTouched(prev => {
      const next = { ...prev }
      required.forEach(f => { next[f] = true })
      return next
    })

    // Validate
    const fieldLabels: Record<string, string> = {
      name: 'Full Name', phone: 'Mobile Number', flat: 'Address',
      area: 'Area / Landmark', city: 'City', state: 'State', pincode: 'Pincode',
    }
    for (const f of required) {
      if (!addr[f]?.toString().trim()) {
        setError(`Please fill in: ${fieldLabels[f]}`)
        return
      }
    }
    if (!/^[6-9]\d{9}$/.test(addr.phone)) {
      setError('Please enter a valid 10-digit mobile number')
      return
    }
    if (!/^\d{6}$/.test(addr.pincode)) {
      setError('Please enter a valid 6-digit pincode')
      return
    }

    setError('')
    setPlacing(true)

    try {
      const orderKey = idempotencyKey || ensureIdempotencyKey()

      const payload = {
        name:             addr.name,
        phone:            addr.phone,
        email:            email || user?.email || '',   // from own state, NOT addr.area
        flat:             addr.flat,
        area:             addr.area,
        city:             addr.city,
        state:            addr.state,
        pincode:          addr.pincode,
        label:            addr.label,
        items:            items.map(i => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })),
        payment_method:   payMethod,
        coupon_code:      coupon?.code,
        idempotency_key:  orderKey,
      }

      if (payMethod === 'cod') {
        const res  = await fetch('/api/v1/orders', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Order creation failed')
        clearCart()
        router.replace(`/order-success?id=${data.order_number}`)
        // Do NOT setPlacing(false) — navigation is in progress

      } else {
        // Razorpay online payment
        const RazorpayConstructor = (window as any).Razorpay
        if (!RazorpayConstructor) {
          throw new Error('Payment gateway not loaded. Please refresh and try again.')
        }

        const res  = await fetch('/api/v1/payments', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ...payload, action: 'create_payment' }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Payment initiation failed')

        const rzp = new RazorpayConstructor({
          key:         razorpayKeyId,
          amount:      data.amount,
          currency:    'INR',
          name:        'Pahadi Roots',
          description: 'Natural Himalayan Products',
          order_id:    data.razorpay_order_id,
          prefill:     { name: addr.name, email: email || user?.email || '', contact: addr.phone },
          theme:       { color: '#1a3a1e' },
          // Errors thrown inside this async callback are NOT caught by the outer try/catch.
          // We wrap the handler body in its own try/catch.
          handler: async (response: any) => {
            try {
              const verRes = await fetch('/api/v1/payments', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                  action:              'verify_payment',
                  razorpay_order_id:   response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature:  response.razorpay_signature,
                  order_id:            data.order_id,
                }),
              })
              const verData = await verRes.json()
              if (!verRes.ok) throw new Error(verData.error || 'Payment verification failed')
              clearCart()
              router.replace(`/order-success?id=${verData.order_number}`)
            } catch (verErr: any) {
              setError(verErr.message || 'Payment verification failed. Please contact support.')
              setPlacing(false)
            }
          },
          modal: {
            ondismiss: () => setPlacing(false),
          },
        })

        rzp.open()
        return  // placing stays true until handler resolves or modal dismissed
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.')
      setPlacing(false)
    }
  }, [
    addr, email, items, coupon, idempotencyKey, ensureIdempotencyKey,
    payMethod, user, clearCart, router, razorpayKeyId,
  ])

  // ── Guard: render null while redirect fires ──
  // Suppress render until hydrated — same pattern as ClientOnly in layout.tsx
  if (!mounted) return (
    <div style={{minHeight:'60vh',background:'#f5f0e8',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{textAlign:'center',color:'#7a7565',fontSize:'13px',fontFamily:'sans-serif'}}>
        <div style={{width:32,height:32,border:'3px solid #e2dbd0',borderTopColor:'#1a3a1e',borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto 12px'}} />
        Loading checkout…
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )

  if (items.length === 0) return null

  const savingsBadge = pricing.discount + pricing.prepaidDiscount
  const bothPaymentsOff = !codOk && !razorpayEnabled

  return (
    <>
      {/*
        Razorpay script: Loaded here as a plain tag to keep it self-contained.
        For production, move to root layout with next/script strategy="beforeInteractive".
      */}
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />

      {/* ── Shipping ticker ─────────────────────────────── */}
      {freeShipMin > 0 && (
        <div className="cho-ship-tick">
          {pricing.isFreeShipping
            ? '🎉 Free shipping applied!'
            : `🚚 Add ${formatPrice(pricing.remainingForFreeShip || 0)} more for free shipping`}
        </div>
      )}

      {/* ── Progress steps ──────────────────────────────── */}
      <div className="cho-steps">
        <div className="cho-step cho-done"><span>✓</span> Cart</div>
        <div className="cho-step-line cho-line-done" />
        <div className="cho-step cho-active"><span>2</span> Checkout</div>
        <div className="cho-step-line" />
        <div className="cho-step"><span>3</span> Confirmation</div>
      </div>

      {/* ── Both payments off — admin misconfiguration warning ── */}
      {bothPaymentsOff && (
        <div className="cho-pay-blocked" role="alert">
          ⚠ Checkout is temporarily unavailable. Please contact support or try again later.
        </div>
      )}

      <div className="cho-layout">

        {/* ═══ LEFT ═══════════════════════════════════════ */}
        <div className="cho-left">

          {/* ── 1. Delivery Details ──────────────────────── */}
          <div className="cho-card">
            <div className="cho-card-head">
              <div className="cho-num">1</div>
              <h2 className="cho-card-title">Delivery Details</h2>
            </div>

            {/* Saved addresses */}
            {savedAddrs.length > 0 && (
              <div className="cho-saved-section">
                <div className="cho-saved-label">📂 Saved Addresses</div>
                <div className="cho-saved-list">
                  {savedAddrs.map((a: any, i: number) => (
                    <div
                      key={`${i}-${a.label}`}
                      className={`cho-saved-addr${selectedSavedIdx === i ? ' selected' : ''}`}
                      onClick={() => applySaved(a, i)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && applySaved(a, i)}
                    >
                      <div className="cho-saved-check">{selectedSavedIdx === i ? '✓' : ''}</div>
                      <div className="cho-saved-info">
                        <div className="cho-saved-tag">{LABEL_ICONS[a.label] || '📍'} {a.label}</div>
                        <div className="cho-saved-text">
                          {[a.name, a.addr || a.flat, a.city, a.state, a.pin || a.pincode]
                            .filter(Boolean).join(', ')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Label picker */}
            <div className="cho-label-row">
              {LABEL_OPTIONS.map(lbl => (
                <button
                  key={lbl}
                  type="button"
                  className={`cho-label-btn${addr.label === lbl ? ' active' : ''}`}
                  onClick={() => setField('label', lbl)}
                >
                  {LABEL_ICONS[lbl]} {lbl}
                </button>
              ))}
            </div>

            {/* Form */}
            <div className="cho-form">
              <div className="cho-row">
                {/* Name */}
                <div className={`cho-field${fieldErr('name') ? ' err' : ''}`}>
                  <label className="cho-lbl" htmlFor="cho-name">Full Name *</label>
                  <input id="cho-name" className="cho-input" type="text"
                    autoComplete="name" value={addr.name}
                    onChange={e => setField('name', e.target.value)}
                    onBlur={() => touch('name')} placeholder="Ravi Kumar"
                  />
                  {fieldErr('name') && <span className="cho-ferr" role="alert">{fieldErr('name')}</span>}
                </div>

                {/* Phone */}
                <div className={`cho-field${fieldErr('phone') ? ' err' : ''}`}>
                  <label className="cho-lbl" htmlFor="cho-phone">Mobile Number *</label>
                  <div className="cho-phone-wrap">
                    <span className="cho-phone-pre">+91</span>
                    <input id="cho-phone" className="cho-input cho-phone-input"
                      type="tel" autoComplete="tel-national" inputMode="numeric"
                      value={addr.phone}
                      onChange={e => setField('phone', e.target.value.replace(/\D/g, ''))}
                      onBlur={() => touch('phone')} placeholder="9876543210" maxLength={10}
                    />
                  </div>
                  {fieldErr('phone') && <span className="cho-ferr" role="alert">{fieldErr('phone')}</span>}
                </div>
              </div>

              {/* Address */}
              <div className={`cho-field cho-field-full${fieldErr('flat') ? ' err' : ''}`}>
                <label className="cho-lbl" htmlFor="cho-flat">House / Flat, Street, Colony *</label>
                <textarea id="cho-flat" className="cho-input cho-textarea"
                  autoComplete="street-address" value={addr.flat}
                  onChange={e => setField('flat', e.target.value)}
                  onBlur={() => touch('flat')}
                  placeholder="Flat 101, Shivalik Apartments, Civil Lines" rows={2}
                />
                {fieldErr('flat') && <span className="cho-ferr" role="alert">{fieldErr('flat')}</span>}
              </div>

              {/* Area / Landmark */}
              <div className={`cho-field cho-field-full${fieldErr('area') ? ' err' : ''}`}>
                <label className="cho-lbl" htmlFor="cho-area">Area / Landmark *</label>
                <input id="cho-area" className="cho-input" type="text"
                  value={addr.area} onChange={e => setField('area', e.target.value)}
                  onBlur={() => touch('area')} placeholder="Near ISBT, Rajpur Road"
                />
                {fieldErr('area') && <span className="cho-ferr" role="alert">{fieldErr('area')}</span>}
              </div>

              <div className="cho-row">
                {/* City */}
                <div className={`cho-field${fieldErr('city') ? ' err' : ''}`}>
                  <label className="cho-lbl" htmlFor="cho-city">City *</label>
                  <input id="cho-city" className="cho-input" type="text"
                    autoComplete="address-level2" value={addr.city}
                    onChange={e => setField('city', e.target.value)}
                    onBlur={() => touch('city')} placeholder="Dehradun"
                  />
                  {fieldErr('city') && <span className="cho-ferr" role="alert">{fieldErr('city')}</span>}
                </div>

                {/* State */}
                <div className="cho-field">
                  <label className="cho-lbl" htmlFor="cho-state">State *</label>
                  <select id="cho-state" className="cho-input"
                    autoComplete="address-level1" value={addr.state}
                    onChange={e => setField('state', e.target.value)}
                  >
                    {INDIA_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                </div>
              </div>

              <div className="cho-row">
                {/* Pincode */}
                <div className={`cho-field${fieldErr('pincode') ? ' err' : ''}`}>
                  <label className="cho-lbl" htmlFor="cho-pincode">Pincode *</label>
                  <input id="cho-pincode" className="cho-input" type="text"
                    autoComplete="postal-code" inputMode="numeric"
                    value={addr.pincode}
                    onChange={e => setField('pincode', e.target.value.replace(/\D/g, ''))}
                    onBlur={() => touch('pincode')} placeholder="248001" maxLength={6}
                  />
                  {fieldErr('pincode') && <span className="cho-ferr" role="alert">{fieldErr('pincode')}</span>}
                </div>

                {/* Email — separate state, NOT addr.area */}
                <div className="cho-field">
                  <label className="cho-lbl" htmlFor="cho-email">Email (optional, for invoice)</label>
                  <input id="cho-email" className="cho-input" type="email"
                    autoComplete="email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@email.com"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── 2. Payment Method ───────────────────────── */}
          <div className="cho-card">
            <div className="cho-card-head">
              <div className="cho-num">2</div>
              <h2 className="cho-card-title">Payment Method</h2>
            </div>

            <div className="cho-pay-opts">
              {/* Razorpay / Online — shown if key is configured */}
              {razorpayEnabled && (
                <label className={`cho-pay-opt${payMethod === 'razorpay' ? ' active' : ''}`}>
                  <input type="radio" name="pay" value="razorpay"
                    checked={payMethod === 'razorpay'} onChange={() => setPayMethod('razorpay')}
                  />
                  <div className="cho-pay-body">
                    <div className="cho-pay-title">
                      Online Payment
                      {prepaidPct > 0 && <span className="cho-pay-badge">Save {prepaidPct}%</span>}
                    </div>
                    <div className="cho-pay-logos-row">
                      {[['upi','UPI'],['cards','Cards'],['nb','Net Banking'],['gpay','GPay'],['phone','PhonePe']].map(([c,l]) => (
                        <span key={c} className={`cho-pl ${c}`}>{l}</span>
                      ))}
                    </div>
                    {payMethod === 'razorpay' && pricing.prepaidDiscount > 0 && (
                      <div className="cho-pay-disc">
                        🎉 Extra {formatPrice(pricing.prepaidDiscount)} off applied!
                      </div>
                    )}
                  </div>
                </label>
              )}

              {/* COD — shown only when admin has it ON and order is within limit */}
              {codOk && (
                <label className={`cho-pay-opt${payMethod === 'cod' ? ' active' : ''}`}>
                  <input type="radio" name="pay" value="cod"
                    checked={payMethod === 'cod'} onChange={() => setPayMethod('cod')}
                  />
                  <div className="cho-pay-body">
                    <div className="cho-pay-title">💵 Cash on Delivery</div>
                    <div className="cho-pay-sub">Pay in cash when your order arrives</div>
                  </div>
                </label>
              )}

              {/* COD unavailable — explain WHY (per audit) */}
              {!codOk && codEnabled && (
                <div className="cho-cod-off">
                  <span>💵 Cash on Delivery</span>
                  <span className="cho-cod-reason">
                    {pricing.total > codMax
                      ? `COD unavailable for orders above ₹${codMax}`
                      : 'COD unavailable for your order'}
                  </span>
                </div>
              )}

              {/* COD fully disabled by admin */}
              {!codEnabled && (
                <div className="cho-cod-off">
                  <span>💵 Cash on Delivery</span>
                  <span className="cho-cod-reason">Currently unavailable</span>
                </div>
              )}
            </div>

            <div className="cho-seals">
              <span>🔒 SSL Encrypted</span>
              <span>🏦 Razorpay Secured</span>
              <span>✅ PCI-DSS</span>
              <span>🇮🇳 Made for India</span>
            </div>
          </div>

          {/* ── Delivery Promise ────────────────────────── */}
          <div className="cho-card cho-promise-card">
            <div className="cho-promise-grid">
              <div className="cho-promise-item">🚚 Delivered in 3–5 working days</div>
              <div className="cho-promise-item">🔄 7-day easy returns</div>
              <div className="cho-promise-item">🌿 100% authentic Pahadi products</div>
              <div className="cho-promise-item">📞 WhatsApp support available</div>
            </div>
          </div>
        </div>

        {/* ═══ RIGHT — Order Summary ═══════════════════════ */}
        <div className="cho-right">
          <div className="cho-summary">

            {/* Mobile accordion toggle */}
            <button
              className="cho-sum-toggle"
              onClick={() => setSummaryOpen(o => !o)}
              aria-expanded={summaryOpen}
              type="button"
            >
              <span>🧾 Order Summary ({items.length} item{items.length > 1 ? 's' : ''})</span>
              <span>{summaryOpen ? '▲' : '▼'} {formatPrice(pricing.total)}</span>
            </button>

            <div className={`cho-sum-body${summaryOpen ? ' open' : ''}`}>

              {/* Items list */}
              <div className="cho-sum-items">
                {items.map(item => (
                  <div key={item.variantId} className="cho-sum-item">
                    {/* position:relative required for next/image fill */}
                    <div className="cho-sum-img">
                      {item.image
                        ? <Image src={item.image} alt={item.name} fill sizes="52px"
                            style={{ objectFit: 'cover', borderRadius: '8px' }} />
                        : <span style={{ fontSize: '22px' }}>{item.emoji || '🌿'}</span>}
                      <span className="cho-sum-qty">{item.qty}</span>
                    </div>
                    <div className="cho-sum-info">
                      <div className="cho-sum-name">{item.name}</div>
                      {item.size && <div className="cho-sum-size">{item.size}</div>}
                    </div>
                    <div className="cho-sum-price">{formatPrice(item.price * item.qty)}</div>
                  </div>
                ))}
              </div>

              {/* Coupon */}
              <div className="cho-coupon-wrap">
                {coupon ? (
                  <div className="cho-coupon-applied">
                    <span>🎉 <strong>{coupon.code}</strong> — {formatPrice(coupon.discount)} off</span>
                    <button className="cho-coupon-rm" onClick={removeCoupon} type="button" aria-label="Remove coupon">✕</button>
                  </div>
                ) : (
                  <>
                    <div className="cho-coupon-row">
                      <input className="cho-coupon-input" type="text"
                        value={couponCode}
                        onChange={e => setCouponCode(e.target.value.toUpperCase())}
                        onKeyDown={e => e.key === 'Enter' && handleCoupon()}
                        placeholder="Coupon code" aria-label="Coupon code"
                      />
                      <button className="cho-coupon-btn" onClick={handleCoupon}
                        disabled={couponLoading} type="button">
                        {couponLoading ? '...' : 'Apply'}
                      </button>
                    </div>
                    {couponError && <p className="cho-coupon-err" role="alert">⚠ {couponError}</p>}
                  </>
                )}
              </div>

              {/* Price breakdown — uses exact PriceSummary fields */}
              <div className="cho-prices">
                <div className="cho-pr-row"><span>Subtotal</span><span>{formatPrice(pricing.subtotal)}</span></div>
                {coupon && pricing.discount > 0 && (
                  <div className="cho-pr-row cho-g"><span>Coupon ({coupon.code})</span><span>−{formatPrice(pricing.discount)}</span></div>
                )}
                {pricing.prepaidDiscount > 0 && (
                  <div className="cho-pr-row cho-g"><span>Prepaid discount ({prepaidPct}%)</span><span>−{formatPrice(pricing.prepaidDiscount)}</span></div>
                )}
                <div className="cho-pr-row">
                  <span>Shipping</span>
                  <span className={pricing.isFreeShipping ? 'cho-free' : ''}>
                    {pricing.isFreeShipping ? '🚚 FREE' : formatPrice(pricing.shipping)}
                  </span>
                </div>
                {pricing.gstTotal > 0 && (
                  <div className="cho-pr-row cho-sm"><span>GST @{items[0]?.gstRate || 5}% (inclusive)</span><span>₹{pricing.gstTotal}</span></div>
                )}
                <div className="cho-pr-divider" />
                <div className="cho-pr-total"><span>Total</span><span>{formatPrice(pricing.total)}</span></div>
                {savingsBadge > 0 && (
                  <div className="cho-saving-pill">
                    🏷 You're saving {formatPrice(savingsBadge)} on this order!
                  </div>
                )}
              </div>
            </div>

            {/* Min order warning — enforced by admin min_order_amount setting */}
            {belowMinOrder && (
              <div className="cho-error" role="alert">
                🛒 Minimum order amount is {formatPrice(minOrderAmt)}. Add{' '}
                <strong>{formatPrice(minOrderAmt - pricing.subtotal)}</strong> more to continue.
              </div>
            )}

            {/* Error */}
            {error && <div className="cho-error" role="alert">⚠ {error}</div>}

            {/* Place Order CTA */}
            <button
              className="cho-cta"
              onClick={handlePlace}
              disabled={placing || bothPaymentsOff || belowMinOrder}
              type="button"
              aria-busy={placing}
            >
              {placing ? (
                <span>⏳ Placing Order…</span>
              ) : payMethod === 'razorpay' ? (
                <><span>⚡</span><span>Pay Securely</span><span className="cho-cta-amt">{formatPrice(pricing.total)}</span></>
              ) : (
                <><span>🛒</span><span>Place COD Order</span><span className="cho-cta-amt">{formatPrice(pricing.total)}</span></>
              )}
            </button>

            <div className="cho-secure-note">🔒 100% Secure & Encrypted Checkout</div>

            <div className="cho-delivery-note">
              🚚 Estimated delivery: <strong>3–5 working days</strong> after confirmation
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile sticky CTA ───────────────────────────── */}
      <div className="cho-sticky" aria-hidden="true">
        <div>
          <div className="cho-sticky-total">{formatPrice(pricing.total)}</div>
          <div className="cho-sticky-sub">Incl. taxes & shipping</div>
        </div>
        <button className="cho-sticky-btn" onClick={handlePlace}
          disabled={placing || bothPaymentsOff || belowMinOrder} type="button">
          {placing ? '⏳ Processing…' : payMethod === 'razorpay' ? '⚡ Pay Now' : '🛒 Place Order'}
        </button>
      </div>

      <style>{CHO_CSS}</style>
    </>
  )
}

// ─── CSS — references layout.tsx font vars, no @import needed ─────────────────
const CHO_CSS = `
:root{
  --forest:#1a3a1e;--forest-mid:#2d5233;--forest-lt:#e8f5e9;
  --earth:#c8920a;--stone:#f5f0e8;--stone-mid:#ede8df;
  --white:#fff;--ink:#1a1a1a;--muted:#7a7565;--border:#e2dbd0;
  --r:14px;--sh:0 2px 10px rgba(0,0,0,.07);
}
/* Ship tick */
.cho-ship-tick{background:var(--forest-mid);color:rgba(255,255,255,.9);text-align:center;padding:8px 16px;font-size:13px;}
/* Steps */
.cho-steps{display:flex;align-items:center;justify-content:center;padding:13px 16px;background:var(--white);border-bottom:1px solid var(--border);}
.cho-step{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#bbb;}
.cho-step span{width:22px;height:22px;border-radius:50%;background:#eee;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;}
.cho-active{color:var(--forest);}.cho-active span{background:var(--forest);color:#fff;}
.cho-done{color:var(--forest-mid);}.cho-done span{background:var(--forest-lt);color:var(--forest-mid);}
.cho-step-line{width:44px;height:2px;background:#e8e8e8;margin:0 8px;}.cho-line-done{background:var(--forest-lt);}
/* Payment blocked banner */
.cho-pay-blocked{background:#fdecea;border:1px solid #f5c6cb;color:#c0392b;font-size:13px;font-weight:600;padding:12px 20px;text-align:center;}
/* Layout */
.cho-layout{display:grid;grid-template-columns:1fr 390px;gap:0;max-width:1380px;margin:0 auto;background:var(--stone);align-items:start;min-height:calc(100vh - 140px);}
@media(max-width:960px){.cho-layout{grid-template-columns:1fr;padding-bottom:76px;}}
.cho-left{padding:24px 28px;display:flex;flex-direction:column;gap:18px;}
@media(max-width:640px){.cho-left{padding:16px;}}
/* Cards */
.cho-card{background:var(--white);border-radius:var(--r);box-shadow:var(--sh);border:1px solid var(--border);overflow:hidden;}
.cho-card-head{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--stone-mid);}
.cho-num{width:27px;height:27px;border-radius:50%;background:var(--forest);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;}
.cho-card-title{font-family:var(--font-playfair,'Playfair Display',serif);font-size:17px;font-weight:700;color:var(--ink);margin:0;}
/* Saved addresses */
.cho-saved-section{padding:14px 20px 0;}
.cho-saved-label{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;}
.cho-saved-list{display:flex;flex-direction:column;gap:7px;margin-bottom:10px;}
.cho-saved-addr{display:flex;align-items:flex-start;gap:10px;padding:9px 13px;border:1.5px solid var(--border);border-radius:11px;cursor:pointer;transition:all .2s;background:#fafaf8;}
.cho-saved-addr:hover,.cho-saved-addr:focus{border-color:var(--forest);background:var(--forest-lt);outline:none;}
.cho-saved-addr.selected{border-color:var(--forest);background:var(--forest-lt);}
.cho-saved-check{width:19px;height:19px;border-radius:50%;background:#eee;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;transition:all .2s;}
.cho-saved-addr.selected .cho-saved-check{background:var(--forest);color:#fff;}
.cho-saved-tag{font-size:12px;font-weight:700;color:var(--forest);}
.cho-saved-text{font-size:11.5px;color:var(--muted);line-height:1.4;margin-top:2px;}
/* Label buttons */
.cho-label-row{display:flex;gap:7px;flex-wrap:wrap;padding:12px 20px 0;}
.cho-label-btn{border:1.5px solid var(--border);background:var(--stone);color:var(--muted);font-size:12px;font-weight:600;padding:5px 13px;border-radius:20px;cursor:pointer;transition:all .2s;}
.cho-label-btn:hover{border-color:var(--forest);color:var(--forest);}
.cho-label-btn.active{border-color:var(--forest);background:var(--forest-lt);color:var(--forest);}
/* Form */
.cho-form{padding:14px 20px;display:flex;flex-direction:column;gap:12px;}
.cho-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
@media(max-width:580px){.cho-row{grid-template-columns:1fr;}}
.cho-field{display:flex;flex-direction:column;gap:4px;}
.cho-field-full{grid-column:1/-1;}
.cho-lbl{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;}
.cho-input{padding:11px 13px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;color:var(--ink);outline:none;transition:all .2s;background:var(--white);width:100%;box-sizing:border-box;font-family:inherit;}
.cho-input:focus{border-color:var(--forest);box-shadow:0 0 0 3px rgba(26,58,30,.07);}
.cho-field.err .cho-input,.cho-field.err .cho-phone-wrap{border-color:#c0392b !important;}
.cho-ferr{font-size:11px;color:#c0392b;}
.cho-textarea{resize:vertical;min-height:66px;}
.cho-phone-wrap{display:flex;border:1.5px solid var(--border);border-radius:10px;overflow:hidden;transition:all .2s;}
.cho-phone-wrap:focus-within{border-color:var(--forest);box-shadow:0 0 0 3px rgba(26,58,30,.07);}
.cho-phone-pre{background:var(--stone);padding:11px 11px;font-size:13px;font-weight:700;color:var(--muted);border-right:1px solid var(--border);white-space:nowrap;display:flex;align-items:center;}
.cho-phone-input{border:none !important;box-shadow:none !important;border-radius:0 !important;flex:1;min-width:0;}
/* Payment options */
.cho-pay-opts{padding:14px 20px;display:flex;flex-direction:column;gap:10px;}
.cho-pay-opt{display:flex;align-items:flex-start;gap:12px;padding:13px 15px;border:1.5px solid var(--border);border-radius:12px;cursor:pointer;transition:all .2s;background:#fafaf8;}
.cho-pay-opt:hover{border-color:var(--forest);background:var(--forest-lt);}
.cho-pay-opt.active{border-color:var(--forest);background:var(--forest-lt);}
.cho-pay-opt input[type=radio]{accent-color:var(--forest);width:16px;height:16px;flex-shrink:0;margin-top:2px;cursor:pointer;}
.cho-pay-body{flex:1;}
.cho-pay-title{font-size:14px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;}
.cho-pay-badge{background:var(--forest);color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;}
.cho-pay-logos-row{display:flex;gap:5px;flex-wrap:wrap;}
.cho-pl{font-size:10px;font-weight:800;padding:3px 7px;border-radius:5px;}
.cho-pl.upi{background:#7b1fa2;color:#fff;}.cho-pl.cards{background:#1565c0;color:#fff;}
.cho-pl.nb{background:#e65100;color:#fff;}.cho-pl.gpay{background:#4285f4;color:#fff;}
.cho-pl.phone{background:#5f259f;color:#fff;}
.cho-pay-sub{font-size:12px;color:var(--muted);margin-top:4px;}
.cho-pay-disc{font-size:12px;color:#2d6a4f;font-weight:700;background:#e8f5e9;padding:4px 10px;border-radius:6px;margin-top:7px;display:inline-block;}
.cho-cod-off{padding:13px 15px;background:#f5f5f5;border:1px solid #e8e8e8;border-radius:12px;font-size:13px;color:#bbb;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;}
.cho-cod-reason{font-size:11px;color:#c0392b;font-weight:600;}
.cho-seals{display:flex;gap:10px;flex-wrap:wrap;padding:10px 20px;background:var(--stone);border-top:1px solid var(--stone-mid);font-size:11px;color:var(--muted);}
/* Promise */
.cho-promise-card{padding:0;}
.cho-promise-grid{display:grid;grid-template-columns:1fr 1fr;}
.cho-promise-item{padding:13px 17px;font-size:12px;font-weight:600;color:var(--muted);border-right:1px solid var(--stone-mid);border-bottom:1px solid var(--stone-mid);}
.cho-promise-item:nth-child(2n){border-right:none;}
.cho-promise-item:nth-child(3),.cho-promise-item:nth-child(4){border-bottom:none;}
/* Right panel */
.cho-right{
  background:var(--white);border-left:1px solid var(--border);
  position:sticky;top:134px;max-height:calc(100vh - 134px);overflow-y:auto;
}
@media(max-width:960px){.cho-right{position:static;border-left:none;border-top:1px solid var(--border);max-height:none;}}
.cho-summary{padding:18px 22px;display:flex;flex-direction:column;gap:13px;}
/* Mobile summary toggle */
.cho-sum-toggle{display:none;width:100%;background:none;border:none;padding:0;cursor:pointer;font-size:13px;font-weight:700;color:var(--ink);justify-content:space-between;align-items:center;font-family:inherit;}
@media(max-width:960px){.cho-sum-toggle{display:flex;}.cho-sum-body{display:none;}.cho-sum-body.open{display:block;}}
/* Summary items */
.cho-sum-items{display:flex;flex-direction:column;gap:9px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--stone-mid);}
.cho-sum-item{display:flex;align-items:center;gap:9px;}
/* position:relative for next/image fill */
.cho-sum-img{width:50px;height:50px;border-radius:8px;overflow:hidden;background:var(--stone);position:relative;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.cho-sum-qty{position:absolute;top:-4px;right:-4px;width:17px;height:17px;background:var(--forest);color:#fff;border-radius:50%;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;}
.cho-sum-info{flex:1;min-width:0;}
.cho-sum-name{font-size:13px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cho-sum-size{font-size:11px;color:var(--muted);}
.cho-sum-price{font-family:var(--font-playfair,'Playfair Display',serif);font-size:13px;font-weight:700;color:var(--ink);white-space:nowrap;}
/* Coupon */
.cho-coupon-wrap{margin-bottom:2px;}
.cho-coupon-row{display:flex;gap:7px;}
.cho-coupon-input{flex:1;border:1.5px solid var(--border);border-radius:8px;padding:9px 11px;font-size:13px;font-weight:600;outline:none;transition:border-color .2s;min-width:0;font-family:inherit;}
.cho-coupon-input:focus{border-color:var(--forest);}
.cho-coupon-btn{background:var(--forest);color:#fff;border:none;padding:9px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;}
.cho-coupon-btn:disabled{opacity:.6;cursor:not-allowed;}
.cho-coupon-applied{background:var(--forest-lt);border:1px solid #c8e6c9;border-radius:8px;padding:9px 12px;display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#2d6a4f;font-weight:600;gap:7px;}
.cho-coupon-rm{background:none;border:none;color:#888;font-size:15px;cursor:pointer;padding:0;}
.cho-coupon-err{font-size:11px;color:#c0392b;margin-top:3px;}
/* Prices */
.cho-prices{display:flex;flex-direction:column;gap:8px;}
.cho-pr-row{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--muted);}
.cho-g{color:#2d6a4f;font-weight:700;}.cho-free{color:#2d6a4f;font-weight:700;}.cho-sm{font-size:11px;color:#bbb;}
.cho-pr-divider{height:1px;background:var(--border);margin:4px 0;}
.cho-pr-total{display:flex;justify-content:space-between;align-items:center;font-family:var(--font-playfair,'Playfair Display',serif);font-size:20px;font-weight:700;color:var(--ink);}
.cho-saving-pill{background:var(--forest-lt);border:1px solid #c8e6c9;border-radius:8px;padding:7px 11px;font-size:12px;font-weight:700;color:#2d6a4f;text-align:center;}
/* Error */
.cho-error{background:#fdecea;border:1px solid #f5c6cb;border-radius:10px;padding:10px 13px;font-size:13px;color:#c0392b;font-weight:600;}
/* CTA */
.cho-cta{width:100%;padding:15px 18px;background:linear-gradient(135deg,var(--forest),var(--forest-mid));color:#fff;border:none;border-radius:13px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(26,58,30,.32);transition:all .25s;display:flex;align-items:center;justify-content:space-between;font-family:inherit;}
.cho-cta:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 8px 20px rgba(26,58,30,.38);}
.cho-cta:disabled{opacity:.6;cursor:not-allowed;transform:none;}
.cho-cta-amt{background:rgba(255,255,255,.2);padding:4px 11px;border-radius:20px;font-size:14px;font-weight:800;}
.cho-secure-note{text-align:center;font-size:11px;color:var(--muted);}
.cho-delivery-note{font-size:12px;color:var(--muted);background:var(--stone);padding:9px 12px;border-radius:8px;}
/* Mobile sticky */
.cho-sticky{display:none;position:fixed;bottom:0;left:0;right:0;background:var(--white);border-top:2px solid var(--border);padding:10px 16px;z-index:250;align-items:center;justify-content:space-between;gap:12px;box-shadow:0 -4px 16px rgba(0,0,0,.08);}
@media(max-width:960px){.cho-sticky{display:flex;}}
.cho-sticky-total{font-family:var(--font-playfair,'Playfair Display',serif);font-size:17px;font-weight:700;color:var(--ink);}
.cho-sticky-sub{font-size:11px;color:var(--muted);}
.cho-sticky-btn{background:linear-gradient(135deg,var(--forest),var(--forest-mid));color:#fff;border:none;padding:12px 20px;border-radius:11px;font-weight:700;font-size:14px;white-space:nowrap;cursor:pointer;font-family:inherit;}
.cho-sticky-btn:disabled{opacity:.6;cursor:not-allowed;}
@media(max-width:640px){.cho-form{padding:12px 16px;}.cho-row{grid-template-columns:1fr;}.cho-summary{padding:14px 16px;}}
`
