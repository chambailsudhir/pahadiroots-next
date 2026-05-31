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
            background:linear-gradient(90deg,#ece4d8 25%,#f5ede0 50%,#ece4d8 75%);
          }
        }
        .us-sh-img,.us-sh-line,.us-sh-btn{
          background:#ece4d8;background-size:400px 100%;
        }
        .us-card{
          background:#fff;border-radius:16px;
          box-shadow:0 2px 14px rgba(26,22,17,.07),0 0 0 1px rgba(26,22,17,.04);
          border:1px solid #e0d5c5;overflow:hidden;
        }
        .us-head{
          padding:17px 22px 13px;border-bottom:1px solid #ece4d8;
          display:flex;align-items:center;justify-content:space-between;
        }
        .us-title{
          font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:16px;font-weight:700;color:#1a1611;margin:0;letter-spacing:.1px;
        }
        .us-sub{font-size:11.5px;color:#9a8e7e;font-weight:500;}
        .us-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px;padding:16px 22px;}
        @media(max-width:540px){.us-grid{grid-template-columns:1fr;}}
        .us-item{
          display:flex;gap:10px;align-items:center;
          border:1px solid #e0d5c5;border-radius:13px;padding:11px;
          background:linear-gradient(135deg,#faf6f0,#f5ede0);
          transition:all .24s cubic-bezier(.4,0,.2,1);
        }
        .us-item:hover{
          border-color:#c9a240;background:linear-gradient(135deg,#fdf9f0,#faf3e0);
          transform:translateY(-2px);box-shadow:0 5px 16px rgba(26,22,17,.1);
        }
        .us-item.added{opacity:.65;}
        .us-img-wrap{
          width:52px;height:52px;border-radius:10px;overflow:hidden;
          background:#ede4d4;position:relative;display:flex;align-items:center;
          justify-content:center;flex-shrink:0;
          box-shadow:0 2px 6px rgba(26,22,17,.1);
        }
        .us-info{flex:1;min-width:0;}
        .us-badge{
          font-size:9.5px;font-weight:800;color:#9e7a15;
          text-transform:uppercase;letter-spacing:.6px;
        }
        .us-name{
          font-size:13px;font-weight:700;color:#1a1611;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
          line-height:1.3;margin-top:1px;
        }
        .us-size{font-size:10.5px;color:#9a8e7e;margin-top:1px;}
        .us-price-row{display:flex;align-items:center;gap:5px;margin-top:3px;}
        .us-mrp{font-size:10px;color:#c0b8ae;text-decoration:line-through;}
        .us-price{font-size:13px;font-weight:800;color:#1a3a1e;}
        .us-btn{
          background:linear-gradient(135deg,#1a3a1e,#2d5233);color:#fff;border:none;
          font-size:12px;font-weight:700;padding:7px 11px;border-radius:9px;
          cursor:pointer;white-space:nowrap;transition:all .2s;
          flex-shrink:0;font-family:inherit;letter-spacing:.15px;
          box-shadow:0 2px 8px rgba(26,58,30,.2);
        }
        .us-btn:hover:not(:disabled){
          background:linear-gradient(135deg,#22472a,#376340);
          transform:scale(1.05);box-shadow:0 4px 12px rgba(26,58,30,.3);
        }
        .us-btn.added{
          background:linear-gradient(135deg,#276141,#2d6a4f);
          cursor:default;box-shadow:none;
        }
        .us-btn:disabled{cursor:default;}
        .us-shimmer{
          display:flex;gap:10px;align-items:center;
          border:1px solid #e0d5c5;border-radius:13px;padding:11px;
          background:linear-gradient(135deg,#faf6f0,#f5ede0);
        }
        .us-sh-img{width:52px;height:52px;border-radius:10px;flex-shrink:0;}
        .us-sh-body{flex:1;display:flex;flex-direction:column;gap:7px;}
        .us-sh-line{height:11px;border-radius:5px;width:100%;}
        .us-sh-line.short{width:38%;}
        .us-sh-line.medium{width:56%;}
        .us-sh-btn{width:54px;height:34px;border-radius:9px;flex-shrink:0;}
      `}</style>
    </div>
  )
})

export default UpsellSection
