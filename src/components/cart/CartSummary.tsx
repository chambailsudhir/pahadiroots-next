'use client'

import Link from 'next/link'
import { memo } from 'react'
import { formatPrice } from '@/lib/utils'

interface Props {
  items: any[]
  pricing: any
  coupon: any
  onApplyCoupon: () => void
  onRemoveCoupon: () => void
  couponCode: string
  onCouponCodeChange: (v: string) => void
  couponLoading: boolean
  couponError: string
}

const CartSummary = memo(function CartSummary({
  items, pricing, coupon,
  onApplyCoupon, onRemoveCoupon,
  couponCode, onCouponCodeChange,
  couponLoading, couponError,
}: Props) {
  return (
    <div className="cs-wrap">
      {/* Coupon */}
      <div className="cs-coupon">
        <div className="cs-coupon-head">🏷 Have a coupon code?</div>
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
              {couponLoading ? '...' : 'Apply'}
            </button>
          </div>
        )}
        {couponError && <p className="cs-coupon-err" role="alert">⚠ {couponError}</p>}
      </div>

      {/* Price breakdown */}
      <div className="cs-prices">
        <div className="cs-row">
          <span>Subtotal ({items.length} item{items.length > 1 ? 's' : ''})</span>
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
        {pricing.gstTotal > 0 && (
          <div className="cs-row muted">
            <span>Tax (GST inclusive)</span>
            <span>₹{pricing.gstTotal}</span>
          </div>
        )}
        <div className="cs-divider" />
        <div className="cs-total">
          <span>Total</span>
          <span>{formatPrice(pricing.total)}</span>
        </div>
        {pricing.discount > 0 && (
          <div className="cs-save-pill">🎉 Saving {formatPrice(pricing.discount)} on this order!</div>
        )}
      </div>

      {/* CTA */}
      <Link href="/checkout" className="cs-cta">
        <span>🔒</span>
        <span>Proceed to Checkout</span>
        <span className="cs-cta-amt">{formatPrice(pricing.total)}</span>
      </Link>

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
        .cs-wrap{padding:20px 22px;display:flex;flex-direction:column;gap:14px;}
        .cs-coupon{border:1px dashed #e2dbd0;border-radius:12px;padding:13px;}
        .cs-coupon-head{font-size:12px;font-weight:700;color:#1a1a1a;margin-bottom:9px;}
        .cs-coupon-row{display:flex;gap:7px;}
        .cs-coupon-input{flex:1;border:1.5px solid #e2dbd0;border-radius:8px;
          padding:10px 12px;font-size:13px;font-weight:600;outline:none;
          transition:border-color .2s;min-width:0;font-family:inherit;}
        .cs-coupon-input:focus{border-color:#1a3a1e;}
        .cs-coupon-btn{background:#1a3a1e;color:#fff;border:none;padding:10px 16px;
          border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;
          transition:background .2s;white-space:nowrap;font-family:inherit;}
        .cs-coupon-btn:hover:not(:disabled){background:#2d5233;}
        .cs-coupon-btn:disabled{opacity:.6;cursor:not-allowed;}
        .cs-coupon-applied{background:#e8f5e9;border:1px solid #c8e6c9;border-radius:8px;
          padding:10px 12px;display:flex;align-items:center;justify-content:space-between;
          font-size:13px;color:#2d6a4f;font-weight:600;gap:8px;}
        .cs-coupon-rm{background:none;border:none;color:#888;font-size:15px;cursor:pointer;padding:0;}
        .cs-coupon-err{font-size:11px;color:#c0392b;margin-top:5px;}
        .cs-prices{display:flex;flex-direction:column;gap:9px;}
        .cs-row{display:flex;justify-content:space-between;align-items:center;
          font-size:13px;color:#7a7565;}
        .cs-row.green{color:#2d6a4f;font-weight:700;}
        .cs-row .free{color:#2d6a4f;font-weight:700;}
        .cs-row.muted{font-size:11px;color:#bbb;}
        .cs-divider{height:1px;background:#e2dbd0;margin:4px 0;}
        .cs-total{display:flex;justify-content:space-between;align-items:center;
          font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:20px;font-weight:700;color:#1a1a1a;}
        .cs-save-pill{background:#e8f5e9;border:1px solid #c8e6c9;border-radius:8px;
          padding:7px 11px;font-size:12px;font-weight:700;color:#2d6a4f;text-align:center;}
        .cs-cta{display:flex;align-items:center;justify-content:space-between;
          background:linear-gradient(135deg,#1a3a1e,#2d5233);
          color:#fff;text-decoration:none;padding:15px 18px;border-radius:13px;
          font-size:14px;font-weight:700;
          box-shadow:0 4px 16px rgba(26,58,30,.32);
          transition:all .28s cubic-bezier(.4,0,.2,1);
          position:relative;overflow:hidden;}
        .cs-cta:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(26,58,30,.45);}
        .cs-cta:active{transform:translateY(0);}
        .cs-cta-amt{background:rgba(255,255,255,.2);padding:4px 11px;
          border-radius:20px;font-size:14px;font-weight:800;}
        .cs-continue{text-align:center;display:block;font-size:12px;color:#7a7565;
          text-decoration:none;transition:color .2s;}
        .cs-continue:hover{color:#1a3a1e;}
        .cs-trust{border-top:1px solid #ede8df;padding-top:12px;}
        .cs-trust-row{display:flex;justify-content:space-between;font-size:11px;
          color:#7a7565;margin-bottom:8px;flex-wrap:wrap;gap:3px;}
        .cs-logos{display:flex;gap:5px;flex-wrap:wrap;}
        .cs-logo{font-size:10px;font-weight:800;padding:3px 7px;
          border-radius:5px;color:#fff;letter-spacing:.3px;}
      `}</style>
    </div>
  )
})

export default CartSummary
