'use client'

/**
 * CartDrawer — slide-in mini-cart with full accessibility support.
 *
 * A11y fixes (this round — full a11y audit):
 *
 *   A2. Item count badge has no accessible label (WCAG 1.3.1).
 *       The badge `<span>` rendered a bare number (e.g. "3") with no label.
 *       Screen readers announced "3" with no context of what it counted.
 *       Fix: aria-label="3 items in cart" (singular/plural handled).
 *
 *   A3. Items list has no semantic list structure (WCAG 1.3.1).
 *       Items were rendered as bare siblings inside a `<div>`. Screen readers
 *       couldn't tell users how many items were in the cart or navigate by
 *       list item. Fix: <ul aria-label="Cart items, N products"> with each
 *       CartDrawerItem wrapped in <li>.
 *
 *   A4. Item price span has no accessible label (WCAG 1.3.1).
 *       Each row showed a formatted price (e.g. "₹500") with no context.
 *       Screen readers announced the number with no link to "item total".
 *       Fix: aria-label="Item total: ₹500".
 *
 *   A5. Decorative arrow "→" in "Continue Shopping" button read by AT (WCAG 1.3.3).
 *       The arrow character was part of the button's accessible name, so AT
 *       announced "Continue Shopping right-pointing arrow" or similar.
 *       Fix: wrapped in <span aria-hidden="true">.
 *
 *   A6. Price summary rows are plain <div> pairs — no key-value semantics (WCAG 1.3.1).
 *       "Subtotal ₹500 / Shipping FREE / Total ₹500" were three separate
 *       `<div className="flex justify-between">` blocks. Screen readers read
 *       the label and the value as unrelated text. Fix: <dl>/<dt>/<dd> gives
 *       the correct description-list semantics so AT knows each value belongs
 *       to its label.
 *
 *   A7. Qty stepper buttons have no :focus-visible style (WCAG 2.4.7).
 *       Tailwind-classed − / + buttons had no focus ring for keyboard users.
 *       Fix: focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400.
 *
 *   A8. Remove (×) button has no :focus-visible style (WCAG 2.4.7).
 *       Fix: focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400
 *       focus-visible:rounded.
 *
 *   A9. Product name Link has no :focus-visible style (WCAG 2.4.7).
 *       Fix: focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-600
 *       focus-visible:rounded.
 *
 *  A10. "Continue Shopping" empty-cart button has no :focus-visible style (WCAG 2.4.7).
 *       Fix: focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-700.
 *
 *  A11. "Proceed to Checkout" Link has no :focus-visible style (WCAG 2.4.7).
 *       The primary checkout CTA — most critical keyboard target in the drawer —
 *       had no visible focus indicator.
 *       Fix: white ring with forest-700 offset, clearly visible on dark green.
 *
 *  A12. "View Full Cart" Link has no :focus-visible style (WCAG 2.4.7).
 *       Fix: focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400.
 *
 * Prior a11y fixes already present (kept for reference):
 *
 *   A1. Free-shipping progressbar missing ARIA roles and values (WCAG 1.3.1).
 *       Fix: role="progressbar" + aria-valuenow / aria-valuemin / aria-valuemax.
 *
 * Prior bug-fixes already present:
 *
 *   1. Focus setTimeout not cleaned up.
 *   2. Scroll-lock layout shift compensated with scrollbar-width paddingRight.
 *   3. All interactive <button> elements have type="button".
 *   4. PERF: CartDrawerItem memoized; stable useCallback handlers per row.
 */

import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import { formatPrice } from '@/lib/utils'
import { calcPriceSummary } from '@/lib/services/pricingService'
import { pendingRemovalsRegistry } from '@/lib/pendingRemovalsRegistry'
import type { CartItem, SiteSettings } from '@/types'
import styles from './CartDrawer.module.css'

interface Props { settings: SiteSettings }

// ─── Memoized item row ─────────────────────────────────────────────────────────
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
        {/* A9: focus-visible ring on product name link */}
        <Link
          href={`/products/${item.slug}`}
          onClick={closeCart}
          className="text-sm font-semibold text-stone-800 line-clamp-2 hover:text-forest-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-600 focus-visible:rounded"
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
            {/* A7: focus-visible ring on stepper buttons */}
            <button
              type="button"
              onClick={handleDecr}
              disabled={item.qty <= 1}
              className="w-7 h-7 flex items-center justify-center text-stone-500 hover:bg-stone-50 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-400"
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
              className="w-7 h-7 flex items-center justify-center text-stone-500 hover:bg-stone-50 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-400"
              aria-label={`Increase quantity of ${item.name}`}
            >+</button>
          </div>
          <div className="flex items-center gap-3">
            {/* A4: aria-label gives AT the context "Item total: ₹500" */}
            <span
              className="text-sm font-bold text-stone-900"
              aria-label={`Item total: ${formatPrice(item.price * item.qty)}`}
            >
              {formatPrice(item.price * item.qty)}
            </span>
            {/* A8: focus-visible ring on remove button */}
            <button
              type="button"
              onClick={handleRemove}
              aria-label={`Remove ${item.name} from cart`}
              className="text-stone-300 hover:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:rounded"
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
              /* A2: aria-label gives AT the context "3 items in cart" not just "3" */
              <span
                className={styles.count}
                aria-label={`${totalQty} item${totalQty !== 1 ? 's' : ''} in cart`}
              >
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
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-10">
              <div className="text-5xl mb-4" aria-hidden="true">🛒</div>
              <h3 className="text-base font-semibold text-stone-700 mb-1">Your cart is empty</h3>
              <p className="text-stone-400 text-sm mb-5">Add products to get started</p>
              {/* A5: arrow wrapped in aria-hidden so AT reads "Continue Shopping" only */}
              {/* A10: focus-visible ring for keyboard users */}
              <button
                type="button"
                onClick={closeCart}
                className="text-sm font-semibold text-forest-700 hover:text-forest-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-700 focus-visible:rounded"
              >
                Continue Shopping <span aria-hidden="true">→</span>
              </button>
            </div>
          ) : (
            /*
             * A3: <ul> gives screen readers list semantics — they announce
             * "list, N items" and let users navigate by list item (VoiceOver:
             * VO+Right; NVDA: L then I). The aria-label provides context.
             * Each CartDrawerItem is wrapped in <li>; the component itself
             * renders a <div> which is a valid child of <li>.
             */
            <ul
              aria-label={`Cart items, ${items.length} product${items.length !== 1 ? 's' : ''}`}
              className="space-y-4 list-none p-0 m-0"
            >
              {items.map(item => (
                <li key={item.variantId}>
                  <CartDrawerItem
                    item={item}
                    updateQty={updateQty}
                    removeItem={removeItem}
                    closeCart={closeCart}
                  />
                </li>
              ))}
            </ul>
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
                {/* A1: role="progressbar" + aria-value* attributes */}
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

            {/*
             * A6: <dl>/<dt>/<dd> gives screen readers proper key-value semantics.
             * Plain <div className="flex justify-between"> pairs meant AT read
             * "Subtotal" and "₹500" as unrelated text. With <dt>/<dd> they are
             * announced as a description list — e.g. "Subtotal: ₹500".
             * <dl> wrapping <div>s containing <dt>/<dd> pairs is valid HTML5.
             */}
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between text-stone-600">
                <dt>Subtotal</dt>
                <dd>{formatPrice(pricing.subtotal)}</dd>
              </div>
              {coupon && (
                <div className="flex justify-between text-forest-600">
                  <dt>Discount ({coupon.code})</dt>
                  <dd>−{formatPrice(pricing.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between text-stone-600">
                <dt>Shipping</dt>
                <dd className={pricing.isFreeShipping ? 'text-forest-600 font-semibold' : ''}>
                  {pricing.isFreeShipping ? 'FREE' : formatPrice(pricing.shipping)}
                </dd>
              </div>
              <div className="flex justify-between font-bold text-stone-900 text-base pt-1 border-t border-stone-100">
                <dt>Total</dt>
                <dd>{formatPrice(pricing.total)}</dd>
              </div>
            </dl>

            {/* A11: focus-visible ring on primary checkout CTA */}
            <Link
              href="/checkout"
              onClick={() => {
                // BUG FIX: flush any items pending removal (within 4-second
                // undo window) before navigating to checkout. Without this,
                // a ghost item removed on the cart page survives into the
                // checkout because cartStore.items still contains it until
                // the deferred removeItem() timer fires. The registry is a
                // no-op when useCartPage is not mounted (user opened drawer
                // from a non-cart page — no pending removals can exist there).
                pendingRemovalsRegistry.flush()
                closeCart()
              }}
              className="block w-full text-center bg-forest-700 hover:bg-forest-800 text-white font-bold py-3.5 rounded-xl text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-forest-700"
            >
              Proceed to Checkout
            </Link>
            {/* A12: focus-visible ring on View Full Cart link */}
            <Link
              href="/cart"
              onClick={closeCart}
              className="block w-full text-center text-stone-500 hover:text-stone-700 text-sm font-medium py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:rounded"
            >
              View Full Cart
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
