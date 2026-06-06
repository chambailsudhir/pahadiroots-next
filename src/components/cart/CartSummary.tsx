'use client'

/**
 * CartSummary — order summary panel with coupon input, price breakdown, and CTA.
 *
 * Bug-fixes applied:
 *
 *   1. Coupon input Enter key bypassed the loading guard (Medium — Logic).
 *
 *      The Apply button was correctly disabled when couponLoading=true, preventing
 *      mouse/touch users from sending duplicate requests. However, the input's
 *      onKeyDown handler fired onApplyCoupon() unconditionally on Enter:
 *
 *        onKeyDown={e => e.key === 'Enter' && onApplyCoupon()}
 *
 *      A keyboard user who pressed Enter while a request was already in-flight
 *      would launch a second concurrent request. Both fetches would race to update
 *      state: whichever resolved last "won" the applyCoupon / setCouponError call,
 *      potentially showing a stale error from the first request after the second
 *      had already succeeded.
 *
 *      Fix: add !couponLoading to the short-circuit chain so Enter is a no-op while
 *      the first request is pending:
 *
 *        onKeyDown={e => e.key === 'Enter' && !couponLoading && onApplyCoupon()}
 *
 *      This aligns keyboard behaviour with the disabled-button UX and matches how
 *      the Apply button itself has always behaved.
 *
 *   2. Remove-coupon (✕) button missing type="button" (Minor — Accessibility).
 *
 *      The ✕ button that dismisses an applied coupon had no explicit type attribute.
 *      Without type="button", buttons default to type="submit" inside a <form>.
 *      While no <form> wraps CartSummary today, the omission is inconsistent with
 *      the rest of the codebase (Apply, hint pills, and CTA all carry the attribute)
 *      and risks accidental form submission if CartSummary is ever placed inside a
 *      checkout <form>.
 *      Fix: added type="button" to the couponRm button.
 */

import Link from 'next/link'
import { memo } from 'react'
import { formatPrice } from '@/lib/utils'
import type { CartItem, AppliedCoupon } from '@/types'
import type { PriceSummary } from '@/lib/services/pricingService'
import styles from './CartSummary.module.css'

interface CouponHint { code: string; label: string }

interface Props {
  items: CartItem[]
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
}

const CartSummary = memo(function CartSummary({
  items, totalQty, pricing, coupon,
  onApplyCoupon, onRemoveCoupon,
  couponCode, onCouponCodeChange,
  couponLoading, couponError,
  couponHints = [], onApplyHint,
  minOrderAmt = 0,
}: Props) {
  const belowMinOrder = minOrderAmt > 0 && pricing.subtotal < minOrderAmt

  return (
    <div className={styles.wrap}>
      {/* Coupon */}
      <div className={styles.coupon}>
        <div className={styles.couponHead}>🏷️ Have a coupon code?</div>
        <div className={styles.couponBody}>
        {coupon ? (
          <div className={styles.couponApplied}>
            <span>🎉 <strong>{coupon.code}</strong> — saving {formatPrice(coupon.discount)}</span>
            {/* Bug-fix: type="button" added — without it, this defaults to type="submit"
                inside any ancestor <form>, which would submit the form instead of
                removing the coupon. Consistent with all other interactive buttons in
                the codebase. */}
            <button type="button" className={styles.couponRm} onClick={onRemoveCoupon} aria-label="Remove coupon">✕</button>
          </div>
        ) : (
          <div className={styles.couponRow}>
            {/* A visible label is required by WCAG 1.3.1 (Info and Relationships).
                We use sr-only so it doesn't break the existing visual design —
                the "Have a coupon code?" heading already acts as a visual cue
                but is not programmatically associated with the input. */}
            <label htmlFor="coupon-code" className="sr-only">Coupon code</label>
            <input
              id="coupon-code"
              name="coupon-code"
              type="text"
              value={couponCode}
              onChange={e => onCouponCodeChange(e.target.value.toUpperCase())}
              // Bug-fix: guard Enter with !couponLoading.
              // Previously `e.key === 'Enter' && onApplyCoupon()` fired regardless
              // of loading state. The Apply button is disabled={couponLoading} so
              // mouse users could not double-submit, but keyboard users could —
              // two concurrent fetches would race on couponError / applyCoupon
              // state. Now both paths honour the same loading guard.
              onKeyDown={e => e.key === 'Enter' && !couponLoading && onApplyCoupon()}
              placeholder="e.g. WELCOME50"
              className={styles.couponInput}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
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
        {/* Aria-live region for coupon status — single announcement point, no double-fire */}
        <div aria-live="polite" aria-atomic="true" className={styles.couponLive}>
          {couponError && <span className={styles.couponErr}>⚠ {couponError}</span>}
        </div>
        {/* Coupon hints — quick-apply pills from /api/v1/coupon-hints */}
        {!coupon && couponHints.length > 0 && (
          <div className={styles.couponHints} role="group" aria-label="Available coupon codes">
            {couponHints.map(h => (
              <button
                key={h.code}
                className={styles.couponHintBtn}
                type="button"
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
            {pricing.isFreeShipping ? '🚚 FREE' : formatPrice(pricing.shipping)}
          </span>
        </div>
        <div className={styles.divider} />
        <div className={styles.total}>
          <span>Total</span>
          <span>{formatPrice(pricing.total)}</span>
        </div>
        {pricing.gstTotal > 0 && (
          <div className={styles.gstNote}>* Prices include GST</div>
        )}
        {pricing.discount > 0 && (
          <div className={styles.savePill}>🎉 Saving {formatPrice(pricing.discount)} on this order!</div>
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
        // A <button disabled> is natively focusable and announced as "dimmed" by
        // screen readers. aria-describedby wires the visible warning text so SR
        // users hear *why* checkout is blocked without needing to find the alert.
        <button
          type="button"
          disabled
          aria-describedby="cart-min-warn"
          className={`${styles.cta} ${styles.ctaDisabled}`}
        >
          <span aria-hidden="true">🔒</span>
          <span>Proceed to Checkout</span>
          <span className={styles.ctaAmt}>{formatPrice(pricing.total)}</span>
        </button>
      ) : (
        <Link href="/checkout" className={styles.cta}>
          <span>🔒</span>
          <span>Proceed to Checkout</span>
          <span className={styles.ctaAmt}>{formatPrice(pricing.total)}</span>
        </Link>
      )}

      <Link href="/products" className={styles.continue}>← Continue Shopping</Link>

      {/* Payment trust */}
      <div className={styles.trust}>
        <div className={styles.trustRow}>
          <span>🔐 SSL Encrypted</span>
          <span>🏦 Razorpay</span>
          <span>✅ Secure</span>
        </div>
        <div className={styles.logos}>
          {[['#6a1b9a','UPI'],['#1a1f71','VISA'],['#eb001b','MC'],
            ['#008c44','RuPay'],['#4285f4','GPay']].map(([bg,label]) => (
            <span key={label} className={styles.logo} style={{ background: bg }}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  )
})

export default CartSummary
