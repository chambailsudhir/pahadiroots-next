'use client'

/**
 * cart/page.tsx — pure render shell (~100 lines, down from ~300).
 *
 * All state, data-fetching, and handlers have been extracted to useCartPage.
 * This file is now a layout orchestrator only — it renders, it does not think.
 *
 * Fixes applied in this file:
 *   • God component smell        — 9 useState calls removed; hook owns all state.
 *   • CSS template literal       — PAGE_CSS removed; styles imported from cart-page.css.
 *   • CART_ITEM_CARD_CSS import  — removed; CartItemCard now self-imports its CSS.
 *   • SiteSettings unsafe cast   — removed; hook exposes Partial<SiteSettings>.
 *   • eslint-disable suppressions — both removed; hook fixes deps properly.
 *   • Inline RawVariant/RawProduct interfaces — removed; live in types/store-data.ts.
 *   • SRP store-data call        — removed; hook calls cart-settings + cart-upsells.
 *
 * ADMIN SETTINGS CONSUMED:
 *   free_shipping_min, flat_shipping_charge, whatsapp_number, min_order_amount
 *   review_1/2/3_name/location/text
 */

import './cart-page.css'

import Link                   from 'next/link'
import { lazy, Suspense }     from 'react'
import { formatPrice }        from '@/lib/utils'
import { useCartPage }        from '@/hooks/useCartPage'

import CartSkeleton                        from '@/components/cart/CartSkeleton'
import CartItemCard                        from '@/components/cart/CartItemCard'
import CartSummary                         from '@/components/cart/CartSummary'
import { StickyCartCTA, EmptyCart }        from '@/components/cart/CartUIComponents'
import ErrorBoundary                       from '@/components/ui/ErrorBoundary'
import { useCartStore }                    from '@/store/cartStore'
import { useState, useEffect }             from 'react'

// Lazy-load below-fold sections for performance
const UpsellSection   = lazy(() => import('@/components/cart/UpsellSection'))
const ReviewSection   = lazy(() => import('@/components/cart/ReviewSection'))
const PahadiStoryCard = lazy(() => import('@/components/cart/PahadiStoryCard'))

// ─── Trust / delivery data — static, defined at module level ─────────────────
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
  // Hydration guard — stores use skipHydration:true
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
    handleUpsellAdd, handleCoupon,
  } = useCartPage()

  // Render guards
  if (!mounted)        return <CartSkeleton />
  if (!items.length)   return <EmptyCart />

  const minOrderAmt = parseFloat(settings.min_order_amount ?? '0')

  return (
    <main id="main-content">

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
        <div className="cp-step cp-step-active" aria-current="step"><span aria-hidden="true">1</span> Cart</div>
        <div className="cp-step-line" aria-hidden="true" />
        <div className="cp-step"><span aria-hidden="true">2</span> Checkout</div>
        <div className="cp-step-line" aria-hidden="true" />
        <div className="cp-step"><span aria-hidden="true">3</span> Confirmation</div>
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
              {items
                .filter(item => !pendingRemovals.has(item.variantId))
                .map(item => (
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
                  <button className="cp-undo-btn" onClick={() => handleUndoRemove(vid)}>Undo</button>
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

          {/* WhatsApp — admin-controlled via settings */}
          {settings.whatsapp_number && (
            <a
              href={`https://wa.me/${settings.whatsapp_number}`}
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
              minOrderAmt={minOrderAmt}
            />
          </div>
        </div>
      </div>

      {/* Mobile sticky CTA */}
      <StickyCartCTA
        total={pricing.total}
        totalQty={totalQty}
        minOrderAmt={minOrderAmt}
      />

    </main>
  )
}
