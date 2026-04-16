'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCartStore } from '@/store/cartStore'
import { useUserStore } from '@/store/userStore'
import { formatPrice, generateUUID } from '@/lib/utils'
import { calcPriceSummary } from '@/lib/services/pricingService'
import type { SiteSettings, OrderAddress } from '@/types'

// Loaded via layout — passed as prop from a server wrapper
// For the client page, we fetch settings via SWR
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

const LABEL_OPTIONS = ['Home', 'Office', 'Parents', 'Friends', 'Others'] as const

export default function CheckoutPage() {
  const router = useRouter()
  const items        = useCartStore(s => s.items)
  const coupon       = useCartStore(s => s.coupon)
  const idempotencyKey = useCartStore(s => s.idempotencyKey)
  const clearCart    = useCartStore(s => s.clearCart)
  const user         = useUserStore(s => s.user)
  const savedAddresses = useUserStore(s => s.savedAddresses)

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

  const [addr, setAddr] = useState<OrderAddress>({
    name: user?.name || '', phone: user?.phone || '',
    flat: '', area: '', city: '', state: 'Uttarakhand', pincode: '',
    label: 'Home',
  })

  const pricing = calcPriceSummary(items, settings, coupon, payMethod)
  const codMax  = parseFloat(settings.cod_max_value || '3000')
  const codOk   = settings.cod_enabled !== 'false' && pricing.total <= codMax
  const prepaidPct = parseInt(settings.prepaid_discount_pct || '5')

  // Redirect if cart empty
  useEffect(() => {
    if (items.length === 0) router.replace('/cart')
  }, [items, router])

  function setField(field: keyof OrderAddress, value: string) {
    setAddr(a => ({ ...a, [field]: value }))
  }

  async function handlePlace() {
    // Basic validation
    const required = ['name', 'phone', 'flat', 'area', 'city', 'state', 'pincode'] as const
    for (const f of required) {
      if (!addr[f]?.toString().trim()) {
        setError(`Please fill in your ${f.replace('_', ' ')}`)
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
      const payload = {
        address:         addr,
        items:           items.map(i => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })),
        payment_method:  payMethod,
        coupon_code:     coupon?.code,
        idempotency_key: idempotencyKey,
        customer_email:  user?.email,
        customer_id:     user?.id,
      }

      if (payMethod === 'cod') {
        const res  = await fetch('/api/v1/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Order creation failed')
        clearCart()
        router.replace(`/order-success?id=${data.order_number}`)

      } else {
        // Razorpay flow
        const res  = await fetch('/api/v1/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, action: 'create_payment' }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Payment initiation failed')

        const Razorpay = (window as any).Razorpay
        const rzp = new Razorpay({
          key:          process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
          amount:       data.amount,
          currency:     'INR',
          name:         'Pahadi Roots',
          description:  'Natural Himalayan Products',
          order_id:     data.razorpay_order_id,
          prefill: {
            name:  addr.name,
            email: user?.email || '',
            contact: addr.phone,
          },
          theme: { color: '#1a6b20' },
          handler: async (response: any) => {
            // Verify payment
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
            if (!verRes.ok) throw new Error(verData.error || 'Payment verification failed')
            clearCart()
            router.replace(`/order-success?id=${verData.order_number}`)
          },
          modal: { ondismiss: () => setPlacing(false) },
        })
        rzp.open()
        return
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.')
      setPlacing(false)
    }
  }

  if (items.length === 0) return null

  return (
    <>
      {/* Razorpay script */}
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-stone-900 mb-7">Checkout</h1>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">

          {/* Left: Address + Payment */}
          <div className="space-y-6">

            {/* Address */}
            <section className="bg-white border border-stone-200 rounded-2xl p-6">
              <h2 className="text-base font-bold text-stone-900 mb-4">Delivery Address</h2>

              {/* Saved addresses */}
              {savedAddresses.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-4">
                  {savedAddresses.map(a => (
                    <button
                      key={a.id}
                      onClick={() => setAddr({ ...a })}
                      className="text-xs border border-stone-200 rounded-xl px-3 py-2 hover:border-forest-400 hover:bg-forest-50 transition-colors text-left"
                    >
                      <div className="font-semibold text-stone-700">{a.label || 'Saved'}</div>
                      <div className="text-stone-400 truncate max-w-[160px]">{a.flat}, {a.city}</div>
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { field: 'name',    label: 'Full Name',     placeholder: 'Ravi Kumar',     span: false },
                  { field: 'phone',   label: 'Mobile Number', placeholder: '98765 43210',    span: false },
                  { field: 'flat',    label: 'Flat / House / Building', placeholder: 'A-12, Green Apartments', span: true },
                  { field: 'area',    label: 'Area / Colony', placeholder: 'Sector 15',       span: false },
                  { field: 'city',    label: 'City',          placeholder: 'Dehradun',        span: false },
                  { field: 'pincode', label: 'Pincode',       placeholder: '248001',          span: false },
                ].map(({ field, label, placeholder, span }) => (
                  <div key={field} className={span ? 'sm:col-span-2' : ''}>
                    <label className="block text-xs font-semibold text-stone-600 mb-1">{label}</label>
                    <input
                      type={field === 'phone' ? 'tel' : field === 'pincode' ? 'number' : 'text'}
                      value={(addr as any)[field] || ''}
                      onChange={e => setField(field as keyof OrderAddress, e.target.value)}
                      placeholder={placeholder}
                      className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm text-stone-800 outline-none focus:border-forest-500 transition-colors"
                      maxLength={field === 'phone' ? 10 : field === 'pincode' ? 6 : 200}
                    />
                  </div>
                ))}

                {/* State dropdown */}
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1">State</label>
                  <select
                    value={addr.state}
                    onChange={e => setField('state', e.target.value)}
                    className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm text-stone-800 outline-none focus:border-forest-500 bg-white"
                  >
                    {INDIA_STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>

                {/* Label */}
                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1">Save Address As</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {LABEL_OPTIONS.map(l => (
                      <button
                        key={l}
                        onClick={() => setField('label', l)}
                        type="button"
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          addr.label === l
                            ? 'border-forest-600 bg-forest-50 text-forest-700'
                            : 'border-stone-200 text-stone-500 hover:border-forest-300'
                        }`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Payment */}
            <section className="bg-white border border-stone-200 rounded-2xl p-6">
              <h2 className="text-base font-bold text-stone-900 mb-4">Payment Method</h2>
              <div className="space-y-3">

                {/* Prepaid / Razorpay */}
                <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                  payMethod === 'razorpay' ? 'border-forest-600 bg-forest-50' : 'border-stone-200 hover:border-stone-300'
                }`}>
                  <input
                    type="radio" name="payment" value="razorpay"
                    checked={payMethod === 'razorpay'}
                    onChange={() => setPayMethod('razorpay')}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-bold text-stone-800">Online Payment</div>
                    <div className="text-xs text-stone-500">UPI · Cards · Netbanking via Razorpay</div>
                    {prepaidPct > 0 && (
                      <div className="mt-1 text-xs text-forest-700 font-semibold bg-forest-100 inline-block px-2 py-0.5 rounded-full">
                        🎉 Save extra {prepaidPct}% — {formatPrice(pricing.prepaidDiscount)} off
                      </div>
                    )}
                  </div>
                </label>

                {/* COD */}
                {codOk ? (
                  <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                    payMethod === 'cod' ? 'border-forest-600 bg-forest-50' : 'border-stone-200 hover:border-stone-300'
                  }`}>
                    <input
                      type="radio" name="payment" value="cod"
                      checked={payMethod === 'cod'}
                      onChange={() => setPayMethod('cod')}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-bold text-stone-800">Cash on Delivery</div>
                      <div className="text-xs text-stone-500">Pay when your order arrives</div>
                    </div>
                  </label>
                ) : (
                  <div className="p-4 rounded-xl border-2 border-stone-100 bg-stone-50 text-xs text-stone-400">
                    COD not available {!codOk ? `for orders above ₹${codMax}` : '— disabled'}
                  </div>
                )}

              </div>
            </section>

          </div>

          {/* Right: Order summary */}
          <div>
            <div className="bg-white border border-stone-200 rounded-2xl p-5 sticky top-24">
              <h2 className="text-base font-bold text-stone-900 mb-4">Order Summary</h2>

              {/* Items */}
              <div className="space-y-3 mb-4 max-h-52 overflow-y-auto">
                {items.map(item => (
                  <div key={item.variantId} className="flex items-center gap-2.5">
                    <div className="w-11 h-11 rounded-lg bg-stone-100 flex items-center justify-center text-lg shrink-0">
                      {item.emoji || '🌿'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-stone-700 truncate">{item.name}</div>
                      {item.size && <div className="text-[10px] text-stone-400">{item.size}</div>}
                    </div>
                    <div className="text-xs font-bold text-stone-800 shrink-0">
                      {formatPrice(item.price * item.qty)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Price breakdown */}
              <div className="border-t border-stone-100 pt-4 space-y-2 text-sm">
                <div className="flex justify-between text-stone-600">
                  <span>Subtotal</span><span>{formatPrice(pricing.subtotal)}</span>
                </div>
                {coupon && (
                  <div className="flex justify-between text-forest-700 font-medium">
                    <span>Coupon ({coupon.code})</span><span>−{formatPrice(pricing.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-stone-600">
                  <span>Shipping</span>
                  <span className={pricing.isFreeShipping ? 'text-forest-600 font-semibold' : ''}>
                    {pricing.isFreeShipping ? 'FREE' : formatPrice(pricing.shipping)}
                  </span>
                </div>
                {pricing.prepaidDiscount > 0 && (
                  <div className="flex justify-between text-forest-700 font-medium">
                    <span>Prepaid discount</span><span>−{formatPrice(pricing.prepaidDiscount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-stone-900 text-base pt-2 border-t border-stone-100">
                  <span>Total</span><span>{formatPrice(pricing.total)}</span>
                </div>
                <div className="text-[10px] text-stone-400">
                  Incl. ₹{pricing.gstTotal} GST
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium">
                  {error}
                </div>
              )}

              {/* Place order */}
              <button
                onClick={handlePlace}
                disabled={placing}
                className="mt-4 w-full bg-forest-700 hover:bg-forest-800 disabled:opacity-60 text-white font-bold py-3.5 rounded-xl text-sm transition-colors"
              >
                {placing
                  ? '⏳ Placing Order…'
                  : payMethod === 'razorpay'
                    ? `Pay ${formatPrice(pricing.total)}`
                    : `Place COD Order — ${formatPrice(pricing.total)}`
                }
              </button>

              <p className="text-center text-[10px] text-stone-400 mt-3">
                🔒 Secure checkout · Powered by Razorpay
              </p>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
