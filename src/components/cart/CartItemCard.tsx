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
  // Product badge flags — driven from DB, not hardcoded
  isOrganic:    boolean
  isHimalayan:  boolean
  isBestseller: boolean
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
      {/* Product image */}
      <div className="cic-img-wrap">
        {item.image
          ? <Image
              src={item.image}
              alt={item.name}
              fill
              sizes="(max-width:640px) 80px, 120px"
              className="cic-img"
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
            {item.isOrganic    && <span className="cic-badge org">🌿 Organic</span>}
            {item.isHimalayan  && <span className="cic-badge hml">🏔 Himalayan</span>}
            {item.isBestseller && <span className="cic-badge best">⭐ Bestseller</span>}
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

          {/* Remove — min 44×44px touch target per WCAG 2.5.5 */}
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
    </div>
  )
})

export default CartItemCard

// ─── Singleton style ──────────────────────────────────────────────────────────
// Kept as a module-level constant and rendered once in CartPage's PAGE_CSS area.
// This prevents N duplicate <style> injections when the cart has multiple items.
// The actual <style> tag is injected by the CartPage layout; CartItemCard is now
// a pure presentational component with zero side-effect style injection.
export const CART_ITEM_CARD_CSS = `
  @keyframes cic-enter{
    from{opacity:0;transform:translateY(12px)}
    to{opacity:1;transform:translateY(0)}
  }
  @media(prefers-reduced-motion:no-preference){
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
    .cic-qty-num.anim-up{animation:qty-up .28s cubic-bezier(.4,0,.2,1);}
    .cic-qty-num.anim-down{animation:qty-down .28s cubic-bezier(.4,0,.2,1);}
  }

  /* ── Item row ── */
  .cic-wrap{
    display:flex;gap:18px;padding:20px 22px;
    border-bottom:1px solid #ece4d8;
    transition:background .22s,box-shadow .22s;
    animation:cic-enter .35s cubic-bezier(.4,0,.2,1) both;
    position:relative;
  }
  .cic-wrap:last-child{border-bottom:none;}
  /* Gold left-border accent on hover — the signature luxury tell */
  .cic-wrap:hover{
    background:linear-gradient(to right,#fdf9f2,#fff);
    box-shadow:inset 3px 0 0 #c9a240;
  }

  /* ── Image ── */
  .cic-img-wrap{
    width:112px;height:112px;flex-shrink:0;border-radius:13px;
    overflow:hidden;background:#f5ede0;position:relative;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 3px 12px rgba(26,22,17,.1);
    transition:box-shadow .26s,transform .26s;
  }
  .cic-wrap:hover .cic-img-wrap{
    box-shadow:0 6px 22px rgba(26,22,17,.17);
    transform:scale(1.02);
  }
  .cic-img{object-fit:cover;}
  .cic-emoji{font-size:46px;line-height:1;}

  /* ── Body ── */
  .cic-body{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;gap:10px;}
  .cic-meta{display:flex;flex-direction:column;gap:4px;}

  .cic-name{
    font-family:var(--font-playfair,'Playfair Display',serif);
    font-size:16px;font-weight:700;color:#1a1611;
    text-decoration:none;line-height:1.35;
    transition:color .2s;letter-spacing:.08px;
  }
  .cic-name:hover{color:#1a3a1e;}

  .cic-size{
    font-size:11px;color:#9a8e7e;letter-spacing:.4px;
    text-transform:uppercase;font-weight:600;
  }

  /* ── Badges ── */
  .cic-badges{display:flex;gap:5px;flex-wrap:wrap;margin-top:2px;}
  .cic-badge{
    font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:20px;
    letter-spacing:.2px;
  }
  .cic-badge.org{background:#eef7ee;color:#276141;border:1px solid #c0dfc0;}
  .cic-badge.hml{background:#edf3fb;color:#1b5ea3;border:1px solid #bdd4ef;}
  .cic-badge.best{
    background:linear-gradient(135deg,#fdf6e3,#fef9ed);
    color:#9e7a15;border:1px solid #e8d59a;
  }
  .cic-badge.stock{background:#fef6ee;color:#c44e10;border:1px solid #f0c8a0;}

  /* ── Footer row ── */
  .cic-footer{
    display:flex;align-items:center;justify-content:space-between;
    flex-wrap:wrap;gap:10px;
  }

  /* ── Qty stepper ── */
  .cic-qty{
    display:flex;align-items:center;
    background:#f7f1e8;border-radius:99px;padding:3px;
    border:1px solid #e0d5c2;
    box-shadow:0 1px 5px rgba(26,22,17,.07),inset 0 1px 2px rgba(255,255,255,.9);
  }
  .cic-qty-btn{
    width:34px;height:34px;border:none;background:#fff;border-radius:50%;
    font-size:17px;font-weight:700;color:#1a3a1e;cursor:pointer;
    display:flex;align-items:center;justify-content:center;
    transition:all .2s cubic-bezier(.4,0,.2,1);
    box-shadow:0 1px 4px rgba(26,22,17,.1);line-height:1;
  }
  .cic-qty-btn:hover:not(:disabled){
    background:linear-gradient(135deg,#1a3a1e,#2d5233);color:#fff;
    transform:scale(1.08);box-shadow:0 4px 12px rgba(26,58,30,.28);
  }
  .cic-qty-btn:active:not(:disabled){transform:scale(.92);}
  .cic-qty-btn:disabled{opacity:.28;cursor:not-allowed;}
  .cic-qty-num{
    width:36px;text-align:center;font-size:14px;font-weight:800;
    color:#1a1611;font-variant-numeric:tabular-nums;
  }

  /* ── Price ── */
  .cic-price-col{display:flex;flex-direction:column;align-items:flex-end;gap:1px;}
  .cic-mrp{font-size:11.5px;color:#c0b8ae;text-decoration:line-through;}
  .cic-price{
    font-family:var(--font-playfair,'Playfair Display',serif);
    font-size:19px;font-weight:700;color:#1a1611;letter-spacing:-.3px;
  }
  .cic-save{
    font-size:10.5px;font-weight:700;color:#276141;
    background:#eef7ee;padding:2px 8px;border-radius:10px;
    border:1px solid #c0dfc0;margin-top:2px;
  }

  /* ── Remove button ── */
  .cic-remove{
    display:flex;align-items:center;gap:5px;
    background:none;border:1px solid #ead8d8;color:#a83232;
    font-size:11.5px;font-weight:700;padding:7px 12px;border-radius:9px;
    cursor:pointer;transition:all .18s;font-family:inherit;letter-spacing:.15px;
  }
  .cic-remove:hover{
    background:#fdf0f0;border-color:#a83232;
    box-shadow:0 2px 8px rgba(168,50,50,.12);
  }

  /* ── Mobile ── */
  @media(max-width:640px){
    .cic-wrap{padding:16px;}
    .cic-img-wrap{width:80px;height:80px;}
    .cic-emoji{font-size:32px;}
    .cic-name{font-size:15px;}
    .cic-price{font-size:17px;}
    .cic-remove{min-height:44px;min-width:44px;justify-content:center;}
  }
`
