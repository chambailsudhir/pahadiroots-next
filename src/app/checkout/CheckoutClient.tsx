'use client'

/**
 * CheckoutClient — pure render shell.
 *
 * All state, effects, and handlers have been extracted to useCheckoutPage
 * (src/hooks/useCheckoutPage.ts) — matching the architectural pattern already
 * in place for CartPage / useCartPage.
 *
 * Architecture fix (this round):
 *   • Eliminated 17 inline useState calls — god-component anti-pattern flagged
 *     in the enterprise audit (React Architecture domain, −2 pts).
 *   • Helper functions (matchState, parseSavedAddresses, applyProfileData) moved
 *     to module level in the hook file — prevents per-render re-allocation.
 *
 * Accessibility fix (this round):
 *   A1. Mobile sticky CTA had no aria-live region for loading/error state changes.
 *       The button text cycles through 'Placing…' / 'Loading…' / '⚡ Pay Now' /
 *       'Place Order →', but these changes were never announced to screen readers.
 *       Fix: a visually-hidden <span aria-live="polite"> mirrors the button's
 *       current status label so AT users hear the state change without needing
 *       to focus the button. The label is only populated when a meaningful state
 *       is active (loading / error) and cleared when idle, preventing repetitive
 *       announcements on every render.
 *
 * Prior fixes already present (kept for reference):
 *   • checkout.css extracted from inline <style> block (900+ chars, Medium audit issue).
 *   • Trust-strip emojis wrapped in aria-hidden="true".
 *   • Razorpay loaded via Next.js Script with onLoad gate for Pay Now button.
 *   • handlePlace error surfaced to user instead of silently swallowed.
 *   • applyCoupon / handleApplyCouponHint: mountedRef guards (see useCheckoutPage).
 */

import './checkout.css'

import Script from 'next/script'
import { formatPrice }  from '@/lib/utils'
import { INDIA_STATES } from '@/lib/account/constants'
import { useCheckoutPage } from '@/hooks/useCheckoutPage'
import type { SiteSettings } from '@/types'

import CheckoutSkeleton     from '@/components/checkout/CheckoutSkeleton'
import ShippingProgress     from '@/components/checkout/ShippingProgress'
import SavedAddressSelector from '@/components/checkout/SavedAddressSelector'
import AddressForm          from '@/components/checkout/AddressForm'
import PaymentSection       from '@/components/checkout/PaymentSection'
import OrderSummary         from '@/components/checkout/OrderSummary'

// PERF: module-level constant — was an inline array literal inside JSX, which
// created a new array on every render. Hoisting it prevents the allocation.
const CHECKOUT_TRUST_ITEMS = [
  { icon: '🚚', t: '3–5 Day Delivery', d: 'Pan-India Himalayan dispatch' },
  { icon: '🔄', t: '7-Day Returns',    d: 'Hassle-free, no questions'   },
  { icon: '🌿', t: '100% Authentic',   d: 'Straight from the mountains' },
  { icon: '💬', t: 'WhatsApp Support', d: 'Real humans, always here'    },
] as const

export function CheckoutClient({ settings }: { settings: SiteSettings }) {
  const {
    storeReady,
    items, coupon, removeCoupon,
    payMethod, setPayMethod,
    placing, razorpayLoaded, setRazorpayLoaded,
    error,
    couponCode, setCouponCode, couponLoading, couponError, couponHints,
    loyaltyBalance, loyaltyRedemption, loyaltyLoading, loyaltyError,
    addr, email, setEmail, savedAddrs, selectedSavedIdx,
    summaryOpen, setSummaryOpen, touched,
    codEnabled, razorpayEnabled, codMax, prepaidPct, freeShipMin, minOrderAmt, razorpayKeyId,
    pricing, codOk, belowMinOrder, bothPayOff,
    setAddrField, touchField, applySaved,
    handleCoupon, handleApplyCouponHint,
    handleApplyLoyalty, handleRemoveLoyalty,
    handlePlace,
  } = useCheckoutPage(settings)

  if (!storeReady) return <CheckoutSkeleton />
  if (items.length === 0) return null

  // A1: derive a human-readable status label for the aria-live region.
  // Only populated during transient states — cleared when idle so the region
  // doesn't continuously announce the button text on every render.
  const mobCtaStatus = placing
    ? 'Placing your order…'
    : payMethod === 'razorpay' && !razorpayLoaded
      ? 'Loading payment gateway…'
      : error
        ? error
        : ''

  const mobCtaLabel = placing
    ? 'Placing…'
    : payMethod === 'razorpay' && !razorpayLoaded
      ? 'Loading…'
      : payMethod === 'razorpay'
        ? '⚡ Pay Now'
        : 'Place Order →'

  return (
    <>
      {/* Razorpay checkout.js — loaded via Next.js Script so we get an onLoad
          callback. razorpayLoaded gates the Pay Now button until ready. */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onLoad={() => setRazorpayLoaded(true)}
        onError={() => console.error('[checkout] Razorpay script failed to load')}
      />

      <ShippingProgress
        progressBase={pricing.progressBase}
        freeShipMin={freeShipMin}
        isFreeShipping={pricing.isFreeShipping}
        remainingForFreeShip={pricing.remainingForFreeShip}
      />

      {/* Breadcrumb */}
      <nav className="ck-nav">
        <div className="ck-nav-inner">
          <div className="ck-crumb ck-crumb--done">
            <div className="ck-crumb-dot ck-crumb-dot--done">✓</div>
            <span>Cart</span>
          </div>
          <div className="ck-crumb-line ck-crumb-line--done" />
          <div className="ck-crumb ck-crumb--active">
            <div className="ck-crumb-dot ck-crumb-dot--active">2</div>
            <span>Checkout</span>
          </div>
          <div className="ck-crumb-line" />
          <div className="ck-crumb">
            <div className="ck-crumb-dot">3</div>
            <span>Confirmation</span>
          </div>
        </div>
      </nav>

      {bothPayOff && (
        <div className="ck-alert">⚠ Checkout temporarily unavailable. Please contact support.</div>
      )}

      <div className="ck-page">
        <div className="ck-grid">

          {/* ── LEFT COLUMN ── */}
          <div className="ck-left">

            <section className="ck-section">
              <div className="ck-section-header">
                <div className="ck-step-badge">01</div>
                <div>
                  <h2 className="ck-section-title">Delivery Details</h2>
                  <p className="ck-section-desc">Where should we send your order?</p>
                </div>
              </div>
              <div className="ck-section-body">
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
                  selectedSavedIdx={selectedSavedIdx}
                />
              </div>
            </section>

            <section className="ck-section">
              <div className="ck-section-header">
                <div className="ck-step-badge">02</div>
                <div>
                  <h2 className="ck-section-title">Payment Method</h2>
                  <p className="ck-section-desc">Secure, encrypted &amp; instant</p>
                </div>
              </div>
              <div className="ck-section-body">
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
            </section>

            {/* Trust strip — emojis are decorative; aria-hidden prevents screen readers
                from announcing emoji names (e.g. "delivery truck", "sparkles") */}
            <div className="ck-trust">
              {CHECKOUT_TRUST_ITEMS.map(({ icon, t, d }) => (
                <div key={t} className="ck-trust-card">
                  <div className="ck-trust-icon" aria-hidden="true">{icon}</div>
                  <div className="ck-trust-text">
                    <strong>{t}</strong>
                    <span>{d}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT COLUMN ── */}
          <aside className="ck-sidebar">
            <OrderSummary
              items={items}
              pricing={pricing}
              coupon={coupon}
              settings={settings}
              couponCode={couponCode}
              couponLoading={couponLoading}
              couponError={couponError}
              couponHints={couponHints}
              onCouponCodeChange={setCouponCode}
              onApplyCoupon={handleCoupon}
              onRemoveCoupon={removeCoupon}
              onApplyHint={handleApplyCouponHint}
              loyaltyBalance={loyaltyBalance}
              loyaltyRedemption={loyaltyRedemption}
              onApplyLoyalty={handleApplyLoyalty}
              onRemoveLoyalty={handleRemoveLoyalty}
              loyaltyLoading={loyaltyLoading}
              loyaltyError={loyaltyError}
              error={error}
              placing={placing}
              bothPaymentsOff={bothPayOff}
              belowMinOrder={belowMinOrder}
              razorpayLoaded={razorpayLoaded}
              minOrderAmt={minOrderAmt}
              onPlaceOrder={handlePlace}
              payMethod={payMethod}
              summaryOpen={summaryOpen}
              onToggleSummary={() => setSummaryOpen(o => !o)}
            />
          </aside>
        </div>
      </div>

      {/* Mobile sticky footer
       *
       * A1: aria-live="polite" span announces status changes to screen readers.
       *     The span is visually hidden (sr-only) — sighted users read the button
       *     text directly. SR users hear the status when it changes, e.g.:
       *       • "Placing your order…" when placing starts
       *       • "Loading payment gateway…" while Razorpay loads
       *       • The error message when handlePlace rejects
       *     The span is cleared when idle so it doesn't repeat "Place Order →"
       *     on every keystroke or state update unrelated to the button. */}
      <div className="ck-mob-bar">
        {/* A1: visually-hidden live region — see comment above */}
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {mobCtaStatus}
        </span>
        <div className="ck-mob-info">
          <span className="ck-mob-total">{formatPrice(pricing.total)}</span>
          <span className="ck-mob-sub">incl. all taxes</span>
        </div>
        <button
          type="button"
          className="ck-mob-cta"
          disabled={placing || bothPayOff || belowMinOrder || (payMethod === 'razorpay' && !razorpayLoaded)}
          onClick={() => {
            setSummaryOpen(true)
            handlePlace().then(() => {
              setTimeout(() => {
                const errEl = document.querySelector('.os-error-box')
                if (errEl) errEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }, 100)
            })
          }}
        >
          {mobCtaLabel}
        </button>
      </div>
    </>
  )
}
