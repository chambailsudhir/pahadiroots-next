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
          background:rgba(255,252,248,.97);
          border-top:1px solid #e0d5c5;
          padding:10px 18px 10px;z-index:250;
          align-items:center;justify-content:space-between;gap:14px;
          box-shadow:0 -6px 28px rgba(26,22,17,.1);
          backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
        }
        /* Gold shimmer top line */
        .scc-wrap::before{
          content:'';position:absolute;top:0;left:0;right:0;height:2px;
          background:linear-gradient(90deg,transparent 5%,#c9a240 40%,#e8c060 60%,transparent 95%);
        }
        @media(max-width:960px){.scc-wrap{display:flex;}}
        .scc-total{
          font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:18px;font-weight:700;color:#1a1611;
        }
        .scc-sub{font-size:11px;color:#9a8e7e;font-weight:500;}
        .scc-btn{
          background:linear-gradient(135deg,#1a3a1e,#2d5233);
          color:#fff;text-decoration:none;padding:13px 24px;border-radius:12px;
          font-weight:700;font-size:14px;white-space:nowrap;letter-spacing:.2px;
          box-shadow:0 4px 14px rgba(26,58,30,.3);transition:all .22s;
          position:relative;overflow:hidden;
        }
        .scc-btn::before{
          content:'';position:absolute;top:0;left:0;right:0;height:1px;
          background:linear-gradient(90deg,transparent,rgba(201,162,64,.5),transparent);
        }
        .scc-btn:hover{transform:translateY(-1px);box-shadow:0 7px 20px rgba(26,58,30,.38);}
        .scc-btn--disabled{opacity:.4;cursor:not-allowed;box-shadow:none;transform:none;}
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
      <p className="ec-empty-tagline">
        "From high-altitude farms, with care."
      </p>
      <Link href="/products" className="ec-empty-btn">Browse Products →</Link>

      <style>{`
        .ec-empty{
          max-width:460px;margin:80px auto;text-align:center;padding:0 24px;
        }
        .ec-empty-icon{font-size:72px;margin-bottom:16px;filter:drop-shadow(0 4px 12px rgba(26,22,17,.15));}
        .ec-empty-title{
          font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:26px;font-weight:700;color:#1a1611;margin-bottom:10px;
          letter-spacing:.1px;
        }
        .ec-empty-sub{
          font-size:14px;color:#9a8e7e;margin-bottom:10px;line-height:1.7;
        }
        .ec-empty-tagline{
          font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:13px;font-style:italic;color:#c9a240;
          margin-bottom:28px;letter-spacing:.2px;
        }
        .ec-empty-btn{
          display:inline-block;
          background:linear-gradient(135deg,#1a3a1e,#2d5233);
          color:#fff;text-decoration:none;padding:14px 32px;border-radius:13px;
          font-weight:700;font-size:14px;letter-spacing:.2px;
          box-shadow:0 5px 18px rgba(26,58,30,.3),inset 0 1px 0 rgba(255,255,255,.07);
          transition:all .26s;position:relative;overflow:hidden;
        }
        .ec-empty-btn::before{
          content:'';position:absolute;top:0;left:0;right:0;height:1px;
          background:linear-gradient(90deg,transparent,rgba(201,162,64,.55),transparent);
        }
        .ec-empty-btn:hover{
          transform:translateY(-2px);
          box-shadow:0 10px 28px rgba(26,58,30,.38);
        }
      `}</style>
    </div>
  )
})
