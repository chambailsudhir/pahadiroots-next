'use client'

import { useState, useEffect } from 'react'
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

const INDIA_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir',
  'Ladakh','Lakshadweep','Puducherry',
]
const LABEL_OPTIONS = ['Home','Office','Parents','Friends','Others'] as const

function readSavedAddresses(user: any): any[] {
  try {
    const raw = user?.saved_addresses || localStorage.getItem('pr_saved_addresses') || '[]'
    return JSON.parse(raw)
  } catch { return [] }
}

export default function CheckoutPage() {
  const router = useRouter()
  const items          = useCartStore(s => s.items)
  const coupon         = useCartStore(s => s.coupon)
  const idempotencyKey = useCartStore(s => s.idempotencyKey)
  const ensureIdempotencyKey = useCartStore(s => s.ensureIdempotencyKey)
  const clearCart      = useCartStore(s => s.clearCart)
  const applyCoupon    = useCartStore(s => s.applyCoupon)
  const removeCoupon   = useCartStore(s => s.removeCoupon)
  const user           = useUserStore(s => s.user)

  const { data: settingsRows } = useSWR('site_settings', async () => {
    const { data } = await supabase.from('site_settings').select('key, value')
    return Object.fromEntries((data || []).map((r: any) => [r.key, r.value])) as any
  })
  const settings: SiteSettings = settingsRows || {
    free_shipping_min: '799', flat_shipping_charge: '99',
    cod_enabled: 'true', prepaid_discount_pct: '5', cod_max_value: '3000',
  } as any

  const [payMethod, setPayMethod] = useState<'razorpay' | 'cod'>('cod')
  const [placing,   setPlacing]   = useState(false)
  const [error,     setError]     = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError, setCouponError] = useState('')
  const [selectedSavedAddr, setSelectedSavedAddr] = useState<string | null>(null)
  const [savedAddrs, setSavedAddrs] = useState<any[]>([])

  const [addr, setAddr] = useState<OrderAddress>({
    name:    user?.name || '',
    phone:   user?.phone || '',
    flat: '', area: '', city: '', state: 'Uttarakhand', pincode: '', label: 'Home',
  })

  const pricing      = calcPriceSummary(items, settings, coupon, payMethod)
  const codMax       = parseFloat(settings.cod_max_value || '3000')
  const codOk        = settings.cod_enabled !== 'false' && pricing.total <= codMax
  const prepaidPct   = parseInt(settings.prepaid_discount_pct || '5')
  const freeShipMin  = parseInt(settings.free_shipping_min || '0')

  useEffect(() => { if (items.length === 0) router.replace('/cart') }, [items, router])
  useEffect(() => { setSavedAddrs(readSavedAddresses(user)) }, [user])
  useEffect(() => {
    if (!user) return
    setAddr(a => ({
      ...a,
      name:  a.name  || user.name  || '',
      phone: a.phone || user.phone || '',
    }))
  }, [user])

  function setField(field: keyof OrderAddress, value: string) {
    setAddr(a => ({ ...a, [field]: value }))
    setSelectedSavedAddr(null)
  }

  function applySaved(a: any) {
    setAddr({
      name:    a.name    || addr.name,
      phone:   a.phone   || addr.phone,
      flat:    a.addr    || a.flat || '',
      area:    a.area    || '',
      city:    a.city    || '',
      state:   a.state   || 'Uttarakhand',
      pincode: a.pin     || a.pincode || '',
      label:   a.label   || 'Home',
    })
    setSelectedSavedAddr(a.label)
  }

  async function handleCoupon() {
    if (!couponCode.trim()) return
    setCouponLoading(true); setCouponError('')
    try {
      const res  = await fetch('/api/v1/coupons', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode.trim().toUpperCase(), subtotal: pricing.subtotal }),
      })
      const data = await res.json()
      if (!res.ok) { setCouponError(data.error || 'Invalid coupon'); return }
      applyCoupon(data.coupon); setCouponCode('')
    } catch { setCouponError('Failed to apply coupon') }
    finally { setCouponLoading(false) }
  }

  async function handlePlace() {
    const required = ['name','phone','flat','area','city','state','pincode'] as const
    for (const f of required) {
      if (!addr[f]?.toString().trim()) {
        setError(`Please fill in: ${f.replace('_',' ')}`); return
      }
    }
    if (!/^[6-9]\d{9}$/.test(addr.phone)) { setError('Please enter a valid 10-digit mobile number'); return }
    if (!/^\d{6}$/.test(addr.pincode))     { setError('Please enter a valid 6-digit pincode'); return }

    setError(''); setPlacing(true)
    try {
      const orderKey = idempotencyKey || ensureIdempotencyKey()
      const payload = {
        name: addr.name, phone: addr.phone, email: user?.email || '',
        flat: addr.flat, area: addr.area, city: addr.city,
        state: addr.state, pincode: addr.pincode, label: addr.label,
        items: items.map(i => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })),
        payment_method: payMethod, coupon_code: coupon?.code, idempotency_key: orderKey,
      }
      if (payMethod === 'cod') {
        const res  = await fetch('/api/v1/orders', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Order creation failed')
        clearCart()
        router.replace(`/order-success?id=${data.order_number}`)
      } else {
        const res  = await fetch('/api/v1/payments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, action: 'create_payment' }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Payment initiation failed')
        const Razorpay = (window as any).Razorpay
        const rzp = new Razorpay({
          key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
          amount: data.amount, currency: 'INR',
          name: '5 Pahadi Roots', description: 'Natural Himalayan Products',
          order_id: data.razorpay_order_id,
          prefill: { name: addr.name, email: user?.email || '', contact: addr.phone },
          theme: { color: '#1a3a1e' },
          handler: async (response: any) => {
            const verRes = await fetch('/api/v1/payments', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'verify_payment',
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature:  response.razorpay_signature,
                order_id: data.order_id,
              }),
            })
            const verData = await verRes.json()
            if (!verRes.ok) throw new Error(verData.error || 'Payment verification failed')
            clearCart()
            router.replace(`/order-success?id=${verData.order_number}`)
          },
          modal: { ondismiss: () => setPlacing(false) },
        })
        rzp.open(); return
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.')
      setPlacing(false)
    }
  }

  if (items.length === 0) return null

  const savingsBadge = pricing.discount + pricing.prepaidDiscount
  const LABEL_ICONS: Record<string, string> = { Home: '🏠', Office: '🏢', Parents: '👨‍👩‍👦', Friends: '👫', Others: '📍', Default: '🏠' }

  return (
    <>
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />

      {/* Top bar */}
      <div className="co-topbar">
        <Link href="/cart" className="co-continue">← Continue Shopping</Link>
        <div className="co-brand">🛒 Your Cart</div>
        <button className="co-clear" onClick={() => { clearCart(); router.replace('/products') }}>🗑 Clear</button>
      </div>

      {/* Free shipping ticker */}
      {freeShipMin > 0 && pricing.isFreeShipping && (
        <div className="co-ship-tick">🚚 Free shipping on all orders!</div>
      )}
      {freeShipMin > 0 && !pricing.isFreeShipping && (
        <div className="co-ship-tick">
          🚚 Add {formatPrice(pricing.remainingForFreeShip || 0)} more for <strong>free shipping!</strong>
        </div>
      )}

      <div className="co-layout">

        {/* LEFT: Cart items + You might have missed */}
        <div className="co-left">

          {/* Cart items */}
          <div className="co-items-list">
            {items.map(item => (
              <div key={item.variantId} className="co-item-row">
                <div className="co-item-img">
                  {item.image
                    ? <Image src={item.image} alt={item.name} fill sizes="60px" style={{ objectFit: 'cover', borderRadius: '8px' }} />
                    : <span style={{ fontSize: '28px' }}>{item.emoji || '🌿'}</span>}
                </div>
                <div className="co-item-info">
                  <Link href={`/products/${item.slug}`} className="co-item-name">{item.name}</Link>
                  {item.size && <div className="co-item-size">{item.size}</div>}
                  <div className="co-item-price">₹{item.price} each</div>
                </div>
                <div className="co-item-right">
                  <div className="co-qty-ctrl">
                    <button className="co-qty-btn" onClick={() => useCartStore.getState().updateQty(item.variantId, item.qty - 1)}>−</button>
                    <span className="co-qty-num">{item.qty}</span>
                    <button className="co-qty-btn" onClick={() => useCartStore.getState().updateQty(item.variantId, item.qty + 1)}>+</button>
                    <button className="co-qty-del" onClick={() => useCartStore.getState().removeItem(item.variantId)}>✕</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

        </div>

        {/* RIGHT: Order Summary + Address + Payment */}
        <div className="co-right">
          <div className="co-summary-card">
            <div className="co-summary-title">Order Summary <button className="co-edit-btn" onClick={() => router.push('/cart')}>Edit</button></div>

            {/* Coupon */}
            <div className="co-coupon-row">
              <div className="co-coupon-label">COUPON CODE</div>
              {coupon ? (
                <div className="co-coupon-applied">
                  🎉 You're saving {formatPrice(coupon.discount)}!
                  <button className="co-coupon-remove" onClick={removeCoupon}>✕</button>
                </div>
              ) : (
                <div className="co-coupon-input-row">
                  <input
                    className="co-coupon-input"
                    type="text"
                    value={couponCode}
                    onChange={e => setCouponCode(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key === 'Enter' && handleCoupon()}
                    placeholder="Enter coupon code"
                  />
                  <button className="co-coupon-apply" onClick={handleCoupon} disabled={couponLoading}>
                    {couponLoading ? '...' : 'Apply'}
                  </button>
                </div>
              )}
              {couponError && <div className="co-coupon-err">{couponError}</div>}
            </div>

            {/* Savings badge */}
            {savingsBadge > 0 && (
              <div className="co-savings-badge">
                🏷 You're saving {formatPrice(savingsBadge)}!
              </div>
            )}

            {/* Price rows */}
            <div className="co-price-rows">
              <div className="co-price-row"><span>Subtotal (incl. GST)</span><span>{formatPrice(pricing.subtotal)}</span></div>
              {coupon && <div className="co-price-row co-price-disc"><span>Coupon ({coupon.code})</span><span>−{formatPrice(pricing.discount)}</span></div>}
              {pricing.prepaidDiscount > 0 && (
                <div className="co-price-row co-price-disc"><span>Prepaid discount ({prepaidPct}%)</span><span>−{formatPrice(pricing.prepaidDiscount)}</span></div>
              )}
              {pricing.gstTotal > 0 && <div className="co-price-row co-price-gst"><span>GST @5% (included)</span><span>₹{pricing.gstTotal}</span></div>}
              <div className="co-price-row co-price-ship">
                <span>Shipping</span>
                <span>{pricing.isFreeShipping ? <span className="co-free">🚚 Free on all orders!</span> : formatPrice(pricing.shipping)}</span>
              </div>
              <div className="co-price-row co-price-total"><span>Total</span><span className="co-total-amt">{formatPrice(pricing.total)}</span></div>
            </div>

            {/* DELIVERY DETAILS */}
            <div className="co-section-title">📍 DELIVERY DETAILS</div>

            {/* Saved addresses */}
            {savedAddrs.length > 0 && (
              <div className="co-saved-label">📂 SAVED ADDRESSES — SELECT TO USE</div>
            )}
            {savedAddrs.length > 0 && (
              <div className="co-saved-addrs">
                {savedAddrs.map((a: any, i: number) => (
                  <div
                    key={i}
                    className={`co-saved-addr${selectedSavedAddr === a.label ? ' active' : ''}`}
                    onClick={() => applySaved(a)}
                  >
                    <div className="co-saved-check">{selectedSavedAddr === a.label ? '✓' : ''}</div>
                    <div>
                      <div className="co-saved-tag">{LABEL_ICONS[a.label] || '📍'} {a.label}</div>
                      <div className="co-saved-line">{[a.name, a.addr || a.flat, a.city, a.state, a.pin || a.pincode].filter(Boolean).join(', ')}</div>
                    </div>
                    {selectedSavedAddr !== a.label && <span className="co-saved-heart">🤍</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Address form */}
            <div className="co-addr-form">
              <div className="co-form-row">
                <div className="co-field">
                  <label className="co-field-label">FULL NAME *</label>
                  <input className="co-field-input" type="text" value={addr.name} onChange={e => setField('name', e.target.value)} placeholder="Ravi Kumar" />
                </div>
                <div className="co-field">
                  <label className="co-field-label">PHONE *</label>
                  <input className="co-field-input" type="tel" value={addr.phone} onChange={e => setField('phone', e.target.value)} placeholder="9876543210" maxLength={10} />
                </div>
              </div>
              <div className="co-field co-field-full">
                <label className="co-field-label">ADDRESS *</label>
                <input className="co-field-input" type="text" value={addr.flat} onChange={e => setField('flat', e.target.value)} placeholder="Flat/House No, Street, Colony" />
              </div>
              <div className="co-form-row">
                <div className="co-field">
                  <label className="co-field-label">CITY *</label>
                  <input className="co-field-input" type="text" value={addr.city} onChange={e => setField('city', e.target.value)} placeholder="Dehradun" />
                </div>
                <div className="co-field">
                  <label className="co-field-label">STATE *</label>
                  <select className="co-field-input" value={addr.state} onChange={e => setField('state', e.target.value)}>
                    {INDIA_STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="co-form-row">
                <div className="co-field">
                  <label className="co-field-label">PINCODE *</label>
                  <input className="co-field-input" type="text" value={addr.pincode} onChange={e => setField('pincode', e.target.value)} placeholder="248001" maxLength={6} />
                </div>
                <div className="co-field">
                  <label className="co-field-label">EMAIL</label>
                  <input className="co-field-input" type="email" value={addr.area} onChange={e => setField('area', e.target.value)} placeholder="you@email.com" />
                </div>
              </div>
            </div>

            {/* Payment method */}
            <div className="co-pay-section">
              <div className="co-section-title" style={{ marginTop: '20px' }}>💳 PAYMENT METHOD</div>

              {/* Prepaid */}
              <label className={`co-pay-opt${payMethod === 'razorpay' ? ' active' : ''}`}>
                <input type="radio" name="pay" value="razorpay" checked={payMethod === 'razorpay'} onChange={() => setPayMethod('razorpay')} />
                <div className="co-pay-icons">
                  <span className="co-pay-chip upi">UPI</span>
                  <span className="co-pay-chip cards">Cards</span>
                  <span className="co-pay-chip nb">Net Banking</span>
                </div>
                {prepaidPct > 0 && (
                  <div className="co-pay-badge">Save {prepaidPct}%</div>
                )}
              </label>

              {/* COD */}
              {codOk ? (
                <label className={`co-pay-opt${payMethod === 'cod' ? ' active' : ''}`}>
                  <input type="radio" name="pay" value="cod" checked={payMethod === 'cod'} onChange={() => setPayMethod('cod')} />
                  <div>
                    <div className="co-pay-cod-label">💵 Cash on Delivery</div>
                    <div className="co-pay-cod-sub">Pay when your order arrives</div>
                  </div>
                </label>
              ) : (
                <div className="co-cod-unavail">
                  COD not available {pricing.total > codMax ? `for orders above ₹${codMax}` : '— disabled'}
                </div>
              )}
            </div>

            {/* Error */}
            {error && <div className="co-error">{error}</div>}

            {/* Place order button */}
            <button className="co-place-btn" onClick={handlePlace} disabled={placing}>
              {placing
                ? '⏳ Placing Order…'
                : payMethod === 'razorpay'
                  ? `⚡ Pay ${formatPrice(pricing.total)}`
                  : `🛒 Place COD Order — ${formatPrice(pricing.total)}`}
            </button>

            <div className="co-secure">🔒 100% Secure &amp; Encrypted Checkout</div>
          </div>
        </div>
      </div>

      <style>{`
        .co-topbar{
          background:#1a3a1e;padding:10px 24px;
          display:flex;align-items:center;justify-content:space-between;
          position:sticky;top:0;z-index:100;
        }
        .co-continue{color:rgba(255,255,255,.8);font-size:13px;font-weight:700;text-decoration:none;transition:color .2s}
        .co-continue:hover{color:#c8920a}
        .co-brand{font-family:'Playfair Display',serif;font-size:16px;font-weight:900;color:#fff}
        .co-clear{background:none;border:1px solid rgba(255,255,255,.3);color:rgba(255,255,255,.7);font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px;cursor:pointer;transition:all .2s}
        .co-clear:hover{border-color:#c0392b;color:#c0392b;background:#fdecea}
        .co-ship-tick{
          background:#2d5233;padding:7px 24px;font-size:12px;font-weight:700;
          color:rgba(255,255,255,.9);text-align:center;
        }
        .co-layout{
          display:grid;grid-template-columns:1fr 380px;
          gap:0;max-width:1400px;margin:0 auto;
          background:#f5f0e8;min-height:calc(100vh - 100px);
          align-items:start;
        }
        @media(max-width:900px){.co-layout{grid-template-columns:1fr;}}

        /* LEFT */
        .co-left{padding:24px 32px;background:#f5f0e8}
        .co-items-list{display:flex;flex-direction:column;gap:0}
        .co-item-row{
          display:flex;align-items:center;gap:16px;
          padding:18px 0;border-bottom:1px solid rgba(0,0,0,.07);
        }
        .co-item-img{width:60px;height:60px;border-radius:10px;overflow:hidden;flex-shrink:0;position:relative;background:#f0ece4;display:flex;align-items:center;justify-content:center}
        .co-item-info{flex:1;min-width:0}
        .co-item-name{font-size:14px;font-weight:700;color:#1a1a1a;text-decoration:none;display:block;margin-bottom:2px}
        .co-item-name:hover{color:#1a3a1e}
        .co-item-size{font-size:11px;color:#888;margin-bottom:2px}
        .co-item-price{font-size:12px;color:#555;font-weight:600}
        .co-item-right{flex-shrink:0}
        .co-qty-ctrl{display:flex;align-items:center;gap:0}
        .co-qty-btn{width:28px;height:28px;border:1px solid #ddd;background:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;font-family:inherit;color:#333}
        .co-qty-btn:hover{background:#f5f0e8}
        .co-qty-num{width:36px;text-align:center;font-size:14px;font-weight:700;border-top:1px solid #ddd;border-bottom:1px solid #ddd;height:28px;display:flex;align-items:center;justify-content:center}
        .co-qty-del{width:28px;height:28px;border:none;background:none;font-size:14px;color:#bbb;cursor:pointer;margin-left:6px;transition:color .2s}
        .co-qty-del:hover{color:#c0392b}

        /* RIGHT */
        .co-right{background:#fff;border-left:1px solid #e8e0d0;position:sticky;top:60px;min-height:100vh;padding:0 0 40px}
        @media(max-width:900px){.co-right{position:static;border-left:none;border-top:1px solid #e8e0d0;min-height:auto}}
        .co-summary-card{padding:20px 24px}
        .co-summary-title{font-family:'Playfair Display',serif;font-size:17px;font-weight:900;color:#1a1a1a;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between}
        .co-edit-btn{font-size:11px;font-weight:700;color:#1a3a1e;background:#f0f7f0;border:1px solid #c8e6c9;padding:4px 10px;border-radius:10px;cursor:pointer;transition:all .15s}
        .co-edit-btn:hover{background:#1a3a1e;color:#fff}

        /* Coupon */
        .co-coupon-row{margin-bottom:14px}
        .co-coupon-label{font-size:10px;font-weight:800;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:7px}
        .co-coupon-input-row{display:flex;gap:8px}
        .co-coupon-input{flex:1;padding:9px 13px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:13px;font-family:inherit;outline:none;transition:border-color .2s}
        .co-coupon-input:focus{border-color:#1a3a1e}
        .co-coupon-apply{background:#1a3a1e;color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap}
        .co-coupon-applied{background:#e8f5e9;border:1px solid #c8e6c9;border-radius:8px;padding:9px 13px;font-size:13px;color:#2d6a4f;font-weight:700;display:flex;align-items:center;justify-content:space-between}
        .co-coupon-remove{background:none;border:none;cursor:pointer;color:#888;font-size:16px;padding:0 4px}
        .co-coupon-err{font-size:11px;color:#c0392b;margin-top:4px}
        .co-savings-badge{background:linear-gradient(135deg,#e8f5e9,#c8e6c9);border:1px solid #a5d6a7;border-radius:8px;padding:8px 13px;font-size:12px;font-weight:700;color:#1b5e20;margin-bottom:12px}

        /* Price rows */
        .co-price-rows{display:flex;flex-direction:column;gap:7px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #f0f0f0}
        .co-price-row{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#555}
        .co-price-disc{color:#2d6a4f;font-weight:700}
        .co-price-gst{color:#888;font-size:12px}
        .co-price-ship{font-weight:700;color:#1a3a1e}
        .co-price-total{font-size:15px;font-weight:900;color:#1a1a1a;padding-top:8px;border-top:1px solid #f0f0f0;margin-top:4px}
        .co-total-amt{font-size:18px;color:#1a3a1e}
        .co-free{color:#2d6a4f;font-weight:700}

        /* Section title */
        .co-section-title{font-size:10px;font-weight:900;color:#888;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #f0f0f0}

        /* Saved addresses */
        .co-saved-label{font-size:9.5px;font-weight:800;color:#bbb;letter-spacing:.8px;text-transform:uppercase;margin-bottom:8px}
        .co-saved-addrs{display:flex;flex-direction:column;gap:6px;margin-bottom:14px;max-height:160px;overflow-y:auto}
        .co-saved-addr{
          display:flex;align-items:flex-start;gap:10px;padding:10px 12px;
          border:1.5px solid #e8e0d0;border-radius:10px;cursor:pointer;
          transition:all .2s;background:#fafafa;position:relative;
        }
        .co-saved-addr:hover{border-color:#1a3a1e;background:#f0f7f0}
        .co-saved-addr.active{border-color:#1a3a1e;background:#e8f5e9}
        .co-saved-check{width:20px;height:20px;border-radius:50%;background:#1a3a1e;color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
        .co-saved-addr:not(.active) .co-saved-check{background:#e8e8e8;color:transparent}
        .co-saved-tag{font-size:12px;font-weight:800;color:#1a3a1e;margin-bottom:2px}
        .co-saved-line{font-size:11.5px;color:#888;line-height:1.4}
        .co-saved-heart{position:absolute;right:10px;top:10px;font-size:14px;color:#ddd}

        /* Address form */
        .co-addr-form{display:flex;flex-direction:column;gap:10px}
        .co-form-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .co-field{display:flex;flex-direction:column;gap:4px}
        .co-field-full{grid-column:1/-1}
        .co-field-label{font-size:10px;font-weight:800;color:#888;letter-spacing:.6px;text-transform:uppercase}
        .co-field-input{padding:10px 13px;border:1.5px solid #e0e0e0;border-radius:9px;font-size:13px;font-family:inherit;color:#1a1a1a;outline:none;transition:border-color .2s;background:#fff}
        .co-field-input:focus{border-color:#1a3a1e}

        /* Payment */
        .co-pay-opt{
          display:flex;align-items:center;gap:10px;padding:12px 14px;
          border:1.5px solid #e8e0d0;border-radius:10px;cursor:pointer;
          transition:all .2s;margin-bottom:8px;background:#fafafa;
        }
        .co-pay-opt input[type=radio]{accent-color:#1a3a1e;width:16px;height:16px;flex-shrink:0}
        .co-pay-opt.active{border-color:#1a3a1e;background:#f0f7f0}
        .co-pay-icons{display:flex;gap:5px;align-items:center;flex:1}
        .co-pay-chip{font-size:10px;font-weight:800;padding:3px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:.3px}
        .co-pay-chip.upi{background:#7b1fa2;color:#fff}
        .co-pay-chip.cards{background:#1565c0;color:#fff}
        .co-pay-chip.nb{background:#e65100;color:#fff}
        .co-pay-badge{background:#2e7d32;color:#fff;font-size:10px;font-weight:800;padding:3px 9px;border-radius:10px;white-space:nowrap}
        .co-pay-cod-label{font-size:13px;font-weight:700;color:#1a1a1a}
        .co-pay-cod-sub{font-size:11px;color:#888}
        .co-cod-unavail{padding:10px 14px;background:#f5f5f5;border-radius:10px;font-size:12px;color:#aaa;margin-bottom:8px}

        /* Error + Place btn */
        .co-error{background:#fdecea;border:1px solid #f5c6cb;border-radius:8px;padding:10px 13px;font-size:12px;color:#c0392b;font-weight:700;margin-top:10px}
        .co-place-btn{
          width:100%;padding:16px;margin-top:16px;
          background:linear-gradient(135deg,#1a3a1e,#2d5233);
          color:#fff;border:none;border-radius:12px;
          font-size:15px;font-weight:900;cursor:pointer;
          font-family:'Playfair Display',serif;letter-spacing:.3px;
          transition:all .25s;box-shadow:0 4px 16px rgba(26,58,30,.3);
        }
        .co-place-btn:hover:not(:disabled){background:linear-gradient(135deg,#2d5233,#3a7042);transform:translateY(-1px);box-shadow:0 6px 20px rgba(26,58,30,.4)}
        .co-place-btn:disabled{opacity:.6;cursor:not-allowed;transform:none}
        .co-secure{text-align:center;font-size:11px;color:#888;margin-top:10px;font-weight:600}
        @media(max-width:640px){
          .co-left{padding:16px}
          .co-summary-card{padding:16px}
          .co-form-row{grid-template-columns:1fr}
        }
      `}</style>
    </>
  )
}
