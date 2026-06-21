'use client'

import { memo, useState, useMemo, useCallback } from 'react'
import Image from 'next/image'
import { formatPrice } from '@/lib/utils'
import type { SiteSettings, CartItem, AppliedCoupon } from '@/types'
import type { PriceSummary } from '@/lib/services/pricingService'
import './OrderSummary.css'  // PERF FIX: extracted from inline <style> block — was 18KB re-parsed on every render

interface CouponHint { code: string; label: string }

// ── Loyalty redemption shape ──────────────────────────────────
export interface LoyaltyRedemption {
  points:       number   // points to redeem
  discount_inr: number   // ₹ value of those points
}

interface Props {
  items: CartItem[]
  pricing: PriceSummary
  coupon: AppliedCoupon | null
  settings: SiteSettings
  couponCode: string
  couponLoading: boolean
  couponError: string
  couponHints: CouponHint[]
  onCouponCodeChange: (v: string) => void
  onApplyCoupon: () => void
  onRemoveCoupon: () => void
  // Called with the raw code when a hint pill is tapped — allows the parent to
  // apply the coupon directly without going through the couponCode state intermediate
  // (which would be stale by the time onApplyCoupon is called).
  onApplyHint?: (code: string) => void
  // ── Loyalty ───────────────────────────────────────────────
  loyaltyBalance:    number             // user's current coins balance
  loyaltyRedemption: LoyaltyRedemption | null
  onApplyLoyalty:    (pts: number) => Promise<void>
  onRemoveLoyalty:   () => void
  loyaltyLoading:    boolean
  loyaltyError:      string
  // ── Rest ──────────────────────────────────────────────────
  error: string
  placing: boolean
  bothPaymentsOff: boolean
  belowMinOrder: boolean
  razorpayLoaded: boolean
  minOrderAmt: number
  onPlaceOrder: () => void
  payMethod: 'razorpay' | 'cod'
  summaryOpen: boolean
  onToggleSummary: () => void
}

// PERF FIX: memo — large component; prevented from re-rendering on unrelated parent updates.
const OrderSummary = memo(function OrderSummary({
  items, pricing, coupon, settings, couponCode, couponLoading,
  couponError, couponHints, onCouponCodeChange, onApplyCoupon,
  onRemoveCoupon, onApplyHint,
  loyaltyBalance, loyaltyRedemption, onApplyLoyalty, onRemoveLoyalty,
  loyaltyLoading, loyaltyError,
  error, placing, bothPaymentsOff, belowMinOrder, razorpayLoaded,
  minOrderAmt, onPlaceOrder, payMethod, summaryOpen, onToggleSummary,
}: Props) {
  const [showHints,      setShowHints]      = useState(false)
  const [showLoyalty,    setShowLoyalty]    = useState(false)
  const [loyaltyInput,   setLoyaltyInput]   = useState('')

  // useMemo — settings-derived values; only recalc when settings/pricing/loyalty change
  const {
    savingsBadge, prepaidPct, loyaltyEnabled, loyaltyRate, loyaltyLabel,
    pointsValue, loyaltyPts, maxRedeemPct, maxRedeemValue, maxRedeemPts, cappedBalance,
  } = useMemo(() => {
    const prepaidPct     = parseInt(settings.prepaid_discount_pct || '5')
    const loyaltyEnabled = settings.loyalty_enabled === 'true'
    const loyaltyRate    = parseFloat(settings.loyalty_points_per_rupee || '1')
    const loyaltyLabel   = settings.loyalty_points_label || 'Pahadi Coins'
    const pointsValue    = parseFloat(settings.loyalty_points_value || '0.25')
    const loyaltyPts     = loyaltyEnabled ? Math.floor(pricing.total * loyaltyRate) : 0
    const maxRedeemPct   = parseFloat(settings.loyalty_max_redeem_pct || '20')
    const maxRedeemValue = Math.floor(pricing.subtotal * maxRedeemPct / 100)
    const maxRedeemPts   = Math.floor(maxRedeemValue / pointsValue)
    const cappedBalance  = Math.min(loyaltyBalance, maxRedeemPts)
    const savingsBadge   = pricing.discount + pricing.prepaidDiscount + (loyaltyRedemption?.discount_inr ?? 0)
    return {
      savingsBadge, prepaidPct, loyaltyEnabled, loyaltyRate, loyaltyLabel,
      pointsValue, loyaltyPts, maxRedeemPct, maxRedeemValue, maxRedeemPts, cappedBalance,
    }
  }, [settings, pricing, loyaltyBalance, loyaltyRedemption])

  // useMemo — ETA date calc; only recalc once per mount (time-of-day doesn't change mid-session)
  const { sameDay, etaMinStr, etaMaxStr } = useMemo(() => {
    const now     = new Date()
    const istHour = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) / 60 % 24
    const sameDay = istHour < 14
    const minDays = (sameDay ? 0 : 1) + 3
    const maxDays = (sameDay ? 0 : 1) + 5
    const etaMin  = new Date(now); etaMin.setDate(now.getDate() + minDays)
    const etaMax  = new Date(now); etaMax.setDate(now.getDate() + maxDays)
    const fmt     = (d: Date) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
    return { sameDay, etaMinStr: fmt(etaMin), etaMaxStr: fmt(etaMax) }
  }, [])

  // PERF FIX: wrapped in useCallback — was a plain async function declaration,
  // producing a new reference every render. cappedBalance (from the useMemo
  // above) and loyaltyInput are the only values read at call-time that aren't
  // stable setState dispatchers.
  const handleApplyLoyalty = useCallback(async () => {
    const pts = parseInt(loyaltyInput, 10)
    if (!pts || pts <= 0) return
    // Bug-fix: clamp to cappedBalance before submitting.
    // The input has max={cappedBalance} but that only prevents the stepper — a
    // user can type any value directly. Without clamping here, a value above the
    // user's balance (or above the order's redemption cap) is sent to the server,
    // which returns a 400 error. Clamping client-side provides immediate, silent
    // correction and avoids an unnecessary round-trip on the common case where
    // the user cleared and re-typed a number slightly above their balance.
    const clamped = Math.min(pts, cappedBalance)
    if (clamped !== pts) setLoyaltyInput(String(clamped))
    await onApplyLoyalty(clamped)
  }, [loyaltyInput, cappedBalance, onApplyLoyalty])

  return (
    <div className="os-root">

      {/* Sticky header inside sidebar */}
      <div className="os-head">
        <button className="os-head-btn" onClick={onToggleSummary} aria-expanded={summaryOpen} aria-controls="os-body-region" type="button">
          <span className="os-head-title">Your Order</span>
          <span className="os-head-meta">
            <span className="os-head-count">{items.length} item{items.length !== 1 ? 's' : ''}</span>
            <svg className={`os-chevron${summaryOpen ? '' : ' os-chevron--down'}`} width="12" height="8" viewBox="0 0 12 8" fill="none">
              <path d="M1 7L6 2L11 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </span>
        </button>
      </div>

      <div id="os-body-region" className={`os-body${summaryOpen ? ' os-body--open' : ''}`}>

        {/* Item list */}
        <div className="os-items">
          {items.map((item) => (
            <div key={item.variantId} className="os-item">
              <div className="os-img-shell">
                <div className="os-img">
                  {item.image
                    ? <Image src={item.image} alt={item.name} fill sizes="60px"
                        style={{ objectFit: 'cover', borderRadius: '10px' }} />
                    : <span style={{ fontSize: '26px' }}>{item.emoji || '🌿'}</span>}
                </div>
                <span className="os-qty">{item.qty}</span>
              </div>
              <div className="os-item-info">
                <div className="os-item-name">{item.name}</div>
                {item.size && <div className="os-item-size">{item.size}</div>}
              </div>
              <div className="os-item-price">{formatPrice(item.price * item.qty)}</div>
            </div>
          ))}
        </div>

        <div className="os-rule" />

        {/* ── Coupon ─────────────────────────────────────────── */}
        <div className="os-coupon-area">
          {coupon ? (
            <div className="os-coupon-applied">
              <div className="os-coupon-left">
                <span className="os-coupon-emoji">🎉</span>
                <div>
                  <div className="os-coupon-name">{coupon.code}</div>
                  <div className="os-coupon-saving">Saving {formatPrice(coupon.discount)}</div>
                </div>
              </div>
              <button className="os-coupon-rm" onClick={onRemoveCoupon} type="button" aria-label="Remove coupon">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          ) : (
            <>
              <div className="os-coupon-row">
                <input
                  className="os-coupon-input"
                  type="text"
                  value={couponCode}
                  onChange={e => onCouponCodeChange(e.target.value.toUpperCase())}
                  // BUG FIX: guard with !couponLoading — without it, holding Enter fires
                  // onApplyCoupon on every keydown repeat while loading, creating a race
                  // where multiple in-flight requests race to set coupon state.
                  onKeyDown={e => e.key === 'Enter' && !couponLoading && onApplyCoupon()}
                  placeholder="Coupon code"
                  aria-label="Coupon code"
                />
                <button className="os-coupon-btn" onClick={onApplyCoupon} disabled={couponLoading} type="button">
                  {couponLoading ? <span className="os-spin" /> : 'Apply'}
                </button>
              </div>
              {couponError && <p className="os-coupon-err">⚠ {couponError}</p>}
              {couponHints.length > 0 && (
                <div className="os-hints">
                  <button className="os-hints-toggle" type="button" onClick={() => setShowHints(v => !v)}>
                    🎟 {showHints ? 'Hide' : 'View'} available offers
                  </button>
                  {showHints && (
                    <div className="os-hints-list">
                      {couponHints.map(h => (
                        <button key={h.code} className="os-hint" type="button"
                          // BUG FIX: disabled while loading — without this, tapping a
                          // second hint while the first request is in-flight fires
                          // onApplyHint again, creating two concurrent fetch calls that
                          // race to set coupon state. The Enter key and Apply button both
                          // have this guard; the hint buttons were missing it.
                          disabled={couponLoading}
                          onClick={() => {
                            // BUG FIX: uppercase the code (DB values may be lowercase).
                            // Use onApplyHint when provided — it takes the code as a
                            // direct argument so there is no stale-closure problem.
                            // Falls back to setCouponCode only (no auto-apply) when the
                            // parent doesn't support onApplyHint.
                            const upper = h.code.toUpperCase()
                            onCouponCodeChange(upper)
                            setShowHints(false)
                            if (onApplyHint) {
                              onApplyHint(upper)
                            }
                          }}>
                          <span className="os-hint-code">{h.code}</span>
                          <span className="os-hint-label">{h.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Loyalty coins redemption ───────────────────────── */}
        {loyaltyEnabled && loyaltyBalance > 0 && (
          <>
            <div className="os-rule" />
            <div className="os-loyalty-area">
              {loyaltyRedemption ? (
                /* Applied state */
                <div className="os-loyalty-applied">
                  <div className="os-loyalty-applied-left">
                    <span className="os-loyalty-emoji">🪙</span>
                    <div>
                      <div className="os-loyalty-applied-title">
                        {loyaltyRedemption.points} {loyaltyLabel} applied
                      </div>
                      <div className="os-loyalty-applied-save">
                        Saving {formatPrice(loyaltyRedemption.discount_inr)}
                      </div>
                    </div>
                  </div>
                  <button className="os-coupon-rm" onClick={onRemoveLoyalty} type="button" aria-label="Remove loyalty discount">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              ) : (
                /* Input state */
                <>
                  <button
                    className={`os-loyalty-toggle${showLoyalty ? ' os-loyalty-toggle--open' : ''}`}
                    onClick={() => setShowLoyalty(v => !v)}
                    type="button"
                  >
                    <span>🪙</span>
                    <span className="os-loyalty-toggle-title">
                      Use {loyaltyLabel}
                    </span>
                    <span className="os-loyalty-toggle-bal">
                      {loyaltyBalance} available
                    </span>
                    <svg
                      className={`os-loyalty-chev${showLoyalty ? ' os-loyalty-chev--open' : ''}`}
                      width="12" height="8" viewBox="0 0 12 8" fill="none"
                    >
                      <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    </svg>
                  </button>

                  {showLoyalty && (
                    <div className="os-loyalty-panel">
                      <div className="os-loyalty-info">
                        <div className="os-loyalty-info-row">
                          <span>Your balance</span>
                          <strong>{loyaltyBalance} coins</strong>
                        </div>
                        <div className="os-loyalty-info-row">
                          <span>Max redeemable</span>
                          <strong>{cappedBalance} coins (₹{Math.floor(cappedBalance * pointsValue)})</strong>
                        </div>
                        <div className="os-loyalty-info-row os-loyalty-info-muted">
                          <span>1 coin = ₹{pointsValue} · Max {maxRedeemPct}% of order</span>
                        </div>
                      </div>
                      <div className="os-loyalty-input-row">
                        <input
                          className="os-loyalty-input"
                          type="number"
                          min={parseInt(settings.loyalty_min_redeem || '40')}
                          max={cappedBalance}
                          value={loyaltyInput}
                          onChange={e => setLoyaltyInput(e.target.value)}
                          placeholder={`Enter coins (max ${cappedBalance})`}
                          aria-label="Coins to redeem"
                          onFocus={() => { if (!loyaltyInput) setLoyaltyInput(String(cappedBalance)) }}
                        />
                        <button
                          className="os-loyalty-apply-btn"
                          onClick={handleApplyLoyalty}
                          disabled={loyaltyLoading || !loyaltyInput}
                          type="button"
                        >
                          {loyaltyLoading ? <span className="os-spin" /> : 'Redeem'}
                        </button>
                      </div>
                      {loyaltyInput && parseInt(loyaltyInput) > 0 && (
                        <div className="os-loyalty-preview">
                          💸 Saves ₹{Math.floor(parseInt(loyaltyInput || '0') * pointsValue)} on this order
                        </div>
                      )}
                      {loyaltyError && <p className="os-coupon-err">⚠ {loyaltyError}</p>}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}

        <div className="os-rule" />

        {/* Price table */}
        <div className="os-price-table">
          <div className="os-price-row">
            <span>Subtotal</span>
            <span>{formatPrice(pricing.subtotal)}</span>
          </div>
          {coupon && pricing.discount > 0 && (
            <div className="os-price-row os-price-row--green">
              <span>Coupon ({coupon.code})</span>
              <span>−{formatPrice(pricing.discount)}</span>
            </div>
          )}
          {pricing.prepaidDiscount > 0 && (
            <div className="os-price-row os-price-row--green">
              <span>Prepaid discount ({prepaidPct}%)</span>
              <span>−{formatPrice(pricing.prepaidDiscount)}</span>
            </div>
          )}
          {/* Loyalty discount row */}
          {loyaltyRedemption && loyaltyRedemption.discount_inr > 0 && (
            <div className="os-price-row os-price-row--coins">
              <span>🪙 {loyaltyLabel} ({loyaltyRedemption.points} coins)</span>
              <span>−{formatPrice(loyaltyRedemption.discount_inr)}</span>
            </div>
          )}
          <div className="os-price-row">
            <span>Shipping</span>
            <span className={pricing.isFreeShipping ? 'os-free' : ''}>
              {pricing.isFreeShipping ? '🚚 FREE' : formatPrice(pricing.shipping)}
            </span>
          </div>
          {pricing.gstTotal > 0 && (
            <div className="os-price-row os-price-row--muted">
              <span>GST (inclusive)</span>
              <span>₹{pricing.gstTotal}</span>
            </div>
          )}

          {/* Total */}
          <div className="os-total">
            <span className="os-total-label">Total</span>
            <span className="os-total-value">{formatPrice(pricing.total)}</span>
          </div>

          {savingsBadge > 0 && (
            <div className="os-saving-strip">
              <span>🏷</span>
              <span>You&apos;re saving <strong>{formatPrice(savingsBadge)}</strong> on this order</span>
            </div>
          )}
          {loyaltyEnabled && loyaltyPts > 0 && !loyaltyRedemption && (
            <div className="os-loyalty-earn-strip">
              ⭐ Earn <strong>{loyaltyPts} {loyaltyLabel}</strong> on this order
            </div>
          )}
        </div>
      </div>

      {/* Errors — role="alert" triggers immediate announcement by screen readers */}
      {belowMinOrder && (
        <div className="os-error-box" role="alert">
          🛒 Minimum order is {formatPrice(minOrderAmt)}. Add <strong>{formatPrice(minOrderAmt - pricing.subtotal)}</strong> more.
        </div>
      )}
      {error && <div className="os-error-box" role="alert">⚠ {error}</div>}

      {/* CTA */}
      <div className="os-cta-area">
        <button
          className={`os-cta${placing ? ' os-cta--loading' : ''}`}
          onClick={onPlaceOrder}
          disabled={placing || bothPaymentsOff || belowMinOrder || (payMethod === 'razorpay' && !razorpayLoaded)}
          type="button"
          aria-busy={placing}
        >
          {placing ? (
            <><span className="os-spin os-spin--white" /> Placing Order…</>
          ) : payMethod === 'razorpay' && !razorpayLoaded ? (
            <><span className="os-spin" /> Loading payment…</>
          ) : payMethod === 'razorpay' ? (
            <><span>⚡ Pay Securely</span><span className="os-cta-amt">{formatPrice(pricing.total)}</span></>
          ) : (
            <><span>Place COD Order</span><span className="os-cta-amt">{formatPrice(pricing.total)}</span></>
          )}
        </button>

        <div className="os-secure-row">
          <svg width="12" height="14" viewBox="0 0 12 14" fill="none" className="os-lock">
            <rect x="2" y="6" width="8" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M3.5 6V4.5a2.5 2.5 0 015 0V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          100% Secure &amp; Encrypted Checkout
        </div>
      </div>

      {/* ETA */}
      <div className="os-eta">
        <div className="os-eta-icon">🚚</div>
        <div>
          <div className="os-eta-line">
            Delivery by <strong>{etaMinStr} – {etaMaxStr}</strong>
          </div>
          <div className="os-eta-sub">
            {sameDay ? 'Order now for today\'s dispatch!' : 'Order now for tomorrow\'s dispatch'}
          </div>
        </div>
      </div>

    </div>
  )
})

export default OrderSummary
