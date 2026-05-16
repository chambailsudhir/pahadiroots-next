'use client'

import Image from 'next/image'
import { useState } from 'react'
import { formatPrice } from '@/lib/utils'
import type { SiteSettings } from '@/types'

interface CouponHint { code: string; label: string }

interface Props {
  items: any[]
  pricing: any
  coupon: any
  settings: SiteSettings
  couponCode: string
  couponLoading: boolean
  couponError: string
  couponHints: CouponHint[]
  onCouponCodeChange: (v: string) => void
  onApplyCoupon: () => void
  onRemoveCoupon: () => void
  error: string
  placing: boolean
  bothPaymentsOff: boolean
  belowMinOrder: boolean
  minOrderAmt: number
  onPlaceOrder: () => void
  payMethod: 'razorpay' | 'cod'
  summaryOpen: boolean
  onToggleSummary: () => void
}

export default function OrderSummary({
  items, pricing, coupon, settings, couponCode, couponLoading,
  couponError, couponHints, onCouponCodeChange, onApplyCoupon,
  onRemoveCoupon, error, placing, bothPaymentsOff, belowMinOrder,
  minOrderAmt, onPlaceOrder, payMethod, summaryOpen, onToggleSummary,
}: Props) {
  const [showHints, setShowHints] = useState(false)

  const savingsBadge   = pricing.discount + pricing.prepaidDiscount
  const prepaidPct     = parseInt(settings.prepaid_discount_pct || '5')
  const loyaltyEnabled = settings.loyalty_enabled === 'true'
  const loyaltyRate    = parseFloat(settings.loyalty_points_per_rupee || '0.1')
  const loyaltyLabel   = settings.loyalty_points_label || 'reward points'
  const loyaltyPts     = loyaltyEnabled ? Math.floor(pricing.total * loyaltyRate) : 0

  const now     = new Date()
  const istHour = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) / 60 % 24
  const sameDay = istHour < 14
  const minDays = (sameDay ? 0 : 1) + 3
  const maxDays = (sameDay ? 0 : 1) + 5
  const etaMin  = new Date(now); etaMin.setDate(now.getDate() + minDays)
  const etaMax  = new Date(now); etaMax.setDate(now.getDate() + maxDays)
  const fmt     = (d: Date) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div className="os-root">

      {/* Sticky header inside sidebar */}
      <div className="os-head">
        <button className="os-head-btn" onClick={onToggleSummary} aria-expanded={summaryOpen} type="button">
          <span className="os-head-title">Your Order</span>
          <span className="os-head-meta">
            <span className="os-head-count">{items.length} item{items.length !== 1 ? 's' : ''}</span>
            <svg className={`os-chevron${summaryOpen ? '' : ' os-chevron--down'}`} width="12" height="8" viewBox="0 0 12 8" fill="none">
              <path d="M1 7L6 2L11 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </span>
        </button>
      </div>

      <div className={`os-body${summaryOpen ? ' os-body--open' : ''}`}>

        {/* Item list */}
        <div className="os-items">
          {items.map((item: any) => (
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

        {/* Coupon */}
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
                  onKeyDown={e => e.key === 'Enter' && onApplyCoupon()}
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
                          onClick={() => { onCouponCodeChange(h.code); setShowHints(false) }}>
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
              <span>You're saving <strong>{formatPrice(savingsBadge)}</strong> on this order</span>
            </div>
          )}
          {loyaltyEnabled && loyaltyPts > 0 && (
            <div className="os-loyalty-strip">
              ⭐ Earn <strong>{loyaltyPts} {loyaltyLabel}</strong> on this order
            </div>
          )}
        </div>
      </div>

      {/* Errors */}
      {belowMinOrder && (
        <div className="os-error-box">
          🛒 Minimum order is {formatPrice(minOrderAmt)}. Add <strong>{formatPrice(minOrderAmt - pricing.subtotal)}</strong> more.
        </div>
      )}
      {error && <div className="os-error-box">⚠ {error}</div>}

      {/* CTA */}
      <div className="os-cta-area">
        <button
          className={`os-cta${placing ? ' os-cta--loading' : ''}`}
          onClick={onPlaceOrder}
          disabled={placing || bothPaymentsOff || belowMinOrder}
          type="button"
          aria-busy={placing}
        >
          {placing ? (
            <><span className="os-spin os-spin--white" /> Placing Order…</>
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
            Delivery by <strong>{fmt(etaMin)} – {fmt(etaMax)}</strong>
          </div>
          <div className="os-eta-sub">
            {sameDay ? 'Order now for today\'s dispatch!' : 'Order now for tomorrow\'s dispatch'}
          </div>
        </div>
      </div>

      <style>{`
        .os-root {
          display: flex;
          flex-direction: column;
          min-height: 100%;
          padding-top: 40px;
        }

        /* Header */
        .os-head {
          padding: 20px 24px 18px;
          border-bottom: 1px solid #F0E8DC;
          position: sticky;
          top: -40px;
          background: #FFFFFF;
          z-index: 2;
        }
        .os-head-btn {
          width: 100%;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-family: inherit;
        }
        .os-head-title {
          font-family: 'Cormorant Garamond', Georgia, serif;
          font-size: 18px;
          font-weight: 600;
          color: #1C2B1E;
          letter-spacing: -0.2px;
        }
        .os-head-meta {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .os-head-count {
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          font-weight: 500;
          color: #9A9080;
          background: #F2EAE0;
          padding: 3px 9px;
          border-radius: 20px;
        }
        .os-chevron {
          color: #9A9080;
          transition: transform .25s ease;
          flex-shrink: 0;
        }
        .os-chevron--down { transform: rotate(180deg); }

        /* Body */
        .os-body { display: block; }
        @media (max-width: 960px) {
          .os-body { display: none; }
          .os-body--open { display: block; }
        }

        /* Items */
        .os-items {
          padding: 18px 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .os-item { display: flex; align-items: center; gap: 12px; }
        .os-img-shell { position: relative; flex-shrink: 0; }
        .os-img {
          width: 60px;
          height: 60px;
          border-radius: 12px;
          overflow: hidden;
          background: #F5F0E8;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid #EDE5D8;
        }
        .os-qty {
          position: absolute;
          top: -5px;
          right: -5px;
          width: 20px;
          height: 20px;
          background: #2C4A2E;
          color: #fff;
          border-radius: 50%;
          font-family: 'DM Sans', sans-serif;
          font-size: 10px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 4px rgba(0,0,0,.2);
          border: 1.5px solid #fff;
        }
        .os-item-info { flex: 1; min-width: 0; }
        .os-item-name {
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          font-weight: 600;
          color: #1C2B1E;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: -0.1px;
        }
        .os-item-size {
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          color: #9A9080;
          margin-top: 2px;
        }
        .os-item-price {
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          font-weight: 700;
          color: #1C2B1E;
          white-space: nowrap;
          flex-shrink: 0;
        }

        /* Rule */
        .os-rule { height: 1px; background: #F0E8DC; }

        /* Coupon */
        .os-coupon-area { padding: 14px 24px; }
        .os-coupon-row { display: flex; gap: 8px; }
        .os-coupon-input {
          flex: 1;
          min-width: 0;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          font-weight: 500;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          padding: 11px 13px;
          border: 1.5px solid #DDD5C8;
          border-radius: 12px;
          background: #FDFAF6;
          outline: none;
          transition: border-color .2s, box-shadow .2s;
          color: #1C2B1E;
        }
        .os-coupon-input::placeholder { color: #B8B0A5; letter-spacing: 0; text-transform: none; }
        .os-coupon-input:focus {
          border-color: #2C4A2E;
          background: #fff;
          box-shadow: 0 0 0 3px rgba(44,74,46,.08);
        }
        .os-coupon-btn {
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          font-weight: 700;
          color: #fff;
          background: #2C4A2E;
          border: none;
          padding: 11px 16px;
          border-radius: 12px;
          cursor: pointer;
          white-space: nowrap;
          letter-spacing: 0.03em;
          transition: background .2s, transform .15s;
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 60px;
        }
        .os-coupon-btn:hover:not(:disabled) { background: #3A6040; transform: translateY(-1px); }
        .os-coupon-btn:disabled { opacity: .6; cursor: not-allowed; }
        .os-coupon-applied {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          background: linear-gradient(135deg, #EEF8E8, #F5FAF0);
          border: 1.5px solid #B8DCA8;
          border-radius: 14px;
          gap: 8px;
        }
        .os-coupon-left { display: flex; align-items: center; gap: 10px; }
        .os-coupon-emoji { font-size: 20px; }
        .os-coupon-name {
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          font-weight: 700;
          color: #2C4A2E;
          letter-spacing: 1px;
        }
        .os-coupon-saving {
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          color: #4A7A40;
          font-weight: 500;
          margin-top: 1px;
        }
        .os-coupon-rm {
          background: rgba(0,0,0,.06);
          border: none;
          color: #7A7060;
          width: 26px;
          height: 26px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: background .15s;
        }
        .os-coupon-rm:hover { background: rgba(0,0,0,.12); }
        .os-coupon-err {
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          color: #C04030;
          margin-top: 6px;
        }
        .os-hints { margin-top: 10px; }
        .os-hints-toggle {
          background: none;
          border: none;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          font-weight: 600;
          color: #2C4A2E;
          cursor: pointer;
          padding: 0;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .os-hints-list { display: flex; flex-direction: column; gap: 7px; margin-top: 10px; }
        .os-hint {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #FDFAF6;
          border: 1.5px dashed #D8D0C4;
          border-radius: 12px;
          padding: 9px 13px;
          cursor: pointer;
          transition: all .18s;
          font-family: inherit;
          width: 100%;
          text-align: left;
        }
        .os-hint:hover { border-color: #2C4A2E; background: #EEF6EC; }
        .os-hint-code {
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          font-weight: 700;
          color: #2C4A2E;
          letter-spacing: 1px;
        }
        .os-hint-label {
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          color: #9A9080;
        }

        /* Price table */
        .os-price-table {
          padding: 16px 24px;
          display: flex;
          flex-direction: column;
          gap: 9px;
        }
        .os-price-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          color: #7A7060;
        }
        .os-price-row--green { color: #3A7030; font-weight: 600; }
        .os-price-row--muted { font-size: 11px; color: #B0A898; }
        .os-free { color: #3A7030; font-weight: 600; }

        .os-total {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          padding-top: 14px;
          border-top: 1.5px solid #E8E0D5;
          margin-top: 4px;
        }
        .os-total-label {
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          font-weight: 600;
          color: #1C2B1E;
        }
        .os-total-value {
          font-family: 'Cormorant Garamond', Georgia, serif;
          font-size: 30px;
          font-weight: 700;
          color: #1C2B1E;
          letter-spacing: -0.5px;
          line-height: 1;
        }

        .os-saving-strip {
          display: flex;
          align-items: center;
          gap: 7px;
          background: #EEF8E8;
          border: 1px solid #B8DCA8;
          border-radius: 10px;
          padding: 9px 12px;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          font-weight: 500;
          color: #3A6030;
        }
        .os-saving-strip strong { font-weight: 700; }
        .os-loyalty-strip {
          background: #FEF6E0;
          border: 1px solid #E8D070;
          border-radius: 10px;
          padding: 9px 12px;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          color: #7A5800;
        }

        /* Errors */
        .os-error-box {
          margin: 0 24px 12px;
          background: #FEF0EE;
          border: 1px solid #F0C8C0;
          border-radius: 12px;
          padding: 11px 14px;
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          color: #B03020;
          font-weight: 500;
        }

        /* CTA */
        .os-cta-area { padding: 12px 24px 14px; }
        .os-cta {
          width: 100%;
          padding: 17px 20px;
          background: #2C4A2E;
          color: #F5F0E8;
          border: none;
          border-radius: 16px;
          font-family: 'DM Sans', sans-serif;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          letter-spacing: 0.01em;
          box-shadow:
            0 1px 2px rgba(0,0,0,.06),
            0 6px 20px rgba(44,74,46,.35),
            inset 0 1px 0 rgba(255,255,255,.12);
          transition: all .25s cubic-bezier(.4,0,.2,1);
          position: relative;
          overflow: hidden;
        }
        .os-cta::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(255,255,255,.08) 0%, rgba(0,0,0,.04) 100%);
          pointer-events: none;
        }
        .os-cta:hover:not(:disabled) {
          background: #3A6040;
          transform: translateY(-2px);
          box-shadow: 0 2px 4px rgba(0,0,0,.08), 0 12px 32px rgba(44,74,46,.45), inset 0 1px 0 rgba(255,255,255,.14);
        }
        .os-cta:active:not(:disabled) { transform: translateY(0); }
        .os-cta:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; transform: none; }
        .os-cta-amt {
          font-family: 'Cormorant Garamond', Georgia, serif;
          font-size: 20px;
          font-weight: 700;
          letter-spacing: -0.3px;
          opacity: .9;
        }

        .os-secure-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          color: #9A9080;
          margin-top: 8px;
          font-weight: 400;
        }
        .os-lock { color: #9A9080; flex-shrink: 0; }

        /* ETA */
        .os-eta {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin: 0 24px 24px;
          padding: 12px 14px;
          background: #F5F0E8;
          border-radius: 12px;
          border: 1px solid #E8E0D5;
        }
        .os-eta-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
        .os-eta-line {
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          color: #4A4238;
          font-weight: 500;
          line-height: 1.5;
        }
        .os-eta-line strong { font-weight: 700; }
        .os-eta-sub {
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          color: #9A9080;
          margin-top: 2px;
        }

        /* Spinner */
        .os-spin {
          display: inline-block;
          width: 13px;
          height: 13px;
          border: 2px solid rgba(44,74,46,.2);
          border-top-color: #2C4A2E;
          border-radius: 50%;
          animation: os-spin .65s linear infinite;
        }
        .os-spin--white {
          border-color: rgba(255,255,255,.3);
          border-top-color: #fff;
          margin-right: 8px;
        }
        @keyframes os-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
