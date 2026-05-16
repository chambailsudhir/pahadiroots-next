'use client'
import { formatPrice } from '@/lib/utils'

interface Props {
  subtotal: number
  freeShipMin: number
  isFreeShipping: boolean
  remainingForFreeShip: number
}

export default function ShippingProgress({ subtotal, freeShipMin, isFreeShipping, remainingForFreeShip }: Props) {
  if (freeShipMin <= 0) {
    return (
      <div className="sp-bar sp-bar--free">
        <span className="sp-icon">🚚</span>
        <span className="sp-text">Free shipping on all orders!</span>
      </div>
    )
  }

  const pct = Math.min(100, (subtotal / freeShipMin) * 100)

  return (
    <div className={`sp-bar${isFreeShipping ? ' sp-bar--free' : ''}`}>
      <div className="sp-content">
        <span className="sp-icon">{isFreeShipping ? '🎉' : '🚚'}</span>
        <span className="sp-text">
          {isFreeShipping
            ? 'Free shipping unlocked!'
            : <>Add <strong>{formatPrice(remainingForFreeShip)}</strong> more for free shipping</>}
        </span>
        {!isFreeShipping && (
          <span className="sp-pct">{Math.round(pct)}%</span>
        )}
      </div>
      {!isFreeShipping && (
        <div className="sp-track">
          <div className="sp-fill" style={{ width: `${pct}%` }} />
          <div className="sp-thumb" style={{ left: `${pct}%` }} />
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
}
