'use client'
import { memo } from 'react'
import { formatPrice } from '@/lib/utils'
// BUG FIX: styles extracted from the inline <style>{`…`}</style> block that
// previously lived inside the JSX return.  An inline <style> tag re-creates
// and re-parses its CSS on every render of the component, bypassing the
// browser's stylesheet cache and forcing a full style recalc even when
// React.memo has determined the props haven't changed.  ~1 764 chars of CSS
// were being re-parsed on every qty +/- tap and every cart update that flows
// through CheckoutClient or any other surface that renders ShippingProgress.
// Extracting to a static .css file means the browser parses it exactly once
// and caches it; Next.js can also inline/chunk it with the checkout CSS.
// See ShippingProgress.css for the full fix commentary.
import './ShippingProgress.css'

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

  const pct    = Math.min(100, (progressBase / freeShipMin) * 100)
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
         * The inner fill div is purely visual — aria-hidden on it.
         *
         * BUG FIX (overflow): the old sp-track had overflow:visible so the 8 px thumb
         * could protrude above the 3 px track bar.  overflow:visible on a
         * role="progressbar" element breaks iOS/Safari layout containment and prevents
         * the browser from correctly clipping the fill to the element boundary.
         * The thumb has been moved OUTSIDE the progressbar div (rendered as a sibling
         * of .sp-track inside .sp-bar) so overflow can safely be hidden.
         */
        <>
          <div
            className="sp-track"
            role="progressbar"
            aria-label="Free shipping progress"
            aria-valuenow={pctInt}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="sp-fill" style={{ width: `${pct}%` }} aria-hidden="true" />
          </div>
          {/* Thumb lives outside the progressbar so .sp-track can use overflow:hidden
              without clipping it.  purely decorative — aria-hidden. */}
          <div
            className="sp-thumb"
            style={{ left: `${pct}%` }}
            aria-hidden="true"
          />
        </>
      )}
    </div>
  )
})

export default ShippingProgress
