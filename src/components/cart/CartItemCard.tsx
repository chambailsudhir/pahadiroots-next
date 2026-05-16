'use client'

import { memo, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { formatPrice } from '@/lib/utils'

interface CartItem {
  variantId: string
  productId: string
  name: string
  slug: string
  image: string | null
  emoji: string | null
  size: string
  price: number
  mrp: number
  gstRate: number
  qty: number
  maxQty: number
}

interface Props {
  item: CartItem
  qtyAnim: 'up' | 'down' | null
  onQtyChange: (variantId: string, newQty: number, oldQty: number) => void
  onRemove: (variantId: string, name: string, price: number) => void
}

// memo prevents re-render of all items when one qty changes
const CartItemCard = memo(function CartItemCard({ item, qtyAnim, onQtyChange, onRemove }: Props) {
  const handleRemove = useCallback(() => {
    onRemove(item.variantId, item.name, item.price)
  }, [item.variantId, item.name, item.price, onRemove])

  const handleDecr = useCallback(() => {
    onQtyChange(item.variantId, item.qty - 1, item.qty)
  }, [item.variantId, item.qty, onQtyChange])

  const handleIncr = useCallback(() => {
    onQtyChange(item.variantId, item.qty + 1, item.qty)
  }, [item.variantId, item.qty, onQtyChange])

  const hasSaving = item.mrp > 0 && item.mrp > item.price

  return (
    <div className="cic-wrap">
      {/* Product image
          unoptimized — prevents Next.js image optimizer 400s on hard-reload
          when the image CDN domain isn't in next.config remotePatterns.
          Without this, the optimizer fetches the image server-side on first
          load (works), but on hard-refresh the CDN cache is cold and the
          optimizer returns a 400, making the image disappear instantly. */}
      <div className="cic-img-wrap">
        {item.image
          ? <Image
              src={item.image}
              alt={item.name}
              fill
              sizes="120px"
              className="cic-img"
              unoptimized
              priority={false}
            />
          : <span className="cic-emoji">{item.emoji || '🌿'}</span>}
      </div>

      {/* Body */}
      <div className="cic-body">
        <div className="cic-meta">
          <Link href={`/products/${item.slug}`} className="cic-name">{item.name}</Link>
          {item.size && <span className="cic-size">{item.size}</span>}
          <div className="cic-badges">
            <span className="cic-badge org">🌿 Organic</span>
            <span className="cic-badge hml">🏔 Himalayan</span>
            {item.maxQty <= 5 && (
              <span className="cic-badge stock">⚡ Only {item.maxQty} left</span>
            )}
          </div>
        </div>

        <div className="cic-footer">
          {/* Qty stepper */}
          <div className="cic-qty" role="group" aria-label={`Quantity for ${item.name}`}>
            <button
              className="cic-qty-btn"
              onClick={handleDecr}
              aria-label="Decrease quantity"
              disabled={item.qty <= 1}
            >−</button>
            <span
              className={`cic-qty-num${qtyAnim ? ` anim-${qtyAnim}` : ''}`}
              aria-live="polite"
            >{item.qty}</span>
            <button
              className="cic-qty-btn"
              onClick={handleIncr}
              aria-label="Increase quantity"
              disabled={item.qty >= item.maxQty}
            >+</button>
          </div>

          {/* Price */}
          <div className="cic-price-col">
            {hasSaving && <span className="cic-mrp">{formatPrice(item.mrp * item.qty)}</span>}
            <span className="cic-price">{formatPrice(item.price * item.qty)}</span>
            {hasSaving && (
              <span className="cic-save">Save {formatPrice((item.mrp - item.price) * item.qty)}</span>
            )}
          </div>

          {/* Remove */}
          <button
            className="cic-remove"
            onClick={handleRemove}
            aria-label={`Remove ${item.name}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            </svg>
            Remove
          </button>
        </div>
      </div>

      <style>{`
        @keyframes cic-enter{
          from{opacity:0;transform:translateY(10px)}
          to{opacity:1;transform:translateY(0)}
        }
        @keyframes qty-up{
          0%{transform:translateY(8px);opacity:0}
          60%{transform:translateY(-2px)}
          100%{transform:translateY(0);opacity:1}
        }
        @keyframes qty-down{
          0%{transform:translateY(-8px);opacity:0}
          60%{transform:translateY(2px)}
          100%{transform:translateY(0);opacity:1}
        }
        .cic-wrap{
          display:flex;gap:16px;padding:16px 20px;
          border-bottom:1px solid #ede8df;
          transition:background .18s,transform .2s,box-shadow .2s;
          animation:cic-enter .3s ease both;
        }
        .cic-wrap:last-child{border-bottom:none;}
        .cic-wrap:hover{
          background:#f8f6f2;
          box-shadow:inset 3px 0 0 #1a3a1e;
        }
        /* position:relative required for next/image fill */
        .cic-img-wrap{
          width:120px;height:120px;flex-shrink:0;border-radius:12px;
          overflow:hidden;background:#f5f0e8;position:relative;
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 2px 8px rgba(0,0,0,.09);
          transition:box-shadow .2s;
        }
        .cic-wrap:hover .cic-img-wrap{box-shadow:0 4px 14px rgba(0,0,0,.14);}
        .cic-img{object-fit:cover;}
        .cic-emoji{font-size:46px;}
        .cic-body{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;}
        .cic-meta{display:flex;flex-direction:column;gap:3px;}
        .cic-name{
          font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:16px;font-weight:700;color:#1a1a1a;
          text-decoration:none;line-height:1.3;transition:color .2s;
        }
        .cic-name:hover{color:#1a3a1e;}
        .cic-size{font-size:12px;color:#7a7565;}
        .cic-badges{display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;}
        .cic-badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;}
        .cic-badge.org{background:#e8f5e9;color:#2d6a4f;border:1px solid #c8e6c9;}
        .cic-badge.hml{background:#e3f2fd;color:#1565c0;border:1px solid #bbdefb;}
        .cic-badge.stock{background:#fff3e0;color:#e65100;border:1px solid #ffe0b2;}
        .cic-footer{
          display:flex;align-items:center;justify-content:space-between;
          margin-top:10px;flex-wrap:wrap;gap:8px;
        }
        /* Qty stepper */
        .cic-qty{
          display:flex;align-items:center;background:#f5f0e8;
          border-radius:30px;padding:3px;border:1px solid #e2dbd0;
          box-shadow:0 1px 4px rgba(0,0,0,.06);
        }
        .cic-qty-btn{
          width:34px;height:34px;border:none;background:#fff;border-radius:50%;
          font-size:17px;font-weight:700;color:#1a3a1e;cursor:pointer;
          display:flex;align-items:center;justify-content:center;
          transition:all .18s cubic-bezier(.4,0,.2,1);
          box-shadow:0 1px 4px rgba(0,0,0,.08);line-height:1;
        }
        .cic-qty-btn:hover:not(:disabled){
          background:#1a3a1e;color:#fff;
          transform:scale(1.1);box-shadow:0 3px 10px rgba(26,58,30,.25);
        }
        .cic-qty-btn:active:not(:disabled){transform:scale(.93);}
        .cic-qty-btn:disabled{opacity:.3;cursor:not-allowed;}
        .cic-qty-num{
          width:34px;text-align:center;font-size:14px;font-weight:700;color:#1a1a1a;
        }
        .cic-qty-num.anim-up{animation:qty-up .28s cubic-bezier(.4,0,.2,1);}
        .cic-qty-num.anim-down{animation:qty-down .28s cubic-bezier(.4,0,.2,1);}
        /* Price */
        .cic-price-col{display:flex;flex-direction:column;align-items:flex-end;}
        .cic-mrp{font-size:12px;color:#bbb;text-decoration:line-through;}
        .cic-price{
          font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:18px;font-weight:700;color:#1a1a1a;
        }
        .cic-save{
          font-size:11px;font-weight:600;color:#2d6a4f;
          background:#e8f5e9;padding:2px 7px;border-radius:10px;
        }
        /* Remove */
        .cic-remove{
          display:flex;align-items:center;gap:4px;
          background:none;border:1px solid #f0d5d5;color:#c0392b;
          font-size:12px;font-weight:600;padding:6px 11px;border-radius:8px;
          cursor:pointer;transition:all .15s;font-family:inherit;
        }
        .cic-remove:hover{background:#fdecea;border-color:#c0392b;}
        @media(max-width:640px){
          .cic-wrap{flex-direction:column;}
          .cic-img-wrap{width:100%;height:160px;}
        }
      `}</style>
    </div>
  )
})

export default CartItemCard
