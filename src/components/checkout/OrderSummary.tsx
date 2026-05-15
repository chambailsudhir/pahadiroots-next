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

  // Dynamic delivery ETA
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
      {/* Mobile accordion toggle */}
      <button className="os-toggle" onClick={onToggleSummary}
        aria-expanded={summaryOpen} type="button">
        <span>🧾 Order Summary ({items.length} item{items.length > 1 ? 's' : ''})</span>
        <span>{summaryOpen ? '▲' : '▼'} {formatPrice(pricing.total)}</span>
      </button>

      <div className={`os-body${summaryOpen ? ' open' : ''}`}>
        {/* Items */}
        <div className="os-items">
          {items.map((item: any) => (
            <div key={item.variantId} className="os-item">
              <div className="os-img">
                {item.image
                  ? <Image src={item.image} alt={item.name} fill sizes="50px"
                      style={{ objectFit:'cover', borderRadius:'8px' }} />
                  : <span style={{ fontSize:'22px' }}>{item.emoji || '🌿'}</span>}
                <span className="os-qty">{item.qty}</span>
              </div>
              <div className="os-info">
                <div className="os-name">{item.name}</div>
                {item.size && <div className="os-size">{item.size}</div>}
              </div>
              <div className="os-price">{formatPrice(item.price * item.qty)}</div>
            </div>
          ))}
        </div>

        {/* Coupon */}
        <div className="os-coupon-wrap">
          {coupon ? (
            <div className="os-coupon-applied">
              <span>🎉 <strong>{coupon.code}</strong> — saving {formatPrice(coupon.discount)}</span>
              <button className="os-coupon-rm" onClick={onRemoveCoupon}
                type="button" aria-label="Remove coupon">✕</button>
            </div>
          ) : (
            <>
              <div className="os-coupon-row">
                <input className="os-coupon-input" type="text"
                  value={couponCode}
                  onChange={e => onCouponCodeChange(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && onApplyCoupon()}
                  placeholder="Coupon code" aria-label="Coupon code"
                />
                <button className="os-coupon-btn" onClick={onApplyCoupon}
                  disabled={couponLoading} type="button">
                  {couponLoading ? '...' : 'Apply'}
                </button>
              </div>
              {couponError && <p className="os-coupon-err" role="alert">⚠ {couponError}</p>}
              {/* Coupon hints */}
              {couponHints.length > 0 && (
                <div className="os-hints">
                  <button className="os-hints-toggle" type="button"
                    onClick={() => setShowHints(v => !v)}>
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

        {/* Price breakdown */}
        <div className="os-prices">
          <div className="os-pr-row">
            <span>Subtotal</span><span>{formatPrice(pricing.subtotal)}</span>
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
            <div className="os-pr-row os-sm">
              <span>GST (inclusive)</span><span>₹{pricing.gstTotal}</span>
            </div>
          )}
          <div className="os-pr-divider" />
          <div className="os-pr-total">
            <span>Total</span><span>{formatPrice(pricing.total)}</span>
          </div>
          {savingsBadge > 0 && (
            <div className="os-save-pill">🏷 Saving {formatPrice(savingsBadge)} on this order!</div>
          )}
          {loyaltyEnabled && loyaltyPts > 0 && (
            <div className="os-loyalty-pill">
              ⭐ Earn <strong>{loyaltyPts} {loyaltyLabel}</strong> on this order
            </div>
          )}
        </div>
      </div>

      {/* Min order warning */}
      {belowMinOrder && (
        <div className="os-error" role="alert">
          🛒 Minimum order is {formatPrice(minOrderAmt)}. Add{' '}
          <strong>{formatPrice(minOrderAmt - pricing.subtotal)}</strong> more.
        </div>
      )}

      {/* General error */}
      {error && <div className="os-error" role="alert">⚠ {error}</div>}

      {/* Place order CTA */}
      <button className="os-cta" onClick={onPlaceOrder}
        disabled={placing || bothPaymentsOff || belowMinOrder}
        type="button" aria-busy={placing}>
        {placing ? (
          <span>⏳ Placing Order…</span>
        ) : payMethod === 'razorpay' ? (
          <><span>⚡</span><span>Pay Securely</span>
            <span className="os-cta-amt">{formatPrice(pricing.total)}</span></>
        ) : (
          <><span>🛒</span><span>Place COD Order</span>
            <span className="os-cta-amt">{formatPrice(pricing.total)}</span></>
        )}
      </button>

      <div className="os-secure">🔒 100% Secure & Encrypted Checkout</div>

      <div className="os-eta">
        🚚 Delivery by <strong>{etaText}</strong>
        <div className="os-eta-sub">
          {sameDay
            ? '· Order now for today\'s dispatch!'
            : '· Order now for tomorrow\'s dispatch'}
        </div>
      </div>

      <style>{`
        .os-wrap{padding:18px 22px;display:flex;flex-direction:column;gap:13px;}
        .os-toggle{display:none;width:100%;background:none;border:none;padding:0;
          cursor:pointer;font-size:13px;font-weight:700;color:#1a1a1a;
          justify-content:space-between;align-items:center;font-family:inherit;}
        @media(max-width:960px){
          .os-toggle{display:flex;}
          .os-body{display:none;}
          .os-body.open{display:block;}
        }
        .os-items{display:flex;flex-direction:column;gap:9px;
          margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #ede8df;}
        .os-item{display:flex;align-items:center;gap:9px;}
        .os-img{width:50px;height:50px;border-radius:8px;overflow:hidden;
          background:#f5f0e8;position:relative;display:flex;align-items:center;
          justify-content:center;flex-shrink:0;}
        .os-qty{position:absolute;top:-4px;right:-4px;width:17px;height:17px;
          background:#1a3a1e;color:#fff;border-radius:50%;font-size:10px;
          font-weight:700;display:flex;align-items:center;justify-content:center;}
        .os-info{flex:1;min-width:0;}
        .os-name{font-size:13px;font-weight:700;color:#1a1a1a;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:inherit;}
        .os-size{font-size:11px;color:#7a7565;font-family:inherit;}
        .os-price{font-size:13px;font-weight:700;color:#1a1a1a;white-space:nowrap;font-family:inherit;}
        .os-coupon-wrap{margin-bottom:2px;}
        .os-coupon-row{display:flex;gap:7px;}
        .os-coupon-input{flex:1;border:1.5px solid #e2dbd0;border-radius:8px;
          padding:9px 11px;font-size:13px;font-weight:600;outline:none;
          transition:border-color .2s;min-width:0;font-family:inherit;}
        .os-coupon-input:focus{border-color:#1a3a1e;}
        .os-coupon-btn{background:#1a3a1e;color:#fff;border:none;padding:9px 14px;
          border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;
          white-space:nowrap;font-family:inherit;transition:background .2s;}
        .os-coupon-btn:hover:not(:disabled){background:#2d5233;}
        .os-coupon-btn:disabled{opacity:.6;cursor:not-allowed;}
        .os-coupon-applied{background:#e8f5e9;border:1px solid #c8e6c9;
          border-radius:8px;padding:9px 12px;display:flex;align-items:center;
          justify-content:space-between;font-size:13px;color:#2d6a4f;
          font-weight:600;gap:7px;font-family:inherit;}
        .os-coupon-rm{background:none;border:none;color:#888;font-size:15px;cursor:pointer;padding:0;}
        .os-coupon-err{font-size:11px;color:#c0392b;margin-top:3px;font-family:inherit;}
        .os-hints{margin-top:8px;}
        .os-hints-toggle{background:none;border:none;font-size:11px;color:#1a3a1e;
          font-weight:700;cursor:pointer;padding:0;font-family:inherit;
          text-decoration:underline;text-underline-offset:2px;}
        .os-hints-list{display:flex;flex-direction:column;gap:6px;margin-top:8px;}
        .os-hint-chip{display:flex;align-items:center;justify-content:space-between;
          background:#f5f0e8;border:1.5px dashed #e2dbd0;border-radius:8px;
          padding:8px 11px;cursor:pointer;transition:all .15s;
          text-align:left;font-family:inherit;width:100%;}
        .os-hint-chip:hover{border-color:#1a3a1e;background:#e8f5e9;}
        .os-hint-code{font-size:12px;font-weight:800;color:#1a3a1e;letter-spacing:.5px;}
        .os-hint-label{font-size:11px;color:#7a7565;}
        .os-prices{display:flex;flex-direction:column;gap:8px;}
        .os-pr-row{display:flex;justify-content:space-between;align-items:center;
          font-size:13px;color:#7a7565;font-family:inherit;}
        .os-g{color:#2d6a4f;font-weight:700;}
        .os-free{color:#2d6a4f;font-weight:700;}
        .os-sm{font-size:11px;color:#bbb;}
        .os-pr-divider{height:1px;background:#e2dbd0;margin:4px 0;}
        .os-pr-total{display:flex;justify-content:space-between;align-items:center;
          font-size:20px;font-weight:700;color:#1a1a1a;font-family:inherit;}
        .os-save-pill{background:#e8f5e9;border:1px solid #c8e6c9;border-radius:8px;
          padding:7px 11px;font-size:12px;font-weight:700;color:#2d6a4f;text-align:center;}
        .os-loyalty-pill{background:#fdf6e3;border:1px solid #f0d080;border-radius:8px;
          padding:7px 11px;font-size:12px;color:#7a5a00;text-align:center;}
        .os-error{background:#fdecea;border:1px solid #f5c6cb;border-radius:10px;
          padding:10px 13px;font-size:13px;color:#c0392b;font-weight:600;font-family:inherit;}
        .os-cta{width:100%;padding:15px 18px;
          background:linear-gradient(135deg,#1a3a1e,#2d5233);
          color:#fff;border:none;border-radius:13px;font-size:14px;font-weight:700;
          cursor:pointer;font-family:inherit;
          box-shadow:0 4px 14px rgba(26,58,30,.32);
          transition:all .28s cubic-bezier(.4,0,.2,1);
          display:flex;align-items:center;justify-content:space-between;
          position:relative;overflow:hidden;}
        .os-cta:hover:not(:disabled){transform:translateY(-2px);
          box-shadow:0 12px 28px rgba(26,58,30,.44);}
        .os-cta:active:not(:disabled){transform:translateY(0);}
        .os-cta:disabled{opacity:.6;cursor:not-allowed;transform:none;}
        .os-cta-amt{background:rgba(255,255,255,.2);padding:4px 11px;
          border-radius:20px;font-size:14px;font-weight:800;}
        .os-secure{text-align:center;font-size:11px;color:#7a7565;font-family:inherit;}
        .os-eta{font-size:12px;color:#7a7565;background:#f5f0e8;
          padding:9px 12px;border-radius:8px;line-height:1.5;font-family:inherit;}
        .os-eta-sub{font-size:11px;color:#9a9488;margin-top:2px;}
      `}</style>
    </div>
  )
}
