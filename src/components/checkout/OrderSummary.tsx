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

  const savingsBadge    = pricing.discount + pricing.prepaidDiscount
  const prepaidPct      = parseInt(settings.prepaid_discount_pct || '5')
  const loyaltyEnabled  = settings.loyalty_enabled === 'true'
  const loyaltyRate     = parseFloat(settings.loyalty_points_per_rupee || '0.1')
  const loyaltyLabel    = settings.loyalty_points_label || 'reward points'
  const loyaltyPts      = loyaltyEnabled ? Math.floor(pricing.total * loyaltyRate) : 0

  const now       = new Date()
  const istHour   = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) / 60 % 24
  const sameDay   = istHour < 14
  const minDays   = (sameDay ? 0 : 1) + 3
  const maxDays   = (sameDay ? 0 : 1) + 5
  const etaMin    = new Date(now); etaMin.setDate(now.getDate() + minDays)
  const etaMax    = new Date(now); etaMax.setDate(now.getDate() + maxDays)
  const fmt       = (d: Date) => d.toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short' })
  const etaText   = `${fmt(etaMin)} – ${fmt(etaMax)}`

  return (
    <div className="os-wrap">

      {/* Header */}
      <div className="os-header">
        <button className="os-toggle" onClick={onToggleSummary} aria-expanded={summaryOpen} type="button">
          <span className="os-header-title">Order Summary</span>
          <span className="os-header-right">
            <span className="os-item-count">{items.length} item{items.length > 1 ? 's' : ''}</span>
            <span className="os-chevron">{summaryOpen ? '▲' : '▼'}</span>
          </span>
        </button>
      </div>

      <div className={`os-body${summaryOpen ? ' open' : ''}`}>

        {/* Items list */}
        <div className="os-items">
          {items.map((item: any) => (
            <div key={item.variantId} className="os-item">
              <div className="os-img-wrap">
                <div className="os-img">
                  {item.image
                    ? <Image src={item.image} alt={item.name} fill sizes="56px"
                        style={{ objectFit:'cover', borderRadius:'10px' }} />
                    : <span style={{ fontSize:'24px' }}>{item.emoji || '🌿'}</span>}
                </div>
                <span className="os-qty-badge">{item.qty}</span>
              </div>
              <div className="os-info">
                <div className="os-name">{item.name}</div>
                {item.size && <div className="os-size">{item.size}</div>}
              </div>
              <div className="os-price">{formatPrice(item.price * item.qty)}</div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="os-divider" />

        {/* Coupon section */}
        <div className="os-section">
          {coupon ? (
            <div className="os-coupon-applied">
              <div className="os-coupon-left">
                <span className="os-coupon-tag">🎉</span>
                <div>
                  <div className="os-coupon-code">{coupon.code}</div>
                  <div className="os-coupon-saving">Saving {formatPrice(coupon.discount)}</div>
                </div>
              </div>
              <button className="os-coupon-rm" onClick={onRemoveCoupon} type="button" aria-label="Remove coupon">✕</button>
            </div>
          ) : (
            <>
              <div className="os-coupon-row">
                <input className="os-coupon-input" type="text"
                  value={couponCode}
                  onChange={e => onCouponCodeChange(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && onApplyCoupon()}
                  placeholder="Coupon code"
                  aria-label="Coupon code"
                />
                <button className="os-coupon-btn" onClick={onApplyCoupon} disabled={couponLoading} type="button">
                  {couponLoading ? '…' : 'Apply'}
                </button>
              </div>
              {couponError && <p className="os-coupon-err" role="alert">⚠ {couponError}</p>}
              {couponHints.length > 0 && (
                <div className="os-hints">
                  <button className="os-hints-toggle" type="button" onClick={() => setShowHints(v => !v)}>
                    🎟 {showHints ? 'Hide' : 'View'} available offers
                  </button>
                  {showHints && (
                    <div className="os-hints-list">
                      {couponHints.map(h => (
                        <button key={h.code} className="os-hint-chip" type="button"
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

        {/* Divider */}
        <div className="os-divider" />

        {/* Price breakdown */}
        <div className="os-section os-prices">
          <div className="os-pr-row">
            <span>Subtotal</span>
            <span>{formatPrice(pricing.subtotal)}</span>
          </div>
          {coupon && pricing.discount > 0 && (
            <div className="os-pr-row os-g">
              <span>Coupon ({coupon.code})</span>
              <span>−{formatPrice(pricing.discount)}</span>
            </div>
          )}
          {pricing.prepaidDiscount > 0 && (
            <div className="os-pr-row os-g">
              <span>Prepaid discount ({prepaidPct}%)</span>
              <span>−{formatPrice(pricing.prepaidDiscount)}</span>
            </div>
          )}
          <div className="os-pr-row">
            <span>Shipping</span>
            <span className={pricing.isFreeShipping ? 'os-free' : ''}>
              {pricing.isFreeShipping ? '🚚 FREE' : formatPrice(pricing.shipping)}
            </span>
          </div>
          {pricing.gstTotal > 0 && (
            <div className="os-pr-row os-muted">
              <span>GST (inclusive)</span>
              <span>₹{pricing.gstTotal}</span>
            </div>
          )}

          <div className="os-total-row">
            <span>Total</span>
            <span className="os-total-amount">{formatPrice(pricing.total)}</span>
          </div>

          {savingsBadge > 0 && (
            <div className="os-save-pill">
              <span>🏷</span> You're saving {formatPrice(savingsBadge)} on this order!
            </div>
          )}
          {loyaltyEnabled && loyaltyPts > 0 && (
            <div className="os-loyalty-pill">
              ⭐ Earn <strong>{loyaltyPts} {loyaltyLabel}</strong> on this order
            </div>
          )}
        </div>
      </div>

      {/* Errors */}
      {belowMinOrder && (
        <div className="os-section">
          <div className="os-error" role="alert">
            🛒 Minimum order is {formatPrice(minOrderAmt)}. Add <strong>{formatPrice(minOrderAmt - pricing.subtotal)}</strong> more.
          </div>
        </div>
      )}
      {error && (
        <div className="os-section">
          <div className="os-error" role="alert">⚠ {error}</div>
        </div>
      )}

      {/* CTA button */}
      <div className="os-cta-wrap">
        <button className="os-cta" onClick={onPlaceOrder}
          disabled={placing || bothPaymentsOff || belowMinOrder}
          type="button" aria-busy={placing}>
          {placing ? (
            <span className="os-cta-inner">
              <span className="os-cta-spinner" />
              <span>Placing Order…</span>
            </span>
          ) : payMethod === 'razorpay' ? (
            <span className="os-cta-inner">
              <span>⚡ Pay Securely</span>
              <span className="os-cta-amt">{formatPrice(pricing.total)}</span>
            </span>
          ) : (
            <span className="os-cta-inner">
              <span>🛒 Place COD Order</span>
              <span className="os-cta-amt">{formatPrice(pricing.total)}</span>
            </span>
          )}
        </button>

        <div className="os-secure">
          <span>🔒</span> 100% Secure &amp; Encrypted Checkout
        </div>
      </div>

      {/* ETA strip */}
      <div className="os-eta">
        <div className="os-eta-icon">🚚</div>
        <div>
          <div className="os-eta-main">Delivery by <strong>{etaText}</strong></div>
          <div className="os-eta-sub">
            {sameDay ? '· Order now for today\'s dispatch!' : '· Order now for tomorrow\'s dispatch'}
          </div>
        </div>
      </div>

      <style>{`
        /* ── Wrapper ── */
        .os-wrap {
          display: flex;
          flex-direction: column;
        }

        /* ── Header ── */
        .os-header {
          padding: 18px 22px 16px;
          border-bottom: 1px solid #f0ebe2;
          background: linear-gradient(to bottom, #faf8f4, #fff);
        }
        .os-toggle {
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
        .os-header-title {
          font-size: 15px;
          font-weight: 700;
          color: #1a1a1a;
          font-family: var(--font-playfair, 'Playfair Display', Georgia, serif);
          letter-spacing: -0.1px;
        }
        .os-header-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .os-item-count {
          font-size: 11px;
          font-weight: 600;
          color: #9a9180;
          background: #f0ebe2;
          padding: 3px 8px;
          border-radius: 20px;
        }
        .os-chevron {
          font-size: 10px;
          color: #9a9180;
        }

        /* ── Body ── */
        .os-body { display: block; }
        @media (max-width: 900px) {
          .os-body { display: none; }
          .os-body.open { display: block; }
        }

        /* ── Sections & dividers ── */
        .os-section { padding: 16px 22px; }
        .os-divider { height: 1px; background: #f0ebe2; }

        /* ── Items ── */
        .os-items {
          padding: 16px 22px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .os-item {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .os-img-wrap {
          position: relative;
          flex-shrink: 0;
        }
        .os-img {
          width: 56px;
          height: 56px;
          border-radius: 10px;
          overflow: hidden;
          background: #f5f0e8;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid #ede8df;
        }
        .os-qty-badge {
          position: absolute;
          top: -5px;
          right: -5px;
          width: 19px;
          height: 19px;
          background: #1a3a1e;
          color: #fff;
          border-radius: 50%;
          font-size: 10px;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 4px rgba(0,0,0,.2);
        }
        .os-info { flex: 1; min-width: 0; }
        .os-name {
          font-size: 13px;
          font-weight: 700;
          color: #1a1a1a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: inherit;
          letter-spacing: -0.1px;
        }
        .os-size { font-size: 11px; color: #9a9180; margin-top: 2px; }
        .os-price {
          font-size: 14px;
          font-weight: 700;
          color: #1a1a1a;
          white-space: nowrap;
        }

        /* ── Coupon ── */
        .os-coupon-row { display: flex; gap: 8px; }
        .os-coupon-input {
          flex: 1;
          border: 1.5px solid #e2dbd0;
          border-radius: 10px;
          padding: 10px 13px;
          font-size: 13px;
          font-weight: 600;
          outline: none;
          transition: border-color .2s, box-shadow .2s;
          min-width: 0;
          font-family: inherit;
          background: #faf8f5;
          letter-spacing: 1px;
        }
        .os-coupon-input:focus {
          border-color: #1a3a1e;
          box-shadow: 0 0 0 3px rgba(26,58,30,.08);
          background: #fff;
        }
        .os-coupon-btn {
          background: #1a3a1e;
          color: #fff;
          border: none;
          padding: 10px 16px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          font-family: inherit;
          transition: background .2s, transform .15s;
          letter-spacing: 0.3px;
        }
        .os-coupon-btn:hover:not(:disabled) { background: #2d5233; transform: translateY(-1px); }
        .os-coupon-btn:disabled { opacity: .6; cursor: not-allowed; }
        .os-coupon-applied {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: linear-gradient(to right, #e8f5e9, #f0faf0);
          border: 1.5px solid #b8e0c0;
          border-radius: 12px;
          padding: 11px 14px;
          gap: 8px;
        }
        .os-coupon-left { display: flex; align-items: center; gap: 10px; }
        .os-coupon-tag { font-size: 18px; }
        .os-coupon-code { font-size: 13px; font-weight: 800; color: #1a3a1e; letter-spacing: 0.5px; }
        .os-coupon-saving { font-size: 11px; color: #2d6a4f; margin-top: 1px; font-weight: 600; }
        .os-coupon-rm {
          background: rgba(0,0,0,.06);
          border: none;
          color: #555;
          font-size: 13px;
          cursor: pointer;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: background .15s;
        }
        .os-coupon-rm:hover { background: rgba(0,0,0,.12); }
        .os-coupon-err { font-size: 11px; color: #c0392b; margin-top: 6px; }
        .os-hints { margin-top: 10px; }
        .os-hints-toggle {
          background: none;
          border: none;
          font-size: 12px;
          color: #1a3a1e;
          font-weight: 700;
          cursor: pointer;
          padding: 0;
          font-family: inherit;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .os-hints-list { display: flex; flex-direction: column; gap: 7px; margin-top: 10px; }
        .os-hint-chip {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #faf8f5;
          border: 1.5px dashed #d8d0c4;
          border-radius: 10px;
          padding: 9px 13px;
          cursor: pointer;
          transition: all .15s;
          text-align: left;
          font-family: inherit;
          width: 100%;
        }
        .os-hint-chip:hover { border-color: #1a3a1e; background: #e8f5e9; }
        .os-hint-code { font-size: 12px; font-weight: 800; color: #1a3a1e; letter-spacing: 0.5px; }
        .os-hint-label { font-size: 11px; color: #9a9180; }

        /* ── Prices ── */
        .os-prices { display: flex; flex-direction: column; gap: 10px; }
        .os-pr-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
          color: #7a7565;
        }
        .os-g { color: #2d6a4f; font-weight: 700; }
        .os-free { color: #2d6a4f; font-weight: 700; }
        .os-muted { font-size: 11px; color: #b8b0a5; }

        .os-total-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 12px;
          border-top: 2px solid #f0ebe2;
          margin-top: 4px;
        }
        .os-total-row > span:first-child {
          font-size: 16px;
          font-weight: 700;
          color: #1a1a1a;
          font-family: var(--font-playfair, 'Playfair Display', Georgia, serif);
        }
        .os-total-amount {
          font-size: 24px;
          font-weight: 800;
          color: #1a1a1a;
          letter-spacing: -0.5px;
        }
        .os-save-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          background: linear-gradient(to right, #e8f5e9, #f0faf0);
          border: 1px solid #b8e0c0;
          border-radius: 10px;
          padding: 9px 13px;
          font-size: 12px;
          font-weight: 700;
          color: #2d6a4f;
        }
        .os-loyalty-pill {
          background: linear-gradient(to right, #fdf6e3, #fefaf0);
          border: 1px solid #e8d580;
          border-radius: 10px;
          padding: 9px 13px;
          font-size: 12px;
          color: #7a5a00;
        }

        /* ── Errors ── */
        .os-error {
          background: #fdecea;
          border: 1px solid #f5c6cb;
          border-radius: 12px;
          padding: 11px 14px;
          font-size: 13px;
          color: #c0392b;
          font-weight: 600;
        }

        /* ── CTA ── */
        .os-cta-wrap {
          padding: 16px 22px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .os-cta {
          width: 100%;
          padding: 16px 20px;
          background: linear-gradient(135deg, #1a3a1e 0%, #2d5233 60%, #3a6b42 100%);
          color: #fff;
          border: none;
          border-radius: 14px;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          box-shadow: 0 6px 20px rgba(26,58,30,.36);
          transition: all .25s cubic-bezier(.4,0,.2,1);
          letter-spacing: 0.1px;
        }
        .os-cta:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 12px 32px rgba(26,58,30,.44);
        }
        .os-cta:active:not(:disabled) { transform: translateY(0); }
        .os-cta:disabled { opacity: .55; cursor: not-allowed; transform: none; box-shadow: none; }
        .os-cta-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
        }
        .os-cta-amt {
          background: rgba(255,255,255,.18);
          padding: 5px 13px;
          border-radius: 20px;
          font-size: 15px;
          font-weight: 800;
          border: 1px solid rgba(255,255,255,.15);
        }
        .os-cta-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255,255,255,.4);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin .7s linear infinite;
          display: inline-block;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .os-secure {
          text-align: center;
          font-size: 11px;
          color: #9a9180;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
        }

        /* ── ETA strip ── */
        .os-eta {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin: 0 22px 20px;
          background: linear-gradient(to right, #f5f0e8, #faf8f4);
          border: 1px solid #e8e2d8;
          padding: 12px 14px;
          border-radius: 12px;
        }
        .os-eta-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
        .os-eta-main { font-size: 12px; color: #4a4540; font-weight: 600; line-height: 1.5; }
        .os-eta-sub  { font-size: 11px; color: #9a9180; margin-top: 2px; }
      `}</style>
    </div>
  )
}
