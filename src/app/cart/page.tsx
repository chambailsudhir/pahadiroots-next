'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { useCartStore } from '@/store/cartStore'
import { formatPrice } from '@/lib/utils'
import { calcPriceSummary } from '@/lib/services/pricingService'
import useSWR from 'swr'
import { supabase } from '@/lib/supabase'
import type { SiteSettings } from '@/types'

export default function CartPage() {
  const items      = useCartStore(s => s.items)
  const coupon     = useCartStore(s => s.coupon)
  const applyCoupon = useCartStore(s => s.applyCoupon)
  const removeCoupon = useCartStore(s => s.removeCoupon)
  const removeItem = useCartStore(s => s.removeItem)
  const updateQty  = useCartStore(s => s.updateQty)

  const [couponCode, setCouponCode] = useState('')
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError, setCouponError]     = useState('')

  const { data: settings } = useSWR<SiteSettings>('site_settings', async () => {
    const { data } = await supabase.from('site_settings').select('key, value')
    return Object.fromEntries((data || []).map((r: any) => [r.key, r.value])) as any
  })

  const s = settings || { free_shipping_min: '799', flat_shipping_charge: '99', prepaid_discount_pct: '5' } as any
  const pricing = calcPriceSummary(items, s, coupon, 'cod')

  async function handleCoupon() {
    if (!couponCode.trim()) return
    setCouponLoading(true)
    setCouponError('')
    try {
      const res  = await fetch('/api/v1/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponCode.trim().toUpperCase(), subtotal: pricing.subtotal }),
      })
      const data = await res.json()
      if (!res.ok) { setCouponError(data.error || 'Invalid coupon'); return }
      applyCoupon(data.coupon)
      setCouponCode('')
    } catch { setCouponError('Failed to apply coupon') }
    finally { setCouponLoading(false) }
  }

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="text-6xl mb-5">🛒</div>
        <h1 className="text-2xl font-bold text-stone-900 mb-2">Your cart is empty</h1>
        <p className="text-stone-500 text-sm mb-7">Add some natural Himalayan products to get started!</p>
        <Link href="/products" className="inline-flex items-center gap-2 bg-forest-700 hover:bg-forest-800 text-white font-bold px-7 py-3 rounded-xl text-sm transition-colors">
          Browse Products
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-stone-900 mb-7">Shopping Cart</h1>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8">

        {/* Items */}
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.variantId} className="flex gap-4 p-4 bg-white border border-stone-100 rounded-2xl">
              <div className="relative w-20 h-20 shrink-0 rounded-xl overflow-hidden bg-stone-50">
                {item.image ? (
                  <Image src={item.image} alt={item.name} fill sizes="80px" className="object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-2xl">{item.emoji || '🌿'}</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <Link href={`/products/${item.slug}`} className="text-sm font-bold text-stone-800 hover:text-forest-700 line-clamp-2 transition-colors">
                  {item.name}
                </Link>
                {item.size && <div className="text-xs text-stone-400 mt-0.5">{item.size}</div>}
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center border border-stone-200 rounded-xl overflow-hidden">
                    <button onClick={() => updateQty(item.variantId, item.qty - 1)} className="w-8 h-8 flex items-center justify-center text-stone-500 hover:bg-stone-50 font-bold">−</button>
                    <span className="w-8 text-center text-sm font-bold text-stone-800">{item.qty}</span>
                    <button onClick={() => updateQty(item.variantId, item.qty + 1)} className="w-8 h-8 flex items-center justify-center text-stone-500 hover:bg-stone-50 font-bold">+</button>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-base font-bold text-stone-900">{formatPrice(item.price * item.qty)}</span>
                    <button onClick={() => removeItem(item.variantId)} className="text-stone-300 hover:text-red-400 transition-colors" aria-label="Remove">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="space-y-4">
          {/* Free shipping progress */}
          {!pricing.isFreeShipping && (
            <div className="bg-earth-50 rounded-xl p-4 border border-earth-100">
              <p className="text-xs font-medium text-earth-700">
                🚚 Add {formatPrice(pricing.remainingForFreeShip)} more for <strong>free shipping</strong>
              </p>
              <div className="mt-2 h-1.5 bg-earth-100 rounded-full overflow-hidden">
                <div className="h-full bg-earth-500 rounded-full transition-all" style={{ width: `${Math.min(100, (pricing.subtotal / pricing.freeShippingMin) * 100)}%` }} />
              </div>
            </div>
          )}

          {/* Coupon */}
          <div className="bg-white border border-stone-200 rounded-xl p-4">
            <div className="text-xs font-bold text-stone-600 mb-2">Coupon Code</div>
            {coupon ? (
              <div className="flex items-center justify-between bg-forest-50 border border-forest-100 rounded-lg px-3 py-2">
                <span className="text-sm font-semibold text-forest-700">🎉 {coupon.code} — −{formatPrice(coupon.discount)}</span>
                <button onClick={removeCoupon} className="text-xs text-stone-400 hover:text-red-500">Remove</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={e => setCouponCode(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && handleCoupon()}
                  placeholder="WELCOME50"
                  className="flex-1 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-forest-500"
                />
                <button onClick={handleCoupon} disabled={couponLoading} className="px-4 py-2 bg-stone-800 text-white text-xs font-bold rounded-lg hover:bg-stone-900 disabled:opacity-60 transition-colors">
                  {couponLoading ? '…' : 'Apply'}
                </button>
              </div>
            )}
            {couponError && <p className="text-xs text-red-500 mt-1">{couponError}</p>}
          </div>

          {/* Price breakdown */}
          <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between text-stone-600"><span>Subtotal</span><span>{formatPrice(pricing.subtotal)}</span></div>
            {coupon && <div className="flex justify-between text-forest-600 font-medium"><span>Coupon</span><span>−{formatPrice(pricing.discount)}</span></div>}
            <div className="flex justify-between text-stone-600">
              <span>Shipping</span>
              <span className={pricing.isFreeShipping ? 'text-forest-600 font-semibold' : ''}>{pricing.isFreeShipping ? 'FREE' : formatPrice(pricing.shipping)}</span>
            </div>
            <div className="flex justify-between font-bold text-stone-900 text-base pt-2 border-t border-stone-100">
              <span>Total</span><span>{formatPrice(pricing.total)}</span>
            </div>
          </div>

          <Link href="/checkout" className="block w-full text-center bg-forest-700 hover:bg-forest-800 text-white font-bold py-3.5 rounded-xl text-sm transition-colors">
            Proceed to Checkout →
          </Link>
          <Link href="/products" className="block w-full text-center text-stone-400 hover:text-stone-600 text-sm font-medium py-1 transition-colors">
            Continue Shopping
          </Link>
        </div>
      </div>
    </div>
  )
}
