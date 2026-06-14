'use client'
import { memo } from 'react'
import { formatPrice } from '@/lib/utils'

interface Props {
  // BUG FIX: renamed from `subtotal` → `progressBase`.
  // The progress bar must use afterDiscount (= subtotal − coupon − loyalty) to stay
  // in sync with the isFreeShipping flag, which is computed from the same value
  // inside calcPriceSummary. Using raw subtotal caused a visual contradiction:
  // after a coupon lowered afterDiscount below freeShipMin the bar could still
  // show "100%" while the text said "Add ₹X more for free shipping".
  progressBase: number
  freeShipMin: number
  isFreeShipping: boolean
  remainingForFreeShip: number
}

// PERF FIX: memo — only re-renders when shipping progress values change.
const ShippingProgress = memo(function ShippingProgress({ progressBase, freeShipMin, isFreeShipping, remainingForFreeShip }: Props) {
  if (!freeShipMin || freeShipMin <= 0) {
    return null
  }

  const pct = Math.min(100, (progressBase / freeShipMin) * 100)
  const pctInt = Math.round(pct)

  return (
    <div className={`sp-bar${isFreeShipping ? ' sp-bar--free' : ''}`}>
      <div className="sp-content">
        {/* aria-hidden on emoji — the text beside it carries all meaning */}
        <span className="sp-icon" aria-hidden="true">{isFreeShipping ? '🎉' : '🚚'}</span>
        <span className="sp-text">
          {isFreeShipping
            ? 'Free shipping unlocked!'
            : <>Add <strong>{formatPrice(remainingForFreeShip)}</strong> more for free shipping</>}
        </span>
        {!isFreeShipping && (
          <span className="sp-pct" aria-hidden="true">{pctInt}%</span>
        )}
      </div>
      {!isFreeShipping && (
        /*
         * role="progressbar" + aria-value* communicate progress semantically (WCAG 1.3.1).
         * aria-label provides context; aria-valuenow is the integer 0–100 percentage.
         * The inner fill and thumb divs are purely visual — aria-hidden on each.
         */
        <div
          className="sp-track"
          role="progressbar"
          aria-label="Free shipping progress"
          aria-valuenow={pctInt}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="sp-fill" style={{ width: `${pct}%` }} aria-hidden="true" />
          <div className="sp-thumb" style={{ left: `${pct}%` }} aria-hidden="true" />
        </div>
      )}
      <style>{`
        .sp-bar {
          background: #1C2B1E;
          padding: 9px 40px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          transition: background .3s;
        }
        .sp-bar--free { background: linear-gradient(90deg, #1C3A20, #2C5A30); }
        @media (max-width: 640px) { .sp-bar { padding: 9px 16px; } }
        .sp-content {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .sp-icon { font-size: 14px; flex-shrink: 0; }
        .sp-text {
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          color: rgba(245,240,232,.85);
          font-weight: 400;
          flex: 1;
        }
        .sp-text strong { color: #F5F0E8; font-weight: 700; }
        .sp-pct {
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          font-weight: 600;
          color: rgba(245,240,232,.6);
          flex-shrink: 0;
        }
        .sp-track {
          position: relative;
          height: 3px;
          background: rgba(255,255,255,.15);
          border-radius: 99px;
          overflow: visible;
        }
        .sp-fill {
          position: absolute;
          left: 0; top: 0; bottom: 0;
          background: linear-gradient(90deg, #7ABA6A, #A8D898);
          border-radius: 99px;
          transition: width .6s cubic-bezier(.4,0,.2,1);
        }
        .sp-thumb {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 8px;
          height: 8px;
          background: #A8D898;
          border-radius: 50%;
          box-shadow: 0 0 0 2px rgba(168,216,152,.3);
          transition: left .6s cubic-bezier(.4,0,.2,1);
        }
      `}</style>
    </div>
  )
})

export default ShippingProgress
