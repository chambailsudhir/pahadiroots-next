'use client'

/**
 * CartItemCard — memoised item row with qty animation.
 *
 * Fix: previously exported CART_ITEM_CARD_CSS (a template-literal string) that
 * CartPage injected via <style>{CART_ITEM_CARD_CSS}</style> to avoid N duplicate
 * <style> blocks. That pattern bypasses Next.js's build pipeline entirely.
 *
 * Now: styles live in ./cart-item-card.css, imported here.
 * Next.js deduplicates CSS imports automatically — the rules appear exactly once
 * in the extracted stylesheet regardless of how many instances mount.
 */

import './cart-item-card.css'

import { memo, useCallback } from 'react'
import Image                  from 'next/image'
import Link                   from 'next/link'
import { formatPrice }        from '@/lib/utils'
import type { CartItem }      from '@/types'

interface Props {
  item:        CartItem
  qtyAnim:     'up' | 'down' | null
  onQtyChange: (variantId: string, newQty: number, oldQty: number) => void
  onRemove:    (variantId: string, name: string, price: number) => void
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
          : <span className="cic-emoji">{item.emoji || '🌿'}</span>
        }
      </div>

      {/* Body */}
      <div className="cic-body">
        <div className="cic-meta">
          <Link href={`/products/${item.slug}`} className="cic-name">{item.name}</Link>
          {item.size && <span className="cic-size">{item.size}</span>}
          <div className="cic-badges">
            {item.isOrganic    && <span className="cic-badge org">🌿 Natural</span>}
            {item.isHimalayan  && <span className="cic-badge hml">🏔 Himalayan</span>}
            {item.isBestseller && <span className="cic-badge best">⭐ Bestseller</span>}
            {item.maxQty <= 5  && (
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
              stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
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
