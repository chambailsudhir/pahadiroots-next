'use client'

/**
 * checkout/page.tsx — Lean orchestrator (~280 lines)
 *
 * All UI is delegated to:
 *   CheckoutSkeleton     → animated skeleton while stores hydrate
 *   ShippingProgress     → free-ship threshold bar
 *   SavedAddressSelector → saved address cards from /api/profile
 *   AddressForm          → form fields + pincode autofill (free API, no key)
 *   PaymentSection       → payment options with real SVG logos
 *   OrderSummary         → items, coupon hints, prices, loyalty, ETA, CTA
 *
 * ADMIN SETTINGS CONSUMED (all from site_settings table):
 *   free_shipping_min, flat_shipping_charge, prepaid_discount_pct
 *   cod_enabled, cod_max_value, min_order_amount
 *   upi_enabled, loyalty_enabled, loyalty_points_per_rupee, loyalty_points_label
 */

import { useState, useEffect, useCallback } from 'react'
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
import OrderSummary         from '@/components/checkout/OrderSummary'
import { useCheckoutAnalytics } from '@/hooks/useCheckoutAnalytics'

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

// ─── Component ────────────────────────────────────────────────────────────────
export default function CheckoutPage() {
  const router = useRouter()

  // Hydration guard — stores use skipHydration:true
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Stores
  const items              = useCartStore(s => s.items)
  const coupon             = useCartStore(s => s.coupon)
  const idempotencyKey     = useCartStore(s => s.idempotencyKey)
  const ensureIdempotencyKey = useCartStore(s => s.ensureIdempotencyKey)
  const clearCart          = useCartStore(s => s.clearCart)
  const applyCoupon        = useCartStore(s => s.applyCoupon)
  const removeCoupon       = useCartStore(s => s.removeCoupon)
  const user               = useUserStore(s => s.user)

  // Settings
  const { data: settings } = useSWR<SiteSettings>('site_settings', settingsFetcher)
  const s = settings || {} as SiteSettings

  // Admin-driven flags — default to ENABLED when key missing (never block on fresh install)
  const codEnabled      = s.cod_enabled  !== 'false'
  const upiAdminOn      = s.upi_enabled  !== 'false'
  const razorpayKeyId   = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || ''
  const razorpayEnabled = !!razorpayKeyId && upiAdminOn
  const codMax          = parseFloat(s.cod_max_value        || '3000')
  const prepaidPct      = parseInt(s.prepaid_discount_pct   || '5')
  const freeShipMin     = parseFloat(s.free_shipping_min    || '0')
  const minOrderAmt     = parseFloat(s.min_order_amount     || '0')

  // UI state
  const [payMethod, setPayMethod]   = useState<'razorpay' | 'cod'>('cod')
  const [placing,   setPlacing]     = useState(false)
  const [error,     setError]       = useState('')
  const [couponCode,    setCouponCode]    = useState('')
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError,   setCouponError]   = useState('')
  const [couponHints,   setCouponHints]   = useState<Array<{code:string,label:string}>>([])
  const [savedAddrs,       setSavedAddrs]       = useState<any[]>([])
  const [selectedSavedIdx, setSelectedSavedIdx] = useState<number | null>(null)
  const [summaryOpen,      setSummaryOpen]       = useState(true)
  const [touched,          setTouched]           = useState<Record<string, boolean>>({})
  const [addr, setAddr] = useState<OrderAddress>({
    name:'', phone:'', flat:'', area:'', city:'',
    state:'Uttarakhand', pincode:'', label:'Home',
  })
  const [email, setEmail] = useState('')

  // Pricing
  const pricing       = calcPriceSummary(items, s, coupon, payMethod)
  const codOk         = codEnabled && pricing.total <= codMax
  const belowMinOrder = minOrderAmt > 0 && pricing.subtotal < minOrderAmt
  const bothPayOff    = !codOk && !razorpayEnabled

  // Analytics — tracks funnel events, coupon usage, payment drop-off, abandonment
  const analytics = useCheckoutAnalytics({
    itemCount:      items.length,
    subtotal:       pricing.subtotal,
    payMethod,
    isFreeShipping: pricing.isFreeShipping,
  })

  // Effects
  useEffect(() => { if (items.length === 0 && mounted) router.replace('/cart') }, [items, mounted, router])

  useEffect(() => {
    if (payMethod === 'cod' && !codOk && razorpayEnabled) setPayMethod('razorpay')
  }, [codOk, payMethod, razorpayEnabled])

  // Load profile addresses + pre-fill
  useEffect(() => {
    if (!user) return
    const ctrl = new AbortController()
    fetch('/api/profile', { signal: ctrl.signal })
      .then(async r => {
        if (!r.ok || ctrl.signal.aborted) return
        const data = await r.json()
        const prof = data.profile
        if (!prof) return
        const fullName   = [prof.first_name, prof.last_name].filter(Boolean).join(' ')
        const cleanPhone = (prof.phone || '').replace(/^\+91/, '').replace(/\D/g, '').slice(-10)
        setAddr(prev => ({
          ...prev,
          name:  prev.name  || fullName    || '',
          phone: prev.phone || cleanPhone  || '',
        }))
        setEmail(prev => prev || data.user?.email || '')
        const defaultAddr = prof.address_line1 ? [{
          _isDefault:true, label:'Home' as const,
          name:fullName||'', addr:prof.address_line1||'', area:'',
          city:prof.city||'', state:prof.state||'', pin:prof.postal_code||'', phone:cleanPhone||'',
        }] : []
        const saved = parseSavedAddresses(prof.saved_addresses).filter((a:any) => a.label !== 'Default')
        const all   = [...defaultAddr, ...saved]
        setSavedAddrs(all)
        if (all.length > 0) {
          const a = all[0]
          const validLabels = ['Home','Office','Parents','Friends','Others'] as const
          const lbl = validLabels.find(l => l === a.label) || 'Home'
          setAddr(prev => {
            if (prev.flat || prev.city || prev.pincode) return prev
            return { ...prev, name:a.name||prev.name, phone:a.phone||prev.phone,
              flat:a.addr||a.flat||'', area:a.area||'', city:a.city||'',
              state:matchState(a.state), pincode:a.pin||a.pincode||'', label:lbl }
          })
          setSelectedSavedIdx(0)
        }
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [user])

  // Fetch coupon hints
  useEffect(() => {
    fetch('/api/v1/store-data')
      .then(async r => {
        if (!r.ok) return
        const data = await r.json()
        const now   = new Date()
        const hints = (data.coupons || [])
          .filter((c:any) => {
            if (c.expires_at && new Date(c.expires_at) < now) return false
            if (c.max_uses && c.uses_count >= c.max_uses)     return false
            return true
          })
          .slice(0, 3)
          .map((c:any) => ({
            code:  c.code,
            label: c.type === 'percent'
              ? `${c.value}% off${c.min_order ? ` on ₹${c.min_order}+` : ''}`
              : `₹${c.value} off${c.min_order ? ` on ₹${c.min_order}+` : ''}`,
          }))
        setCouponHints(hints)
      })
      .catch(() => {})
  }, [])

  // Handlers
  function setAddrField(field: keyof OrderAddress, value: string) {
    setAddr(prev => ({ ...prev, [field]: value }))
    if (field !== 'label') setSelectedSavedIdx(null)
  }

  function touchField(field: string) {
    setTouched(prev => ({ ...prev, [field]: true }))
  }

  function applySaved(saved: any, idx: number) {
    const validLabels = ['Home','Office','Parents','Friends','Others'] as const
    const lbl = validLabels.find(l => l === saved.label) || 'Home'
    setAddr(prev => ({
      ...prev,
      name:    saved.name  || prev.name,
      phone:   saved.phone || prev.phone,
      flat:    saved.addr  || saved.flat    || '',
      area:    '',
      city:    saved.city  || '',
      state:   matchState(saved.state),
      pincode: saved.pin   || saved.pincode || '',
      label:   lbl,
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

    setError(''); setPlacing(true)
    try {
      const orderKey = idempotencyKey || ensureIdempotencyKey()
      const payload  = {
        name:addr.name, phone:addr.phone, email:email||user?.email||'',
        flat:addr.flat, area:addr.area, city:addr.city, state:addr.state,
        pincode:addr.pincode, label:addr.label,
        items: items.map(i => ({ productId:i.productId, variantId:i.variantId, qty:i.qty })),
        payment_method:payMethod, coupon_code:coupon?.code, idempotency_key:orderKey,
      }
      if (payMethod === 'cod') {
        const res  = await fetch('/api/v1/orders', {
          method:'POST', headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Order creation failed')
        analytics.trackOrderPlaced(data.order_number, pricing.total, 'cod')
        clearCart(); router.replace(`/order-success?id=${data.order_number}`)
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
          key:razorpayKeyId, amount:data.amount, currency:'INR',
          name:'Pahadi Roots', description:'Natural Himalayan Products',
          order_id:data.razorpay_order_id,
          prefill:{ name:addr.name, email:email||user?.email||'', contact:addr.phone },
          theme:{ color:'#1a3a1e' },
          handler: async (response: any) => {
            try {
              const verRes = await fetch('/api/v1/payments', {
                method:'POST', headers:{ 'Content-Type':'application/json' },
                body: JSON.stringify({
                  action:'verify_payment',
                  razorpay_order_id:   response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature:  response.razorpay_signature,
                  order_id:            data.order_id,
                }),
              })
              const verData = await verRes.json()
              if (!verRes.ok) throw new Error(verData.error || 'Verification failed')
              analytics.trackPaymentVerified(verData.order_number, pricing.total)
              clearCart(); router.replace(`/order-success?id=${verData.order_number}`)
            } catch (e:any) { setError(e.message || 'Verification failed. Contact support.'); setPlacing(false) }
          },
          modal:{ ondismiss: () => setPlacing(false) },
        })
        analytics.trackPaymentInitiated(pricing.total)
        rzp.open(); return
      }
    } catch (e:any) { setError(e.message || 'Something went wrong.'); setPlacing(false) }
  }, [addr, email, items, coupon, idempotencyKey, ensureIdempotencyKey, payMethod, user, clearCart, router, razorpayKeyId])

  // ── Render guards ──────────────────────────────────────────────────────────
  if (!mounted) return <CheckoutSkeleton />
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

      {/* Progress steps */}
      <div className="cop-steps">
        <div className="cop-step cop-done"><span>✓</span> Cart</div>
        <div className="cop-step-line cop-line-done" />
        <div className="cop-step cop-active"><span>2</span> Checkout</div>
        <div className="cop-step-line" />
        <div className="cop-step"><span>3</span> Confirmation</div>
      </div>

      {bothPayOff && (
        <div className="cop-blocked" role="alert">
          ⚠ Checkout temporarily unavailable. Please contact support.
        </div>
      )}

      <div className="cop-layout">
        {/* ── LEFT ── */}
        <div className="cop-left">

          {/* Address card */}
          <div className="cop-card">
            <div className="cop-card-head">
              <div className="cop-num">1</div>
              <h2 className="cop-card-title">Delivery Details</h2>
            </div>
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
            />
          </div>

          {/* Payment card */}
          <div className="cop-card">
            <div className="cop-card-head">
              <div className="cop-num">2</div>
              <h2 className="cop-card-title">Payment Method</h2>
            </div>
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

          {/* Delivery promise */}
          <div className="cop-card cop-promise">
            <div className="cop-promise-grid">
              <div className="cop-promise-item">🚚 Delivered in 3–5 working days</div>
              <div className="cop-promise-item">🔄 7-day easy returns</div>
              <div className="cop-promise-item">🌿 100% authentic Pahadi products</div>
              <div className="cop-promise-item">📞 WhatsApp support available</div>
            </div>
          </div>
        </div>

        {/* ── RIGHT ── */}
        <div className="cop-right">
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
        </div>
      </div>

      {/* Mobile sticky CTA */}
      <div className="cop-sticky" aria-hidden="true">
        <div>
          <div className="cop-sticky-total">{formatPrice(pricing.total)}</div>
          <div className="cop-sticky-sub">Incl. taxes & shipping</div>
        </div>
        <button className="cop-sticky-btn" onClick={handlePlace}
          disabled={placing || bothPayOff || belowMinOrder} type="button">
          {placing ? '⏳ Processing…' : payMethod === 'razorpay' ? '⚡ Pay Now' : '🛒 Place Order'}
        </button>
      </div>

      <style>{`
        .cop-steps{display:flex;align-items:center;justify-content:center;padding:13px 16px;
          background:#fff;border-bottom:1px solid #e2dbd0;font-family:inherit;}
        .cop-step{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#bbb;}
        .cop-step span{width:22px;height:22px;border-radius:50%;background:#eee;
          display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;}
        .cop-active{color:#1a3a1e;}.cop-active span{background:#1a3a1e;color:#fff;}
        .cop-done{color:#2d5233;}.cop-done span{background:#e8f5e9;color:#2d5233;}
        .cop-step-line{width:44px;height:2px;background:#e8e8e8;margin:0 8px;}
        .cop-line-done{background:#e8f5e9;}
        .cop-blocked{background:#fdecea;border:1px solid #f5c6cb;color:#c0392b;
          font-size:13px;font-weight:600;padding:12px 20px;text-align:center;}
        .cop-layout{display:grid;grid-template-columns:1fr 390px;gap:0;
          max-width:1380px;margin:0 auto;background:#f5f0e8;
          align-items:start;min-height:calc(100vh - 120px);}
        @media(max-width:960px){.cop-layout{grid-template-columns:1fr;padding-bottom:76px;}}
        .cop-left{padding:24px 28px;display:flex;flex-direction:column;gap:18px;}
        @media(max-width:640px){.cop-left{padding:16px;}}
        .cop-card{background:#fff;border-radius:14px;
          box-shadow:0 2px 8px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.03);
          border:1px solid #e2dbd0;overflow:hidden;}
        .cop-card-head{display:flex;align-items:center;gap:12px;padding:16px 20px;
          border-bottom:1px solid #f5f0e8;}
        .cop-num{width:27px;height:27px;border-radius:50%;background:#1a3a1e;
          color:#fff;display:flex;align-items:center;justify-content:center;
          font-size:13px;font-weight:700;flex-shrink:0;}
        .cop-card-title{font-size:17px;font-weight:700;color:#1a1a1a;margin:0;
          font-family:var(--font-playfair,'Playfair Display',serif);}
        .cop-promise{padding:0;}
        .cop-promise-grid{display:grid;grid-template-columns:1fr 1fr;}
        .cop-promise-item{padding:13px 17px;font-size:12px;font-weight:600;color:#7a7565;
          border-right:1px solid #f5f0e8;border-bottom:1px solid #f5f0e8;}
        .cop-promise-item:nth-child(2n){border-right:none;}
        .cop-promise-item:nth-child(3),.cop-promise-item:nth-child(4){border-bottom:none;}
        .cop-right{background:#fff;border-left:1px solid #e2dbd0;
          position:sticky;top:134px;max-height:calc(100vh - 134px);overflow-y:auto;}
        @media(max-width:960px){.cop-right{position:static;border-left:none;
          border-top:1px solid #e2dbd0;max-height:none;}}
        .cop-sticky{display:none;position:fixed;bottom:0;left:0;right:0;
          background:#fff;border-top:2px solid #e2dbd0;padding:10px 16px;
          z-index:250;align-items:center;justify-content:space-between;gap:12px;
          box-shadow:0 -4px 16px rgba(0,0,0,.08);}
        @media(max-width:960px){.cop-sticky{display:flex;}}
        .cop-sticky-total{font-size:17px;font-weight:700;color:#1a1a1a;font-family:inherit;}
        .cop-sticky-sub{font-size:11px;color:#7a7565;font-family:inherit;}
        .cop-sticky-btn{background:linear-gradient(135deg,#1a3a1e,#2d5233);
          color:#fff;border:none;padding:12px 20px;border-radius:11px;
          font-weight:700;font-size:14px;white-space:nowrap;cursor:pointer;
          font-family:inherit;box-shadow:0 4px 10px rgba(26,58,30,.28);}
        .cop-sticky-btn:disabled{opacity:.6;cursor:not-allowed;}
      `}</style>
    </>
  )
}
