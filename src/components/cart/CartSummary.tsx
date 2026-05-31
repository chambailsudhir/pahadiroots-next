'use client'

import Link from 'next/link'
import { memo } from 'react'
import { formatPrice } from '@/lib/utils'
import type { CartItem, AppliedCoupon } from '@/types'
import type { PriceSummary } from '@/lib/services/pricingService'

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
  minOrderAmt?: number
}

const CartSummary = memo(function CartSummary({
  items, totalQty, pricing, coupon,
  onApplyCoupon, onRemoveCoupon,
  couponCode, onCouponCodeChange,
  couponLoading, couponError,
  minOrderAmt = 0,
}: Props) {
  const belowMinOrder = minOrderAmt > 0 && pricing.subtotal < minOrderAmt

  return (
    <div className="cs-wrap">
      {/* Coupon */}
      <div className="cs-coupon">
        <div className="cs-coupon-head">🏷️ Have a coupon code?</div>
        <div className="cs-coupon-body">
        {coupon ? (
          <div className="cs-coupon-applied">
            <span>🎉 <strong>{coupon.code}</strong> — saving {formatPrice(coupon.discount)}</span>
            <button className="cs-coupon-rm" onClick={onRemoveCoupon} aria-label="Remove coupon">✕</button>
          </div>
        ) : (
          <div className="cs-coupon-row">
            <input
              type="text" value={couponCode}
              onChange={e => onCouponCodeChange(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && onApplyCoupon()}
              placeholder="e.g. WELCOME50"
              className="cs-coupon-input"
              aria-label="Coupon code"
              autoCapitalize="characters"
            />
            <button className="cs-coupon-btn" onClick={onApplyCoupon}
              disabled={couponLoading} type="button">
              {couponLoading
                ? <><span className="cs-spinner" aria-hidden="true" />Applying…</>
                : 'Apply'}
            </button>
          </div>
        )}
        {/* Aria-live region for coupon status — single announcement point, no double-fire */}
        <div aria-live="polite" aria-atomic="true" className="cs-coupon-live">
          {couponError && <span className="cs-coupon-err">⚠ {couponError}</span>}
        </div>
        </div>
      </div>

      {/* Price breakdown */}
      <div className="cs-prices">
        <div className="cs-row">
          <span>Subtotal ({totalQty} item{totalQty > 1 ? 's' : ''})</span>
          <span>{formatPrice(pricing.subtotal)}</span>
        </div>
        {coupon && pricing.discount > 0 && (
          <div className="cs-row green">
            <span>Coupon ({coupon.code})</span>
            <span>−{formatPrice(pricing.discount)}</span>
          </div>
        )}
        <div className="cs-row">
          <span>Shipping</span>
          <span className={pricing.isFreeShipping ? 'free' : ''}>
            {pricing.isFreeShipping ? '🚚 FREE' : formatPrice(pricing.shipping)}
          </span>
        </div>
        <div className="cs-divider" />
        <div className="cs-total">
          <span>Total</span>
          <span>{formatPrice(pricing.total)}</span>
        </div>
        {pricing.gstTotal > 0 && (
          <div className="cs-gst-note">* Prices include GST</div>
        )}
        {pricing.discount > 0 && (
          <div className="cs-save-pill">🎉 Saving {formatPrice(pricing.discount)} on this order!</div>
        )}
      </div>

      {/* Min order warning */}
      {belowMinOrder && (
        <div className="cs-min-warn" role="alert">
          ⚠ Minimum order is {formatPrice(minOrderAmt)}. Add{' '}
          <strong>{formatPrice(minOrderAmt - pricing.subtotal)}</strong> more to checkout.
        </div>
      )}

      {/* CTA */}
      {belowMinOrder ? (
        <div className="cs-cta cs-cta--disabled" aria-disabled="true">
          <span>🔒</span>
          <span>Proceed to Checkout</span>
          <span className="cs-cta-amt">{formatPrice(pricing.total)}</span>
        </div>
      ) : (
        <Link href="/checkout" className="cs-cta">
          <span>🔒</span>
          <span>Proceed to Checkout</span>
          <span className="cs-cta-amt">{formatPrice(pricing.total)}</span>
        </Link>
      )}

      <Link href="/products" className="cs-continue">← Continue Shopping</Link>

      {/* Payment trust */}
      <div className="cs-trust">
        <div className="cs-trust-row">
          <span>🔐 SSL Encrypted</span>
          <span>🏦 Razorpay</span>
          <span>✅ Secure</span>
        </div>
        <div className="cs-logos">
          {[['#6a1b9a','UPI'],['#1a1f71','VISA'],['#eb001b','MC'],
            ['#008c44','RuPay'],['#4285f4','GPay']].map(([bg,label]) => (
            <span key={label} className="cs-logo" style={{ background: bg }}>{label}</span>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes cs-spin{to{transform:rotate(360deg)}}
        .cs-wrap{padding:22px 24px;display:flex;flex-direction:column;gap:16px;}
        .cs-coupon{
          border:1px solid #e8e0d4;border-radius:14px;overflow:hidden;
          background:#fff;
          box-shadow:0 2px 12px rgba(26,22,17,.06);
        }
        .cs-coupon-head{
          font-size:13px;font-weight:700;color:#1a1611;
          display:flex;align-items:center;gap:6px;
          padding:16px 18px 14px;
          border-bottom:1px solid #ece4d8;
          background:#fff;
        }
        .cs-coupon-body{padding:16px 18px;}
        .cs-coupon-row{display:flex;gap:8px;}
        .cs-coupon-input{
          flex:1;border:1.5px solid #e0d5c0;border-radius:9px;
          padding:10px 13px;font-size:13px;font-weight:600;outline:none;
          transition:border-color .2s,box-shadow .2s;min-width:0;font-family:inherit;
          background:#fff;color:#1a1611;
          box-shadow:inset 0 1px 3px rgba(26,22,17,.06);
        }
        .cs-coupon-input::placeholder{color:#c0b8ae;font-weight:500;}
        .cs-coupon-input:focus{border-color:#c9a240;box-shadow:0 0 0 3px rgba(201,162,64,.12);}
        .cs-coupon-btn{
          background:linear-gradient(135deg,#1a3a1e,#2d5233);color:#fff;border:none;
          padding:10px 18px;border-radius:9px;font-size:13px;font-weight:700;
          cursor:pointer;transition:all .2s;white-space:nowrap;font-family:inherit;
          display:flex;align-items:center;gap:6px;letter-spacing:.2px;
          box-shadow:0 3px 10px rgba(26,58,30,.22);
        }
        .cs-coupon-btn:hover:not(:disabled){
          background:linear-gradient(135deg,#22472a,#376340);
          transform:translateY(-1px);box-shadow:0 5px 14px rgba(26,58,30,.3);
        }
        .cs-coupon-btn:active:not(:disabled){transform:translateY(0);}
        .cs-coupon-btn:disabled{opacity:.55;cursor:not-allowed;box-shadow:none;}
        .cs-spinner{
          display:inline-block;width:12px;height:12px;border-radius:50%;
          border:2px solid rgba(255,255,255,.3);border-top-color:#fff;
          animation:cs-spin .65s linear infinite;flex-shrink:0;
        }
        @media(prefers-reduced-motion:reduce){.cs-spinner{animation:none;opacity:.6;}}
        .cs-coupon-applied{
          background:linear-gradient(135deg,#eef7ee,#e6f4e6);
          border:1.5px solid #b8dab8;border-radius:10px;
          padding:11px 14px;display:flex;align-items:center;justify-content:space-between;
          font-size:13px;color:#276141;font-weight:700;gap:8px;
        }
        .cs-coupon-rm{
          background:none;border:1px solid #b8dab8;color:#276141;
          font-size:12px;cursor:pointer;padding:3px 9px;border-radius:7px;
          transition:all .15s;font-family:inherit;font-weight:700;
        }
        .cs-coupon-rm:hover{background:#d4ecd4;}
        .cs-coupon-live{min-height:0;}
        .cs-coupon-err{font-size:11px;color:#a03030;display:block;margin-top:6px;font-weight:600;}
        .cs-prices{display:flex;flex-direction:column;gap:10px;}
        .cs-row{
          display:flex;justify-content:space-between;align-items:center;
          font-size:13px;color:#7a6e5f;
        }
        .cs-row.green{color:#276141;font-weight:700;}
        .cs-row .free{color:#276141;font-weight:700;}
        .cs-gst-note{font-size:11px;color:#b8aea0;text-align:right;margin-top:-5px;}
        .cs-divider{
          position:relative;height:1px;
          background:linear-gradient(to right,transparent,#d8c9a8 20%,#d8c9a8 80%,transparent);
          margin:6px 0;
        }
        .cs-divider::after{
          content:'◆';position:absolute;left:50%;top:50%;
          transform:translate(-50%,-50%);background:#fff;
          padding:0 8px;font-size:8px;color:#c9a240;line-height:1;
        }
        .cs-total{
          display:flex;justify-content:space-between;align-items:baseline;
          font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:22px;font-weight:700;color:#1a1611;
        }
        .cs-save-pill{
          display:flex;align-items:center;justify-content:center;gap:6px;
          background:linear-gradient(135deg,#eef7ee,#e0f0e0);
          border:1px solid #b8dab8;border-radius:10px;
          padding:9px 14px;font-size:12.5px;font-weight:700;color:#276141;
          text-align:center;letter-spacing:.1px;
        }
        .cs-cta{
          display:flex;align-items:center;justify-content:space-between;
          background:linear-gradient(135deg,#1a3a1e 0%,#2a5230 50%,#1a3a1e 100%);
          background-size:200% 200%;
          color:#fff;text-decoration:none;padding:16px 20px;border-radius:14px;
          font-size:14px;font-weight:700;letter-spacing:.2px;
          box-shadow:0 5px 20px rgba(26,58,30,.36),inset 0 1px 0 rgba(255,255,255,.08);
          transition:all .32s cubic-bezier(.4,0,.2,1);
          position:relative;overflow:hidden;
        }
        .cs-cta::before{
          content:'';position:absolute;top:0;left:0;right:0;height:1px;
          background:linear-gradient(90deg,transparent,rgba(201,162,64,.6),transparent);
        }
        .cs-cta:hover{
          transform:translateY(-2px);
          box-shadow:0 14px 36px rgba(26,58,30,.46),inset 0 1px 0 rgba(255,255,255,.08);
          background-position:right center;
        }
        .cs-cta:active{transform:translateY(0);}
        .cs-cta--disabled{opacity:.45;cursor:not-allowed;pointer-events:none;box-shadow:none;transform:none;}
        .cs-cta-amt{
          background:rgba(255,255,255,.15);padding:5px 13px;
          border-radius:20px;font-size:14px;font-weight:800;
          border:1px solid rgba(255,255,255,.2);
        }
        .cs-continue{
          text-align:center;display:block;font-size:12px;color:#9a8e7e;
          text-decoration:none;transition:color .2s;letter-spacing:.2px;padding:4px 0;
        }
        .cs-continue:hover{color:#1a3a1e;}
        .cs-min-warn{
          background:linear-gradient(135deg,#fefae8,#fdf5d0);
          border:1px solid #e8d078;border-radius:11px;
          padding:11px 14px;font-size:12px;color:#6b5000;font-weight:600;line-height:1.5;
        }
        .cs-trust{border-top:1px solid #ece4d8;padding-top:14px;display:flex;flex-direction:column;gap:10px;}
        .cs-trust-row{
          display:flex;justify-content:space-around;font-size:11px;
          color:#9a8e7e;flex-wrap:wrap;gap:4px;
        }
        .cs-trust-row span{display:flex;align-items:center;gap:3px;font-weight:600;}
        .cs-logos{display:flex;gap:5px;flex-wrap:wrap;justify-content:center;}
        .cs-logo{
          font-size:9.5px;font-weight:900;padding:4px 8px;
          border-radius:6px;color:#fff;letter-spacing:.4px;
          box-shadow:0 1px 4px rgba(0,0,0,.18);
        }
      `}</style>
    </div>
  )
})

export default CartSummary
