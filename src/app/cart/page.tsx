'use client'

/**
 * cart/page.tsx — pure render shell.
 *
 * Accessibility fixes applied (this round):
 *
 *   A1. Decorative emojis in shipping progress bar inside aria-live region
 *       were announced on every update (WCAG 1.3.3).
 *       The shipping bar uses aria-live="polite" so every content change is
 *       read aloud. Emojis like 🎉 and 🚚 were read as "party popper emoji"
 *       or "delivery truck emoji" before the meaningful message text, adding
 *       noise on every qty change or coupon apply.
 *       Fix: aria-hidden="true" on all emoji spans inside the live region.
 *
 *   A2. Decorative emojis in trust and delivery cards announced unnecessarily.
 *       Each trust/delivery item has a large icon emoji followed immediately
 *       by a descriptive label (e.g. 🌿 "100% Natural"). The emoji name adds
 *       no information. aria-hidden="true" added to all icon spans in both grids.
 *
 *   A3. WhatsApp link opens in a new tab with no accessible warning (WCAG 3.2.2).
 *       target="_blank" opens a new browsing context without warning. Keyboard
 *       and screen reader users rely on advance notice of context changes.
 *       Fix: visually-hidden "(opens in new window)" text added inside the link
 *       so screen readers announce it, while sighted users see only the label.
 *
 *   A4. Undo toast button labelled "Undo" without context (WCAG 2.4.6).
 *       In a cart with multiple pending removals, all undo buttons announced
 *       identically as "Undo, button". Screen reader users could not tell which
 *       item each button would restore.
 *       Fix: aria-label={`Undo removal of "${entry.name}"`} added so each
 *       button has a unique, descriptive accessible name.
 *
 * Prior bug-fixes already present (kept for reference):
 *   1. Duplicate React imports merged.
 *   2. Min order amount comparison inconsistency (StickyCartCTA now uses
 *      orderSubtotal, not total, for the min-order gate).
 *   3. "Your Items (N)" counter included pending-removal items — fixed with
 *      visibleItems / visibleQty derived from filtered list.
 *   4. Undo toast button missing type="button".
 *   5. WhatsApp number sanitized before use in wa.me URL.
 *   6. parseFloat NaN guard added for minOrderAmt.
 */

import './cart-page.css'

import Link                             from 'next/link'
import { lazy, Suspense }               from 'react'
import { formatPrice }                  from '@/lib/utils'
import { useCartPage }                  from '@/hooks/useCartPage'
import { useCartStore, selectHasHydrated } from '@/store/cartStore'

import CartSkeleton                     from '@/components/cart/CartSkeleton'
import CartItemCard                     from '@/components/cart/CartItemCard'
import CartSummary                      from '@/components/cart/CartSummary'
import { StickyCartCTA, EmptyCart }     from '@/components/cart/CartUIComponents'
import ErrorBoundary                    from '@/components/ui/ErrorBoundary'

const UpsellSection   = lazy(() => import('@/components/cart/UpsellSection'))
const ReviewSection   = lazy(() => import('@/components/cart/ReviewSection'))
const PahadiStoryCard = lazy(() => import('@/components/cart/PahadiStoryCard'))

// Static, defined at module level — never recreated on re-renders.
const TRUST_ITEMS = [
  ['🌿', '100% Natural',        'No chemicals or preservatives'],
  ['🏔', 'Himalayan Sourced',   'Direct from mountain farmers'],
  ['🤝', 'Farmer Direct',       'Fair trade, fair prices'],
  ['📦', 'Small Batch',         'Fresh, limited production'],
] as const

const DELIVERY_ITEMS = [
  ['🚚', 'Delivery in 3–5 Days', 'Pan India'],
  ['🔄', 'Easy Returns',         '48-hour policy'],
  ['🔒', 'Secure Payment',       'SSL encrypted'],
  ['📞', 'WhatsApp Support',     'Mon–Sat 9am–6pm'],
] as const

export default function CartPage() {
  // BUG FIX (hydration-race): a plain `useEffect(() => setMounted(true), [])`
  // flipped `mounted` to true BEFORE StoreHydrator's deferred
  // `persist.rehydrate()` call resolved (setTimeout(0) runs after the
  // synchronous effect-flush). For one tick `mounted` was true while `items`
  // was still `[]`, so a returning user with a persisted cart briefly saw
  // <EmptyCart/> flash before their items appeared.
  // Fix: gate on `_hasHydrated`, which only flips true inside
  // onRehydrateStorage — after localStorage has actually been applied.
  // See cartStore.ts for the full explanation.
  const hasHydrated = useCartStore(selectHasHydrated)

  const {
    items, visibleItems, coupon, removeCoupon,
    couponCode, setCouponCode, couponLoading, couponError,
    upsellItems, upsellLoading, upsellError, addedUpsell,
    reviews, settings,
    qtyAnim, pendingRemovals,
    freeShipMin, pricing, progressPct, totalQty,
    handleQtyChange, handleRemove, handleUndoRemove, flushPendingRemovals,
    handleUpsellAdd, handleCoupon, handleApplyHint,
    couponHints,
  } = useCartPage()

  if (!hasHydrated)  return <CartSkeleton />
  if (!items.length) return <EmptyCart />

  const minOrderAmt = parseFloat(settings.min_order_amount ?? '0') || 0

  // visibleItems/totalQty come from useCartPage — pricing, the "Your Items (N)"
  // header, CartSummary's subtotal, and the sticky bottom bar all now derive
  // from the same filtered (pending-removal-excluded) list. See the BUG FIX
  // comment in useCartPage.ts for why this single source of truth matters.

  const _waDigits = (settings.whatsapp_number ?? '').replace(/\D/g, '')
  const whatsappHref = _waDigits.length >= 7 ? `https://wa.me/${_waDigits}` : null

  return (
    <main id="main-content">

      <h1 className="sr-only">Your Cart</h1>

      {/* ── Shipping progress bar ──────────────────────────────────────────── */}
      <div className="cp-ship-bar">
        {/*
         * A1: aria-hidden on all emoji spans inside the aria-live region.
         *     The emojis (🎉, 🚚) are decorative — the meaningful message text
         *     follows each one. Without aria-hidden, VoiceOver announces
         *     "party popper emoji You've unlocked free shipping" on every update.
         */}
        <span aria-live="polite" aria-atomic="true">
          {freeShipMin > 0 ? (
            pricing.isFreeShipping
              ? <><span aria-hidden="true">🎉</span> You&apos;ve unlocked <strong>free shipping</strong>!</>
              : <><span aria-hidden="true">🚚</span> Add <strong>{formatPrice(pricing.remainingForFreeShip)}</strong> more for FREE shipping</>
          ) : <><span aria-hidden="true">🚚</span> Free shipping on all orders!</>}
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
            <div className="cp-ship-fill" style={{ width: `${progressPct}%` }} aria-hidden="true" />
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
              <h2 className="cp-card-title">Your Items ({totalQty})</h2>
              <Link href="/products" className="cp-card-link">+ Add more</Link>
            </div>
            <div className="cp-items">
              {visibleItems.map(item => (
                <CartItemCard
                  key={item.variantId}
                  item={item}
                  qtyAnim={qtyAnim[item.variantId] ?? null}
                  onQtyChange={handleQtyChange}
                  onRemove={handleRemove}
                />
              ))}

              {/* Undo toasts */}
              {[...pendingRemovals.entries()].map(([vid, entry]) => (
                <div key={vid} className="cp-undo-toast" role="status">
                  <span>&quot;{entry.name}&quot; removed</span>
                  {/*
                   * A4: aria-label gives each undo button a unique accessible name.
                   *     "Undo, button" is ambiguous when multiple removals are
                   *     pending. "Undo removal of 'Pahadi Ghee'" is unambiguous.
                   */}
                  <button
                    type="button"
                    className="cp-undo-btn"
                    onClick={() => handleUndoRemove(vid)}
                    aria-label={`Undo removal of "${entry.name}"`}
                  >
                    Undo
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Upsells */}
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

          {/* Pahadi story */}
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
                  {/* A2: aria-hidden on decorative icon emoji — label text follows */}
                  <span className="cp-trust-icon" aria-hidden="true">{icon}</span>
                  <div className="cp-trust-label">{label}</div>
                  <div className="cp-trust-desc">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Reviews */}
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
                  {/* A2: aria-hidden on decorative icon emoji — label text follows */}
                  <span className="cp-delivery-icon" aria-hidden="true">{icon}</span>
                  <div>
                    <div className="cp-delivery-label">{label}</div>
                    <div className="cp-delivery-sub">{sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/*
           * A3: WhatsApp link opens in a new tab.
           *     target="_blank" opens a new browsing context without warning.
           *     Screen reader users hear the sr-only "(opens in new window)"
           *     text as part of the link label; sighted users see only the
           *     visible label text — no visual change.
           */}
          {whatsappHref && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="cp-whatsapp"
            >
              <span aria-hidden="true">💬</span>
              <span>Have a question? Chat on WhatsApp</span>
              <span className="sr-only">(opens in new window)</span>
            </a>
          )}
        </div>

        {/* ══ RIGHT ══════════════════════════════════════════════════════════ */}
        <div className="cp-right">
          <div className="cp-right-inner">
            <CartSummary
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
              onCheckout={flushPendingRemovals}
            />
          </div>
        </div>
      </div>

      <StickyCartCTA
        total={pricing.total}
        orderSubtotal={pricing.subtotal}
        totalQty={totalQty}
        minOrderAmt={minOrderAmt}
        onCheckout={flushPendingRemovals}
      />

    </main>
  )
}
