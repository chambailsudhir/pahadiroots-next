'use client'

import { memo } from 'react'
import Image from 'next/image'
import { formatPrice } from '@/lib/utils'
import type { UpsellItem } from '@/types'

interface Props {
  items: UpsellItem[]
  loading: boolean
  error?: boolean
  addedIds: string[]
  remainingForFreeShip: number
  isFreeShipping: boolean
  freeShipMin: number
  onAdd: (item: UpsellItem) => void
}

// Shimmer skeleton for individual upsell card
function UpsellShimmer() {
  return (
    <div className="us-shimmer">
      <div className="us-sh-img" />
      <div className="us-sh-body">
        <div className="us-sh-line short" />
        <div className="us-sh-line" />
        <div className="us-sh-line medium" />
      </div>
      <div className="us-sh-btn" />
    </div>
  )
}

const UpsellSection = memo(function UpsellSection({
  items, loading, error, addedIds, remainingForFreeShip,
  isFreeShipping, freeShipMin, onAdd,
}: Props) {
  return (
    <div className="us-card">
      <div className="us-head">
        <h2 className="us-title">🛍 Customers Also Buy</h2>
        <span className="us-sub">
          {freeShipMin > 0 && !isFreeShipping
            ? `Add ${formatPrice(remainingForFreeShip)} more for free shipping`
            : 'Top picks for you'}
        </span>
      </div>

      <div className="us-grid">
        {loading
          ? [0,1,2,3].map(i => <UpsellShimmer key={i} />)
          : error
            ? <p style={{ fontSize:'13px', color:'var(--color-text-secondary)', padding:'8px 0', gridColumn:'1/-1' }}>
                Couldn&apos;t load suggestions right now.
              </p>
            : items.slice(0,4).map(p => (
              <div key={p.id} className={`us-item${addedIds.includes(p.id) ? ' added' : ''}`}>
                <div className="us-img-wrap">
                  {p.image
                    ? <Image src={p.image} alt={p.name} fill sizes="50px"
                        style={{ objectFit:'cover', borderRadius:'8px' }} />
                    : <span style={{ fontSize:'26px' }}>{p.emoji || '🌿'}</span>}
                </div>
                <div className="us-info">
                  {p.badge && <div className="us-badge">{p.badge}</div>}
                  <div className="us-name">{p.name}</div>
                  <div className="us-size">{p.size}</div>
                  <div className="us-price-row">
                    {p.mrp > p.price && <span className="us-mrp">{formatPrice(p.mrp)}</span>}
                    <span className="us-price">{formatPrice(p.price)}</span>
                  </div>
                </div>
                <button
                  className={`us-btn${addedIds.includes(p.id) ? ' added' : ''}`}
                  onClick={() => onAdd(p)}
                  aria-label={`Add ${p.name} to cart`}
                  disabled={addedIds.includes(p.id)}
                >
                  {addedIds.includes(p.id) ? '✓' : '+ Add'}
                </button>
              </div>
            ))}
      </div>

      <style>{`
        @keyframes us-pulse{0%,100%{opacity:1}50%{opacity:.45}}
        @media(prefers-reduced-motion:no-preference){
          @keyframes us-shimmer-slide{
            0%{background-position:-200px 0}
            100%{background-position:calc(200px + 100%) 0}
          }
          .us-sh-img,.us-sh-line,.us-sh-btn{
            animation:us-shimmer-slide 1.4s ease-in-out infinite;
          }
        }
        /* Fallback static shimmer background for reduced-motion users */
        .us-sh-img,.us-sh-line,.us-sh-btn{
          background:#e8e2d8;background-size:400px 100%;
        }
        @media(prefers-reduced-motion:no-preference){
          .us-sh-img,.us-sh-line,.us-sh-btn{
            background:linear-gradient(90deg,#e8e2d8 25%,#f0ebe0 50%,#e8e2d8 75%);
          }
        }
        .us-card{background:#fff;border-radius:14px;
          box-shadow:0 2px 8px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.03);
          border:1px solid #e2dbd0;overflow:hidden;}
        .us-head{padding:16px 20px 12px;border-bottom:1px solid #ede8df;
          display:flex;align-items:center;justify-content:space-between;}
        .us-title{font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:16px;font-weight:700;color:#1a1a1a;margin:0;}
        .us-sub{font-size:12px;color:#7a7565;}
        .us-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px 20px;}
        @media(max-width:540px){.us-grid{grid-template-columns:1fr;}}
        /* Real item */
        .us-item{display:flex;gap:10px;align-items:center;border:1px solid #e2dbd0;
          border-radius:12px;padding:10px;background:#f5f0e8;
          transition:all .2s;opacity:1;}
        .us-item:hover{border-color:#1a3a1e;background:#f0f7f1;
          transform:translateY(-1px);box-shadow:0 3px 10px rgba(0,0,0,.07);}
        .us-item.added{opacity:.7;}
        .us-img-wrap{width:50px;height:50px;border-radius:8px;overflow:hidden;
          background:#e8e2d8;position:relative;display:flex;align-items:center;
          justify-content:center;flex-shrink:0;}
        .us-info{flex:1;min-width:0;}
        .us-badge{font-size:10px;font-weight:700;color:#c8920a;
          text-transform:uppercase;letter-spacing:.5px;}
        .us-name{font-size:13px;font-weight:700;color:#1a1a1a;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .us-size{font-size:11px;color:#7a7565;}
        .us-price-row{display:flex;align-items:center;gap:5px;margin-top:1px;}
        .us-mrp{font-size:10px;color:#bbb;text-decoration:line-through;}
        .us-price{font-size:13px;font-weight:700;color:#1a3a1e;}
        .us-btn{
          background:#1a3a1e;color:#fff;border:none;
          font-size:12px;font-weight:700;padding:6px 10px;border-radius:8px;
          cursor:pointer;white-space:nowrap;transition:all .2s;
          flex-shrink:0;font-family:inherit;
        }
        .us-btn:hover:not(:disabled){background:#2d5233;}
        .us-btn.added{background:#2d6a4f;cursor:default;}
        .us-btn:disabled{cursor:default;}
        /* Shimmer */
        .us-shimmer{display:flex;gap:10px;align-items:center;border:1px solid #e2dbd0;
          border-radius:12px;padding:10px;background:#f5f0e8;}
        .us-sh-img{width:50px;height:50px;border-radius:8px;flex-shrink:0;}
        .us-sh-body{flex:1;display:flex;flex-direction:column;gap:6px;}
        .us-sh-line{height:11px;border-radius:5px;width:100%;}
        .us-sh-line.short{width:40%;}
        .us-sh-line.medium{width:55%;}
        .us-sh-btn{width:52px;height:32px;border-radius:8px;flex-shrink:0;}
      `}</style>
    </div>
  )
})

export default UpsellSection
