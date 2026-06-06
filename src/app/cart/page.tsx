'use client'

/**
 * cart/page.tsx — pure render shell (~100 lines, down from ~300).
 *
 * All state, data-fetching, and handlers have been extracted to useCartPage.
 * This file is now a layout orchestrator only — it renders, it does not think.
 *
 * Fixes applied (first round):
 *   • God component smell        — 9 useState calls removed; hook owns all state.
 *   • CSS template literal       — PAGE_CSS removed; styles imported from cart-page.css.
 *   • CART_ITEM_CARD_CSS import  — removed; CartItemCard now self-imports its CSS.
 *   • SiteSettings unsafe cast   — removed; hook exposes Partial<SiteSettings>.
 *   • eslint-disable suppressions — both removed; hook fixes deps properly.
 *   • Inline RawVariant/RawProduct interfaces — removed; live in types/store-data.ts.
 *   • SRP store-data call        — removed; hook calls cart-settings + cart-upsells.
 *
 * Bug-fixes (second round):
 *
 *   1. Duplicate React imports merged.
 *      { lazy, Suspense } and { useState, useEffect } were two separate import
 *      statements from 'react'. Merged into one.
 *
 *   2. Min order amount comparison inconsistency fixed.
 *      StickyCartCTA previously received total={pricing.total} (post-shipping)
 *      and used it for the min-order check. CartSummary correctly compares
 *      against pricing.subtotal (pre-shipping). A cart worth ₹450 subtotal +
 *      ₹99 shipping = ₹549 total would pass the sticky-bar check (₹549 > ₹500
 *      minimum) while CartSummary correctly blocked checkout (₹450 < ₹500).
 *      The two CTAs showed contradictory states: one enabled, one blocked.
 *      Fix: pass orderSubtotal={pricing.subtotal} to StickyCartCTA. The
 *      component now uses orderSubtotal for the min-order check and total only
 *      for display, matching CartSummary's logic exactly.
 *
 *   3. "Your Items (N)" counter included pending-removal items.
 *      totalQty (from the hook) counts every item in the Zustand store,
 *      including ones the user has clicked Remove on. Those items are hidden
 *      from the visual list, creating a mismatch: "Your Items (3)" with only
 *      2 cards visible.
 *      Fix: derive visibleItems (filtered list) and visibleQty once, then use
 *      visibleQty for the heading and visibleItems for the rendered list —
 *      removing the duplicate .filter() call in the JSX at the same time.
 *
 *   4. Undo toast button missing type="button".
 *      All interactive buttons not inside a <form> should carry type="button"
 *      to prevent accidental form submission if this component is ever wrapped
 *      in a form in future.
 *
 *   5. WhatsApp number sanitized before use in wa.me URL.
 *      settings.whatsapp_number is admin-controlled and may contain spaces,
 *      dashes, brackets, or a leading + (all common phone-number formats).
 *      wa.me expects digits only. Stripping non-digits with /\D/g and computing
 *      the href once (whatsappHref) keeps the JSX clean.
 *
 *   6. parseFloat NaN guard added for minOrderAmt.
 *      If min_order_amount is stored as an empty string in the DB,
 *      parseFloat('') = NaN. The > 0 guard downstream already handles NaN
 *      safely, but || 0 makes the intent explicit and future-proofs the value.
 *
 * ADMIN SETTINGS CONSUMED:
 *   free_shipping_min, flat_shipping_charge, whatsapp_number, min_order_amount
 *   review_1/2/3_name/location/text
 */

import './cart-page.css'

import Link                             from 'next/link'
// Fix 1: merged into a single import — previously lazy/Suspense and
// useState/useEffect were two separate import statements from 'react'.
import { lazy, Suspense, useState, useEffect } from 'react'
import { formatPrice }                  from '@/lib/utils'
import { useCartPage }                  from '@/hooks/useCartPage'

import CartSkeleton                     from '@/components/cart/CartSkeleton'
import CartItemCard                     from '@/components/cart/CartItemCard'
import CartSummary                      from '@/components/cart/CartSummary'
import { StickyCartCTA, EmptyCart }     from '@/components/cart/CartUIComponents'
import ErrorBoundary                    from '@/components/ui/ErrorBoundary'

// Lazy-load below-fold sections for performance
const UpsellSection   = lazy(() => import('@/components/cart/UpsellSection'))
const ReviewSection   = lazy(() => import('@/components/cart/ReviewSection'))
const PahadiStoryCard = lazy(() => import('@/components/cart/PahadiStoryCard'))

// ─── Trust / delivery data — static, defined at module level ─────────────────
// Defined outside the component so they are never recreated on re-renders.
const TRUST_ITEMS = [
  ['🌿', '100% Natural',        'No chemicals or preservatives'],
  ['🏔', 'Himalayan Sourced',   'Direct from mountain farmers'],
  ['🤝', 'Farmer Direct',       'Fair trade, fair prices'],
  ['📦', 'Small Batch',         'Fresh, limited production'],
] as const

const DELIVERY_ITEMS = [
  ['🚚', 'Delivery in 3–5 Days', 'Pan India'],
  ['🔄', 'Easy Returns',         '7-day policy'],
  ['🔒', 'Secure Payment',       'SSL encrypted'],
  ['📞', 'WhatsApp Support',     'Mon–Sat 9am–6pm'],
] as const

// ─── Component ────────────────────────────────────────────────────────────────
export default function CartPage() {
  // Hydration guard — stores use skipHydration:true so the first server render
  // and the first client render both see an empty cart. Returning CartSkeleton
  // until mount prevents a hydration mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const {
    items, coupon, removeCoupon,
    couponCode, setCouponCode, couponLoading, couponError,
    upsellItems, upsellLoading, upsellError, addedUpsell,
    reviews, settings,
    qtyAnim, pendingRemovals,
    freeShipMin, pricing, progressPct, totalQty,
    handleQtyChange, handleRemove, handleUndoRemove,
    handleUpsellAdd, handleCoupon, handleApplyHint,
    couponHints,
  } = useCartPage()

  // Render guards — hooks are always called above these returns (Rules of Hooks).
  if (!mounted)      return <CartSkeleton />
  if (!items.length) return <EmptyCart />

  // Fix 6: || 0 converts NaN (empty string in DB → parseFloat('') = NaN) to 0
  // so downstream comparisons always work with a valid number.
  const minOrderAmt = parseFloat(settings.min_order_amount ?? '0') || 0

  // Fix 3: compute the visible item list once so both the heading count and the
  // rendered list are derived from the same source. totalQty (from the hook)
  // counts all Zustand items including pending-removal ones; visibleQty excludes
  // them, matching exactly the cards the user can see.
  const visibleItems = items.filter(item => !pendingRemovals.has(item.variantId))
  const visibleQty   = visibleItems.reduce((sum, i) => sum + i.qty, 0)

  // Fix 5: wa.me expects digits only — strip everything else before building the
  // href. Compute once here rather than inline in JSX to keep the template clean.
  // SEC-FIX: strip non-digits, then validate minimum length (7 digits) before
  // building the href. An empty-after-sanitization string would produce
  // `https://wa.me/` — a valid URL to an unrelated page. Requiring ≥7 digits
  // ensures we only render the link when a real phone number is configured.
  const _waDigits = (settings.whatsapp_number ?? '').replace(/\D/g, '')
  const whatsappHref = _waDigits.length >= 7 ? `https://wa.me/${_waDigits}` : null

  return (
    <main id="main-content">

      {/* Visually hidden h1 — required by WCAG 1.3.1; screen readers and crawlers
          need a page-level heading even when the visual design omits one. */}
      <h1 className="sr-only">Your Cart</h1>

      {/* ── Shipping progress bar ──────────────────────────────────────────── */}
      <div className="cp-ship-bar">
        <span aria-live="polite" aria-atomic="true">
          {freeShipMin > 0 ? (
            pricing.isFreeShipping
              ? <>🎉 You&apos;ve unlocked <strong>free shipping</strong>!</>
              : <>🚚 Add <strong>{formatPrice(pricing.remainingForFreeShip)}</strong> more for FREE shipping</>
          ) : '🚚 Free shipping on all orders!'}
        </span>
        {freeShipMin > 0 && (
          <div
            className="cp-ship-track"
            role="progressbar"
            aria-valuenow={Math.round(progressPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Free shipping progress"
          >
            <div className="cp-ship-fill" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </div>

      {/* ── Checkout progress steps ────────────────────────────────────────── */}
      <nav className="cp-steps" aria-label="Checkout progress">
        <ol className="cp-steps-list">
          <li className="cp-step cp-step-active" aria-current="step"><span aria-hidden="true">1</span> Cart</li>
          <li className="cp-step-line" aria-hidden="true" />
          <li className="cp-step"><span aria-hidden="true">2</span> Checkout</li>
          <li className="cp-step-line" aria-hidden="true" />
          <li className="cp-step"><span aria-hidden="true">3</span> Confirmation</li>
        </ol>
      </nav>

      <div className="cp-layout">

        {/* ══ LEFT ══════════════════════════════════════════════════════════ */}
        <div className="cp-left">

          {/* Cart items */}
          <div className="cp-card">
            <div className="cp-card-head">
              {/* Fix 3: visibleQty matches the cards actually shown.
                  The original totalQty included pending-removal items, showing
                  e.g. "Your Items (3)" when only 2 cards were visible. */}
              <h2 className="cp-card-title">Your Items ({visibleQty})</h2>
              <Link href="/products" className="cp-card-link">+ Add more</Link>
            </div>
            <div className="cp-items">
              {/* Fix 3 (continued): iterate visibleItems directly — removes the
                  duplicate .filter() call that was previously inline in the JSX. */}
              {visibleItems.map(item => (
                <CartItemCard
                  key={item.variantId}
                  item={item}
                  qtyAnim={qtyAnim[item.variantId] ?? null}
                  onQtyChange={handleQtyChange}
                  onRemove={handleRemove}
                />
              ))}

              {/* Undo toasts — one independent 4-second window per pending removal */}
              {[...pendingRemovals.entries()].map(([vid, entry]) => (
                <div key={vid} className="cp-undo-toast" role="status">
                  <span>&quot;{entry.name}&quot; removed</span>
                  {/* Fix 4: explicit type="button" — prevents accidental form
                      submission if this is ever wrapped in a <form>. */}
                  <button
                    type="button"
                    className="cp-undo-btn"
                    onClick={() => handleUndoRemove(vid)}
                  >
                    Undo
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Upsells — lazy loaded */}
          <ErrorBoundary section="Upsell" fallback={null}>
            <Suspense fallback={null}>
              <UpsellSection
                items={upsellItems}
                loading={upsellLoading}
                error={upsellError}
                addedIds={addedUpsell}
                remainingForFreeShip={pricing.remainingForFreeShip}
                isFreeShipping={pricing.isFreeShipping}
                freeShipMin={freeShipMin}
                onAdd={handleUpsellAdd}
              />
            </Suspense>
          </ErrorBoundary>

          {/* Pahadi story — lazy loaded */}
          <ErrorBoundary section="Story" fallback={null}>
            <Suspense fallback={null}>
              <PahadiStoryCard />
            </Suspense>
          </ErrorBoundary>

          {/* Trust grid */}
          <div className="cp-card cp-trust-card">
            <div className="cp-trust-grid">
              {TRUST_ITEMS.map(([icon, label, desc]) => (
                <div key={label} className="cp-trust-item">
                  <span className="cp-trust-icon">{icon}</span>
                  <div className="cp-trust-label">{label}</div>
                  <div className="cp-trust-desc">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Reviews — lazy loaded */}
          <ErrorBoundary section="Reviews" fallback={null}>
            <Suspense fallback={null}>
              <ReviewSection reviews={reviews} />
            </Suspense>
          </ErrorBoundary>

          {/* Delivery promise */}
          <div className="cp-card cp-delivery-card">
            <div className="cp-delivery-grid">
              {DELIVERY_ITEMS.map(([icon, label, sub]) => (
                <div key={label} className="cp-delivery-item">
                  <span className="cp-delivery-icon">{icon}</span>
                  <div>
                    <div className="cp-delivery-label">{label}</div>
                    <div className="cp-delivery-sub">{sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* WhatsApp — admin-controlled via settings.
              Fix 5: whatsappHref is pre-sanitized (digits only) above.
              Rendering null when the number is absent avoids an empty <a> tag. */}
          {whatsappHref && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="cp-whatsapp"
            >
              <span>💬</span><span>Have a question? Chat on WhatsApp</span>
            </a>
          )}
        </div>

        {/* ══ RIGHT ══════════════════════════════════════════════════════════ */}
        {/* cp-right is the sticky shell only — overflow lives on cp-right-inner.
            See cart-page.css for the full explanation of the sticky + overflow split. */}
        <div className="cp-right">
          <div className="cp-right-inner">
            <CartSummary
              items={items}
              totalQty={totalQty}
              pricing={pricing}
              coupon={coupon}
              onApplyCoupon={handleCoupon}
              onRemoveCoupon={removeCoupon}
              couponCode={couponCode}
              onCouponCodeChange={setCouponCode}
              couponLoading={couponLoading}
              couponError={couponError}
              couponHints={couponHints}
              onApplyHint={handleApplyHint}
              minOrderAmt={minOrderAmt}
            />
          </div>
        </div>
      </div>

      {/* Mobile sticky CTA
          Fix 2: pass orderSubtotal={pricing.subtotal} so StickyCartCTA compares
          the pre-shipping subtotal against minOrderAmt, matching CartSummary.
          Previously total={pricing.total} (post-shipping) was used for both
          display AND the min-order gate. A cart with ₹450 subtotal + ₹99
          shipping = ₹549 total passed the sticky check against a ₹500 minimum
          while CartSummary (correctly) blocked checkout — contradictory states. */}
      <StickyCartCTA
        total={pricing.total}
        orderSubtotal={pricing.subtotal}
        totalQty={totalQty}
        minOrderAmt={minOrderAmt}
      />

    </main>
  )
}
