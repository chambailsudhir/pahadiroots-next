'use client'

/**
 * CartSummary — order summary panel with coupon input, price breakdown, and CTA.
 *
 * Accessibility fixes applied (this round):
 *
 *   A1. Coupon input missing aria-invalid + aria-describedby (WCAG 1.3.1 / 4.1.3).
 *       When the coupon error is set the input was visually highlighted red but
 *       never programmatically flagged as invalid. Screen readers had no way to
 *       associate the error text with the field that caused it.
 *       Fix:
 *         • id="coupon-code-error" added to the inner <span> inside the live
 *           region so it can be the target of aria-describedby.
 *         • aria-invalid={!!couponError} added to the <input> — flips from false
 *           (no error) to true (error present), which causes VoiceOver / NVDA to
 *           announce "invalid data" alongside the field label.
 *         • aria-describedby="coupon-code-error" added to the <input> — wires
 *           the error text so it is announced when the field receives focus while
 *           an error is active.
 *
 *   A2. Decorative emoji 🏷️ in coupon heading announced by screen readers.
 *       aria-hidden="true" added so SR users hear "Have a coupon code?" without
 *       a preceding emoji name (e.g. "label emoji Have a coupon code?").
 *
 *   A3. Decorative emoji 🎉 in coupon-applied banner announced by screen readers.
 *       The SR already hears the coupon code and saving amount — the emoji
 *       description adds no value. aria-hidden="true" added.
 *
 *   A4. The ✕ text inside the remove-coupon button is redundant because the
 *       button carries aria-label="Remove coupon". Without aria-hidden, SR users
 *       on some AT implementations hear both "Remove coupon" (aria-label) and
 *       "multiplication sign" (✕ character description).
 *       Fix: aria-hidden="true" on the ✕ character span.
 *
 *   A5. Savings pill emoji 🎉 and lock emoji 🔒 in CTA are decorative.
 *       aria-hidden="true" added to both so the meaningful CTA text isn't buried
 *       under emoji descriptions.
 *
 * Logic bug-fixes already present (prior round — kept for reference):
 *
 *   1. Coupon input Enter key bypassed couponLoading guard — race condition on
 *      double submit. Fixed: !couponLoading added to the onKeyDown handler.
 *
 *   2. Remove-coupon button was missing type="button" — would default to
 *      type="submit" inside a future <form>. Fixed.
 */

import Link from 'next/link'
import { memo } from 'react'
import { formatPrice } from '@/lib/utils'
import type { AppliedCoupon } from '@/types'
import type { PriceSummary } from '@/lib/services/pricingService'
import styles from './CartSummary.module.css'

interface CouponHint { code: string; label: string }

// PERF FIX: hoisted to module level — was recreated as a new array on every
// CartSummary render (even though it's purely static). React.memo couldn't
// prevent this because inline literals always produce new references.
const PAYMENT_LOGOS: [string, string][] = [
  ['#6a1b9a', 'UPI'],
  ['#1a1f71', 'VISA'],
  ['#eb001b', 'MC'],
  ['#008c44', 'RuPay'],
  ['#4285f4', 'GPay'],
]

interface Props {
  // items prop removed — CartSummary never references individual items;
  // it only needs pricing (which is already pre-computed from items by the parent).
  // Keeping it was dead weight and required callers to pass an unnecessary prop.
  totalQty: number
  pricing: PriceSummary
  coupon: AppliedCoupon | null
  onApplyCoupon: () => void
  onRemoveCoupon: () => void
  couponCode: string
  onCouponCodeChange: (v: string) => void
  couponLoading: boolean
  couponError: string
  couponHints?: CouponHint[]
  onApplyHint?: (code: string) => void
  minOrderAmt?: number
  // DATA INTEGRITY FIX: called (synchronously, before navigation) when the
  // user clicks "Proceed to Checkout". Flushes any items still inside the
  // 4-second Undo-removal window so cartStore.items matches exactly what
  // this summary just displayed — see flushPendingRemovals in useCartPage.ts.
  onCheckout?: () => void
}

const CartSummary = memo(function CartSummary({
  totalQty, pricing, coupon,
  onApplyCoupon, onRemoveCoupon,
  couponCode, onCouponCodeChange,
  couponLoading, couponError,
  couponHints = [], onApplyHint,
  minOrderAmt = 0,
  onCheckout,
}: Props) {
  const belowMinOrder = minOrderAmt > 0 && pricing.subtotal < minOrderAmt

  return (
    <div className={styles.wrap}>
      {/* Coupon */}
      <div className={styles.coupon}>
        {/* A2: aria-hidden on 🏷️ — emoji is decorative; SR reads "Have a coupon code?" */}
        <div className={styles.couponHead}>
          <span aria-hidden="true">🏷️</span>{' '}Have a coupon code?
        </div>
        <div className={styles.couponBody}>
        {coupon ? (
          <div className={styles.couponApplied}>
            {/* A3: aria-hidden on 🎉 — SR hears code + saving amount; emoji adds noise */}
            <span><span aria-hidden="true">🎉</span> <strong>{coupon.code}</strong> — saving {formatPrice(coupon.discount)}</span>
            <button
              type="button"
              className={styles.couponRm}
              onClick={onRemoveCoupon}
              aria-label="Remove coupon"
            >
              {/* A4: aria-hidden on ✕ — button's aria-label already describes the action;
                  some AT implementations read both the label and the inner text/character */}
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        ) : (
          <div className={styles.couponRow}>
            <label htmlFor="coupon-code" className="sr-only">Coupon code</label>
            <input
              id="coupon-code"
              name="coupon-code"
              type="text"
              value={couponCode}
              onChange={e => onCouponCodeChange(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && !couponLoading && onApplyCoupon()}
              placeholder="e.g. WELCOME50"
              className={styles.couponInput}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              // A1: aria-invalid flags the field as erroneous to screen readers.
              // aria-describedby wires the live error message to the input so SR
              // users hear the reason when they focus or navigate to the field.
              aria-invalid={!!couponError}
              aria-describedby={couponError ? 'coupon-code-error' : undefined}
            />
            <button
              className={styles.couponBtn}
              onClick={onApplyCoupon}
              disabled={couponLoading}
              type="button"
            >
              {couponLoading
                ? <><span className={styles.spinner} aria-hidden="true" />Applying…</>
                : 'Apply'}
            </button>
          </div>
        )}
        {/* A1: id added to the inner <span> so aria-describedby on the input can
            target the exact text node, not the outer wrapper div.
            aria-live="polite" + aria-atomic="true" ensures the error is announced
            as a complete sentence when it appears. */}
        <div aria-live="polite" aria-atomic="true" className={styles.couponLive}>
          {couponError && (
            <span id="coupon-code-error" className={styles.couponErr}>⚠ {couponError}</span>
          )}
        </div>
        {/* Coupon hints — quick-apply pills from /api/v1/coupon-hints */}
        {!coupon && couponHints.length > 0 && (
          <div className={styles.couponHints} role="group" aria-label="Available coupon codes">
            {couponHints.map(h => (
              <button
                key={h.code}
                className={styles.couponHintBtn}
                type="button"
                // BUG FIX: disabled while loading — same guard as the Apply button
                // and Enter key. Without it, tapping a hint while a prior request
                // is in-flight fires onApplyHint again, causing a race condition.
                disabled={couponLoading}
                onClick={() => onApplyHint?.(h.code)}
                aria-label={`Apply coupon ${h.code}: ${h.label}`}
              >
                <span className={styles.hintCode}>{h.code}</span>
                <span className={styles.hintLabel}>{h.label}</span>
              </button>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* Price breakdown */}
      <div className={styles.prices}>
        {/* MRP Total / Discount on MRP — product-level "was ₹X" discount,
            shown separately from the coupon discount below. mrp falls back
            to price on items with no mrp set, so this line only appears
            when there's a real saving to show. */}
        {pricing.mrpDiscount > 0 && (
          <div className={styles.row}>
            <span>MRP Total</span>
            <span>{formatPrice(pricing.mrpTotal)}</span>
          </div>
        )}
        {pricing.mrpDiscount > 0 && (
          <div className={`${styles.row} ${styles.rowGreen}`}>
            <span>Discount on MRP</span>
            <span>−{formatPrice(pricing.mrpDiscount)}</span>
          </div>
        )}
        <div className={styles.row}>
          <span>Subtotal ({totalQty} item{totalQty > 1 ? 's' : ''})</span>
          <span>{formatPrice(pricing.subtotal)}</span>
        </div>
        {coupon && pricing.discount > 0 && (
          <div className={`${styles.row} ${styles.rowGreen}`}>
            <span>Coupon ({coupon.code})</span>
            <span>−{formatPrice(pricing.discount)}</span>
          </div>
        )}
        <div className={styles.row}>
          <span>Shipping</span>
          <span className={pricing.isFreeShipping ? styles.free : ''}>
            {pricing.isFreeShipping ? (
              <><span aria-hidden="true">🚚</span> FREE</>
            ) : formatPrice(pricing.shipping)}
          </span>
        </div>
        {/* TRANSPARENCY FIX: pricing.codSurcharge was already being added into
            pricing.total (see pricingService.ts) but was never itemized anywhere
            on this page — Subtotal + Shipping silently didn't add up to Total.
            Amazon/Myntra-style checkouts itemize every charge; do the same here. */}
        {pricing.codSurcharge > 0 && (
          <div className={styles.row}>
            <span>COD Charges</span>
            <span>{formatPrice(pricing.codSurcharge)}</span>
          </div>
        )}
        {/* GST as a real line item (item prices are GST-inclusive, so this
            is informational, not additive — matches how it's shown at
            checkout in OrderSummary.tsx) instead of the old footnote-only
            "* Prices include GST" text with no amount. */}
        {pricing.gstTotal > 0 && (
          <div className={styles.row}>
            <span>GST (inclusive)</span>
            <span>{formatPrice(pricing.gstTotal)}</span>
          </div>
        )}
        <div className={styles.divider} />
        <div className={styles.total}>
          <span>Total</span>
          <span>{formatPrice(pricing.total)}</span>
        </div>
        {pricing.discount > 0 && (
          // A5: aria-hidden on 🎉 — the saving amount text is the meaningful content
          <div className={styles.savePill}>
            <span aria-hidden="true">🎉</span> Saving {formatPrice(pricing.discount)} on this order!
          </div>
        )}
      </div>

      {/* Min order warning */}
      {belowMinOrder && (
        <div id="cart-min-warn" className={styles.minWarn} role="alert">
          ⚠ Minimum order is {formatPrice(minOrderAmt)}. Add{' '}
          <strong>{formatPrice(minOrderAmt - pricing.subtotal)}</strong> more to checkout.
        </div>
      )}

      {/* CTA */}
      {belowMinOrder ? (
        <button
          type="button"
          disabled
          aria-describedby="cart-min-warn"
          className={`${styles.cta} ${styles.ctaDisabled}`}
        >
          {/* A5: aria-hidden on 🔒 — button label is "Proceed to Checkout"; emoji is decorative */}
          <span aria-hidden="true">🔒</span>
          <span>Proceed to Checkout</span>
          <span className={styles.ctaAmt}>{formatPrice(pricing.total)}</span>
        </button>
      ) : (
        <Link href="/checkout" className={styles.cta} onClick={onCheckout}>
          <span aria-hidden="true">🔒</span>
          <span>Proceed to Checkout</span>
          <span className={styles.ctaAmt}>{formatPrice(pricing.total)}</span>
        </Link>
      )}

      <Link href="/products" className={styles.continue}>← Continue Shopping</Link>

      {/* Payment trust */}
      <div className={styles.trust}>
        <div className={styles.trustRow}>
          <span><span aria-hidden="true">🔐</span> SSL Encrypted</span>
          <span><span aria-hidden="true">🏦</span> Razorpay</span>
          <span><span aria-hidden="true">✅</span> Secure</span>
        </div>
        <div className={styles.logos}>
          {PAYMENT_LOGOS.map(([bg, label]) => (
            <span key={label} className={styles.logo} style={{ background: bg }}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  )
})

export default CartSummary
