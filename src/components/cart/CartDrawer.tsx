'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import { formatPrice } from '@/lib/utils'
import { calcPriceSummary } from '@/lib/services/pricingService'
import type { SiteSettings } from '@/types'

interface Props { settings: SiteSettings }

export default function CartDrawer({ settings }: Props) {
  const isOpen   = useUIStore(s => s.isCartOpen)
  const closeCart = useUIStore(s => s.closeCart)
  const items    = useCartStore(s => s.items)
  const coupon   = useCartStore(s => s.coupon)
  const removeItem = useCartStore(s => s.removeItem)
  const updateQty  = useCartStore(s => s.updateQty)
  const drawerRef  = useRef<HTMLDivElement>(null)
  const firstFocusRef = useRef<HTMLButtonElement>(null)

  // Close on Escape + focus trap
  useEffect(() => {
    const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeCart(); return }
      if (e.key === 'Tab' && drawerRef.current) {
        const els = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        if (!els.length) return
        const first = els[0], last = els[els.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus() }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus() }
        }
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', onKey)
      // move focus into drawer on open
      setTimeout(() => firstFocusRef.current?.focus(), 50)
    }
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, closeCart])

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  const pricing = calcPriceSummary(items, settings, coupon, 'cod')

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="drawer-overlay"
          onClick={closeCart}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-label="Shopping cart"
        aria-modal="true"
        className={`fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--bd)', background: 'var(--g)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🛒</span>
            <h2 style={{ fontSize: 16, fontWeight: 900, color: '#fff', fontFamily: '"Playfair Display", Georgia, serif' }}>Your Cart</h2>
            {items.length > 0 && (
              <span style={{ background: 'var(--gd)', color: '#1a0800', fontSize: 11, fontWeight: 900, padding: '2px 8px', borderRadius: 12 }}>
                {items.reduce((s, i) => s + i.qty, 0)}
              </span>
            )}
          </div>
          <button
            onClick={closeCart}
            aria-label="Close cart"
            ref={firstFocusRef}
            style={{ background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: 8, padding: '6px 10px', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
          >
            ✕ Close
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-10">
              <div className="text-5xl mb-4">🛒</div>
              <h3 className="text-base font-semibold text-stone-700 mb-1">Your cart is empty</h3>
              <p className="text-stone-400 text-sm mb-5">Add products to get started</p>
              <button
                onClick={closeCart}
                className="text-sm font-semibold text-forest-700 hover:text-forest-900"
              >
                Continue Shopping →
              </button>
            </div>
          ) : (
            items.map(item => (
              <div key={item.variantId} className="flex gap-3">
                {/* Image */}
                <div className="relative w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-stone-50 border border-stone-100">
                  {item.image ? (
                    <Image src={item.image} alt={item.name} fill sizes="64px" className="object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-2xl">
                      {item.emoji || '🌿'}
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/products/${item.slug}`}
                    onClick={closeCart}
                    className="text-sm font-semibold text-stone-800 line-clamp-2 hover:text-forest-700 transition-colors"
                  >
                    {item.name}
                  </Link>
                  {item.size && (
                    <div className="text-xs text-stone-400 mt-0.5">{item.size}</div>
                  )}
                  <div className="flex items-center justify-between mt-2">
                    {/* Qty stepper */}
                    <div className="flex items-center border border-stone-200 rounded-lg overflow-hidden">
                      <button
                        onClick={() => updateQty(item.variantId, item.qty - 1)}
                        disabled={item.qty <= 1}
                        className="w-7 h-7 flex items-center justify-center text-stone-500 hover:bg-stone-50 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label="Decrease quantity"
                      >−</button>
                      <span className="w-7 text-center text-xs font-bold text-stone-700">{item.qty}</span>
                      <button
                        onClick={() => updateQty(item.variantId, item.qty + 1)}
                        disabled={item.qty >= item.maxQty}
                        className="w-7 h-7 flex items-center justify-center text-stone-500 hover:bg-stone-50 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label="Increase quantity"
                        aria-disabled={item.qty >= item.maxQty}
                      >+</button>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-stone-900">
                        {formatPrice(item.price * item.qty)}
                      </span>
                      <button
                        onClick={() => removeItem(item.variantId)}
                        aria-label="Remove item"
                        className="text-stone-300 hover:text-red-400 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer with totals + CTA */}
        {items.length > 0 && (
          <div className="border-t border-stone-100 px-5 py-4 space-y-3">

            {/* Free shipping progress */}
            {!pricing.isFreeShipping && pricing.remainingForFreeShip > 0 && (
              <div className="bg-earth-50 rounded-xl p-3 border border-earth-100">
                <p className="text-xs text-earth-700 font-medium">
                  🚚 Add {formatPrice(pricing.remainingForFreeShip)} more for <span className="font-bold">FREE shipping</span>
                </p>
                <div className="mt-2 h-1.5 bg-earth-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-earth-500 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (pricing.progressBase / pricing.freeShippingMin) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Price summary */}
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-stone-600">
                <span>Subtotal</span>
                <span>{formatPrice(pricing.subtotal)}</span>
              </div>
              {coupon && (
                <div className="flex justify-between text-forest-600">
                  <span>Discount ({coupon.code})</span>
                  <span>−{formatPrice(pricing.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-stone-600">
                <span>Shipping</span>
                <span className={pricing.isFreeShipping ? 'text-forest-600 font-semibold' : ''}>
                  {pricing.isFreeShipping ? 'FREE' : formatPrice(pricing.shipping)}
                </span>
              </div>
              <div className="flex justify-between font-bold text-stone-900 text-base pt-1 border-t border-stone-100">
                <span>Total</span>
                <span>{formatPrice(pricing.total)}</span>
              </div>
            </div>

            {/* CTA */}
            <Link
              href="/checkout"
              onClick={closeCart}
              className="block w-full text-center bg-forest-700 hover:bg-forest-800 text-white font-bold py-3.5 rounded-xl text-sm transition-colors"
            >
              Proceed to Checkout
            </Link>
            <Link
              href="/cart"
              onClick={closeCart}
              className="block w-full text-center text-stone-500 hover:text-stone-700 text-sm font-medium py-1 transition-colors"
            >
              View Full Cart
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
