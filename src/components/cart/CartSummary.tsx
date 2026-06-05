'use client'

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
            <button className={styles.couponRm} onClick={onRemoveCoupon} aria-label="Remove coupon">✕</button>
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
              type="text" value={couponCode}
              onChange={e => onCouponCodeChange(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && onApplyCoupon()}
              placeholder="e.g. WELCOME50"
              className={styles.couponInput}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button className={styles.couponBtn} onClick={onApplyCoupon}
              disabled={couponLoading} type="button">
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
        <div className={styles.minWarn} role="alert">
          ⚠ Minimum order is {formatPrice(minOrderAmt)}. Add{' '}
          <strong>{formatPrice(minOrderAmt - pricing.subtotal)}</strong> more to checkout.
        </div>
      )}

      {/* CTA */}
      {belowMinOrder ? (
        <div className={`${styles.cta} ${styles.ctaDisabled}`} aria-disabled="true">
          <span>🔒</span>
          <span>Proceed to Checkout</span>
          <span className={styles.ctaAmt}>{formatPrice(pricing.total)}</span>
        </div>
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
