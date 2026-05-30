'use client'

import Link from 'next/link'
import { memo, useEffect, useRef, useState } from 'react'
import { formatPrice } from '@/lib/utils'

// ─── Sticky mobile CTA ────────────────────────────────────────────────────────
interface StickyProps {
  total: number
  totalQty: number
  minOrderAmt?: number
}

export const StickyCartCTA = memo(function StickyCartCTA({ total, totalQty, minOrderAmt = 0 }: StickyProps) {
  const belowMinOrder = minOrderAmt > 0 && total < minOrderAmt

  // Track whether the sticky bar is visually active (mobile viewport).
  // On desktop the wrapper has the `inert` attribute so neither keyboard users
  // nor screen readers can reach it — no aria-hidden needed.
  const [isMobile, setIsMobile] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 960px)')
    const update = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches)
    update(mq)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Apply inert + aria-hidden imperatively — React doesn't support them natively yet.
  // aria-hidden ensures VoiceOver on older Safari (where inert isn't fully supported)
  // doesn't announce the duplicate "Checkout" button to screen reader users on desktop.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    if (isMobile) {
      el.removeAttribute('inert')
      el.removeAttribute('aria-hidden')
    } else {
      el.setAttribute('inert', '')
      el.setAttribute('aria-hidden', 'true')
    }
  }, [isMobile])

  return (
    <div
      ref={wrapRef}
      className="scc-wrap"
    >
      <div>
        <div className="scc-total">{formatPrice(total)}</div>
        <div className="scc-sub">{totalQty} item{totalQty > 1 ? 's' : ''} · Incl. taxes</div>
      </div>
      {belowMinOrder ? (
        <span className="scc-btn scc-btn--disabled" aria-disabled="true">🔒 Checkout</span>
      ) : (
        <Link href="/checkout" className="scc-btn">🔒 Checkout</Link>
      )}

      <style>{`
        .scc-wrap{
          display:none;position:fixed;bottom:0;left:0;right:0;
          background:#fff;border-top:2px solid #e2dbd0;
          padding:10px 16px;z-index:250;
          align-items:center;justify-content:space-between;gap:12px;
          box-shadow:0 -4px 18px rgba(0,0,0,.09);
        }
        @media(max-width:960px){.scc-wrap{display:flex;}}
        .scc-total{
          font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:17px;font-weight:700;color:#1a1a1a;
        }
        .scc-sub{font-size:11px;color:#7a7565;}
        .scc-btn{
          background:linear-gradient(135deg,#1a3a1e,#2d5233);
          color:#fff;text-decoration:none;padding:12px 22px;border-radius:11px;
          font-weight:700;font-size:14px;white-space:nowrap;
          box-shadow:0 4px 10px rgba(26,58,30,.28);
          transition:all .2s;
        }
        .scc-btn:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(26,58,30,.35);}
        .scc-btn--disabled{opacity:.45;cursor:not-allowed;box-shadow:none;}
      `}</style>
    </div>
  )
})

// ─── Empty cart state ─────────────────────────────────────────────────────────
export const EmptyCart = memo(function EmptyCart() {
  return (
    <div className="ec-empty">
      <div className="ec-empty-icon">🛒</div>
      <h1 className="ec-empty-title">Your cart is empty</h1>
      <p className="ec-empty-sub">
        Discover natural Himalayan goodness crafted by mountain farmers.
      </p>
      <Link href="/products" className="ec-empty-btn">Browse Products →</Link>

      <style>{`
        .ec-empty{max-width:440px;margin:80px auto;text-align:center;padding:0 20px;}
        .ec-empty-icon{font-size:68px;margin-bottom:14px;}
        .ec-empty-title{
          font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:24px;font-weight:700;color:#1a1a1a;margin-bottom:8px;
        }
        .ec-empty-sub{font-size:14px;color:#7a7565;margin-bottom:26px;line-height:1.6;}
        .ec-empty-btn{
          display:inline-block;background:#1a3a1e;color:#fff;
          text-decoration:none;padding:12px 26px;border-radius:11px;
          font-weight:700;font-size:14px;transition:all .2s;
        }
        .ec-empty-btn:hover{background:#2d5233;transform:translateY(-1px);}
      `}</style>
    </div>
  )
})
