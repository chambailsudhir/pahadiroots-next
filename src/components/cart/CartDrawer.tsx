'use client'

/**
 * CartDrawer — slide-in mini-cart with full accessibility support.
 *
 * Accessibility fix applied (this round):
 *
 *   A1. Free-shipping progress bar missing ARIA roles and values (WCAG 1.3.1).
 *       The inner progress fill `<div>` had no semantic meaning. Screen readers
 *       announced nothing when the bar was present, so users navigating by
 *       keyboard had no way to know how close they were to free shipping.
 *       Fix: role="progressbar" + aria-valuenow / aria-valuemin / aria-valuemax
 *       + aria-label added to the track element. Values are kept as integer
 *       percentages (0–100) for compatibility with all AT implementations.
 *       The fill div retains its visual role and is aria-hidden.
 *
 * Prior bug-fixes already present (kept for reference):
 *
 *   1. Focus setTimeout not cleaned up — timer ID captured and cleared in cleanup.
 *   2. Scroll-lock layout shift — scrollbar width measured and compensated with
 *      paddingRight before setting overflow:hidden.
 *   3. All interactive <button> elements missing type="button".
 */

import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import { formatPrice } from '@/lib/utils'
import { calcPriceSummary } from '@/lib/services/pricingService'
import type { CartItem, SiteSettings } from '@/types'
import styles from './CartDrawer.module.css'

interface Props { settings: SiteSettings }

// ─── Memoized item row ─────────────────────────────────────────────────────────
//
// PERF FIX: each row was previously inline JSX inside `items.map(...)`, with
// `onClick={() => updateQty(...)}` / `() => removeItem(...)}` arrow functions
// recreated on every CartDrawer render. CartDrawer is mounted once globally
// (layout.tsx) and subscribes to the *entire* `items` array, so it re-renders
// on EVERY cart mutation — bumping the qty of one item re-ran the JSX for
// every OTHER row too, even though their props hadn't changed at all.
//
// Fix: extract each row into its own React.memo'd component, mirroring the
// pattern already used by CartItemCard on the /cart page. `updateQty`,
// `removeItem`, and `closeCart` are stable Zustand action references (their
// identity never changes), and Zustand's immutable `items` update only
// creates a new object for the item that actually changed — every other
// item keeps its previous object reference. With React.memo's default
// shallow-prop comparison, only the row whose `item` reference changed
// re-renders; all other rows (and their <Image> children) are skipped.
interface CartDrawerItemProps {
  item:       CartItem
  updateQty:  (variantId: string, qty: number) => void
  removeItem: (variantId: string) => void
  closeCart:  () => void
}

export const CartDrawerItem = memo(function CartDrawerItem({
  item, updateQty, removeItem, closeCart,
}: CartDrawerItemProps) {
  const handleDecr = useCallback(
    () => updateQty(item.variantId, item.qty - 1),
    [item.variantId, item.qty, updateQty],
  )
  const handleIncr = useCallback(
    () => updateQty(item.variantId, item.qty + 1),
    [item.variantId, item.qty, updateQty],
  )
  const handleRemove = useCallback(
    () => removeItem(item.variantId),
    [item.variantId, removeItem],
  )

  return (
    <div className="flex gap-3">
      {/* Image */}
      <div className="relative w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-stone-50 border border-stone-100">
        {item.image ? (
          <Image src={item.image} alt={item.name} fill sizes="64px" className="object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-2xl" aria-hidden="true">
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
          <div
            className="flex items-center border border-stone-200 rounded-lg overflow-hidden"
            role="group"
            aria-label={`Quantity for ${item.name}`}
          >
            <button
              type="button"
              onClick={handleDecr}
              disabled={item.qty <= 1}
              className="w-7 h-7 flex items-center justify-center text-stone-500 hover:bg-stone-50 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label={`Decrease quantity of ${item.name}`}
            >−</button>
            <span
              className="w-7 text-center text-xs font-bold text-stone-700"
              aria-live="polite"
              aria-atomic="true"
              aria-label={`${item.qty} in cart`}
            >{item.qty}</span>
            <button
              type="button"
              onClick={handleIncr}
              disabled={item.qty >= (item.maxQty ?? 99)}
              className="w-7 h-7 flex items-center justify-center text-stone-500 hover:bg-stone-50 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label={`Increase quantity of ${item.name}`}
            >+</button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-stone-900">
              {formatPrice(item.price * item.qty)}
            </span>
            <button
              type="button"
              onClick={handleRemove}
              aria-label={`Remove ${item.name} from cart`}
              className="text-stone-300 hover:text-red-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})

export default function CartDrawer({ settings }: Props) {
  const isOpen    = useUIStore(s => s.isCartOpen)
  const closeCart = useUIStore(s => s.closeCart)
  const items     = useCartStore(s => s.items)
  const coupon    = useCartStore(s => s.coupon)
  const removeItem  = useCartStore(s => s.removeItem)
  const updateQty   = useCartStore(s => s.updateQty)
  const drawerRef   = useRef<HTMLDivElement>(null)
  const firstFocusRef = useRef<HTMLButtonElement>(null)
  // WCAG 2.1 §3.2 — when a dialog closes, focus must return to the element
  // that triggered it. Capture the active element when the drawer opens.
  const openerRef = useRef<HTMLElement | null>(null)

  // Close on Escape + focus trap
  useEffect(() => {
    let focusTimer: ReturnType<typeof setTimeout> | null = null

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
      openerRef.current = document.activeElement as HTMLElement
      document.addEventListener('keydown', onKey)
      focusTimer = setTimeout(() => firstFocusRef.current?.focus(), 50)
    } else {
      if (openerRef.current && typeof openerRef.current.focus === 'function') {
        openerRef.current.focus()
        openerRef.current = null
      }
    }

    return () => {
      document.removeEventListener('keydown', onKey)
      if (focusTimer !== null) clearTimeout(focusTimer)
    }
  }, [isOpen, closeCart])

  // Lock body scroll when open — compensate for scrollbar width to prevent layout shift
  useEffect(() => {
    if (isOpen) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      document.body.style.overflow = 'hidden'
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`
      }
    } else {
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
    }
    return () => {
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
    }
  }, [isOpen])

  // Apply `inert` imperatively so keyboard/SR cannot reach the off-screen drawer.
  useEffect(() => {
    const el = drawerRef.current
    if (!el) return
    if (isOpen) {
      el.removeAttribute('inert')
    } else {
      el.setAttribute('inert', '')
    }
  }, [isOpen])

  const pricing = useMemo(
    () => calcPriceSummary(items, settings, coupon, 'cod'),
    [items, settings, coupon]
  )

  // PERF FIX: memoize total qty — was an inline items.reduce() call in JSX,
  // running O(n) on every render regardless of whether items changed.
  const totalQty = useMemo(
    () => items.reduce((s, i) => s + i.qty, 0),
    [items],
  )

  // A1: compute progress percentage once for the progressbar aria-valuenow.
  const shipProgressPct = pricing.freeShippingMin > 0
    ? Math.round(Math.min(100, (pricing.progressBase / pricing.freeShippingMin) * 100))
    : 0

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className={styles.overlay}
          onClick={closeCart}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-labelledby="cart-drawer-title"
        aria-modal="true"
        className={`fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.cartIcon} aria-hidden="true">🛒</span>
            <h2 id="cart-drawer-title" className={styles.title}>Your Cart</h2>
            {items.length > 0 && (
              <span className={styles.count}>
                {totalQty}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={closeCart}
            aria-label="Close cart"
            ref={firstFocusRef}
            className={styles.closeBtn}
          >
            ✕ Close
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-10">
              <div className="text-5xl mb-4" aria-hidden="true">🛒</div>
              <h3 className="text-base font-semibold text-stone-700 mb-1">Your cart is empty</h3>
              <p className="text-stone-400 text-sm mb-5">Add products to get started</p>
              <button
                type="button"
                onClick={closeCart}
                className="text-sm font-semibold text-forest-700 hover:text-forest-900"
              >
                Continue Shopping →
              </button>
            </div>
          ) : (
            items.map(item => (
              <CartDrawerItem
                key={item.variantId}
                item={item}
                updateQty={updateQty}
                removeItem={removeItem}
                closeCart={closeCart}
              />
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
                  <span aria-hidden="true">🚚</span>{' '}
                  Add {formatPrice(pricing.remainingForFreeShip)} more for{' '}
                  <span className="font-bold">FREE shipping</span>
                </p>
                {/*
                 * A1: role="progressbar" + aria-value* attributes added.
                 *     The track element now communicates progress semantically.
                 *     aria-label gives context; aria-valuenow is the integer
                 *     percentage (0–100). The inner fill div is aria-hidden
                 *     since it's purely visual — the parent carries all info.
                 */}
                <div
                  className="mt-2 h-1.5 bg-earth-100 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-label="Free shipping progress"
                  aria-valuenow={shipProgressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full bg-earth-500 rounded-full transition-all"
                    style={{ width: `${shipProgressPct}%` }}
                    aria-hidden="true"
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
