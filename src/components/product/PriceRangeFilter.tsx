'use client'

// Price range filter — dual-handle slider. Navigates (via buildProductsUrl)
// only on release (mouseup/touchend), not on every drag-frame, so dragging
// doesn't spam the router with a full navigation per pixel. Local state
// drives the visual thumb/track position while dragging for instant feedback.

import { useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { buildProductsUrl, type ProductsUrlState } from '@/lib/buildProductsUrl'
import { formatPrice } from '@/lib/utils'

interface Props {
  bounds:    { min: number; max: number }
  current:   { min: number; max: number }
  urlState:  ProductsUrlState
  basePath?: string
}

// NOTE: callers must pass `key={`${current.min}-${current.max}`}` (or similar)
// so that when the URL's price params change from elsewhere (e.g. "Clear
// all", or the mobile drawer applying a different range), React remounts
// this component with fresh initial state instead of needing a
// synchronizing effect to push new props into local state — calling
// setState directly inside an effect causes an extra cascading render on
// every prop change, which the key-remount approach avoids entirely.
export default function PriceRangeFilter({ bounds, current, urlState, basePath = '/products' }: Props) {
  const router = useRouter()
  const [minVal, setMinVal] = useState(current.min)
  const [maxVal, setMaxVal] = useState(current.max)

  const span = Math.max(1, bounds.max - bounds.min)
  const leftPct  = ((minVal - bounds.min) / span) * 100
  const rightPct = ((maxVal - bounds.min) / span) * 100

  // BUG FIX (Issue 6.6): onKeyUp fired for EVERY key, so tabbing across the
  // slider pushed a navigation with no change. Only commit on the keys that
  // actually move a range input, and never when nothing changed.
  const COMMIT_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']
  function commitOnKey(e: KeyboardEvent<HTMLInputElement>) {
    if (COMMIT_KEYS.includes(e.key)) commit(minVal, maxVal)
  }

  function commit(nextMin: number, nextMax: number) {
    if (nextMin === current.min && nextMax === current.max) return
    const url = buildProductsUrl(urlState, {
      minPrice: nextMin > bounds.min ? String(nextMin) : undefined,
      maxPrice: nextMax < bounds.max ? String(nextMax) : undefined,
    }, basePath)
    router.push(url, { scroll: false })
  }

  if (bounds.max <= bounds.min) return null

  return (
    <div className="prf-root">
      <div className="prf-values">
        <span>{formatPrice(minVal)}</span>
        <span>{formatPrice(maxVal)}</span>
      </div>
      <div className="prf-track-wrap">
        <div className="prf-track" />
        <div className="prf-track-active" style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }} />
        <input
          type="range"
          min={bounds.min}
          max={bounds.max}
          value={minVal}
          aria-label="Minimum price"
          onChange={e => setMinVal(Math.min(Number(e.target.value), maxVal - 1))}
          onMouseUp={() => commit(minVal, maxVal)}
          onTouchEnd={() => commit(minVal, maxVal)}
          onKeyUp={commitOnKey}
          className="prf-input prf-input-min"
        />
        <input
          type="range"
          min={bounds.min}
          max={bounds.max}
          value={maxVal}
          aria-label="Maximum price"
          onChange={e => setMaxVal(Math.max(Number(e.target.value), minVal + 1))}
          onMouseUp={() => commit(minVal, maxVal)}
          onTouchEnd={() => commit(minVal, maxVal)}
          onKeyUp={commitOnKey}
          className="prf-input prf-input-max"
        />
      </div>

      <style>{`
        .prf-root { padding: 2px 4px 4px; }
        .prf-values {
          display: flex; justify-content: space-between; font-size: 12px;
          font-weight: 700; color: #1a3a1e; margin-bottom: 12px;
        }
        .prf-track-wrap { position: relative; height: 20px; }
        .prf-track {
          position: absolute; top: 9px; left: 0; right: 0; height: 3px;
          background: #e5ddd0; border-radius: 3px;
        }
        .prf-track-active {
          position: absolute; top: 9px; height: 3px;
          background: #1a3a1e; border-radius: 3px;
        }
        .prf-input {
          position: absolute; top: 0; left: 0; width: 100%; margin: 0;
          -webkit-appearance: none; appearance: none; background: transparent;
          pointer-events: none; height: 20px;
        }
        .prf-input::-webkit-slider-thumb {
          -webkit-appearance: none; pointer-events: auto;
          width: 16px; height: 16px; border-radius: 50%;
          background: #fff; border: 2.5px solid #1a3a1e; cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,.2); margin-top: 2px;
        }
        .prf-input::-moz-range-thumb {
          pointer-events: auto; width: 16px; height: 16px; border-radius: 50%;
          background: #fff; border: 2.5px solid #1a3a1e; cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,.2);
        }
        .prf-input::-webkit-slider-runnable-track { background: transparent; }
        .prf-input::-moz-range-track { background: transparent; }
      `}</style>
    </div>
  )
}
