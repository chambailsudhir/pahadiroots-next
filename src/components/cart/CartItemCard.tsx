'use client'

/**
 * CartItemCard — memoised item row with qty animation.
 *
 * Accessibility fixes applied (this round):
 *
 *   A1. MRP (was-price) span lacks accessible context (WCAG 1.3.1).
 *       The strikethrough MRP (e.g. "₹500") was rendered in a plain <span
 *       className="cic-mrp"> with no semantic meaning. Screen readers
 *       announced the number with no indication it was the original/crossed-out
 *       price — indistinguishable from the current price.
 *       Fix: wrapped in <s> (the semantic strikethrough element) with
 *       aria-label="Was ₹X" so screen readers announce "Was ₹500" while visual
 *       users see the struck-through number. The <s> element's default CSS
 *       text-decoration:line-through is already applied by .cic-mrp styles, so
 *       no visual change occurs.
 *
 *   A2. Badge emojis (🌿, 🏔, ⭐, ⚡) were read aloud by screen readers.
 *       The text labels immediately follow each emoji ("Natural", "Himalayan",
 *       "Bestseller", "Only N left"), so the emoji names add no information but
 *       do add noise. aria-hidden="true" added to each emoji span.
 *
 *   A3. Quantity live region had no explicit label (WCAG 1.3.1).
 *       The <span aria-live="polite"> that displays the qty counter announced
 *       only the number (e.g. "2") with no context when it changed. A screen
 *       reader user navigating a cart with 3 items would hear "2", "1", "3"
 *       with no indication these are quantities.
 *       Fix: aria-label={`Quantity: ${item.qty}`} added so the live region
 *       announces "Quantity: 2" when the value changes.
 *
 * Prior bug-fixes already present (kept for reference):
 *
 *   • All three <button> elements were missing type="button".
 *     Defensive against future <form> wrapper scenarios.
 *
 *   • CSS moved from a CART_ITEM_CARD_CSS template literal to ./cart-item-card.css
 *     so Next.js can extract, deduplicate, and cache the rules properly.
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
          : <span className="cic-emoji" aria-hidden="true">{item.emoji || '🌿'}</span>
        }
      </div>

      {/* Body */}
      <div className="cic-body">
        <div className="cic-meta">
          <Link href={`/products/${item.slug}`} className="cic-name">{item.name}</Link>
          {item.size && <span className="cic-size">{item.size}</span>}
          <div className="cic-badges">
            {/* A2: aria-hidden on badge emojis — the text label that follows
                provides all the information; the emoji name adds only noise. */}
            {item.isOrganic    && <span className="cic-badge org"><span aria-hidden="true">🌿</span> Natural</span>}
            {item.isHimalayan  && <span className="cic-badge hml"><span aria-hidden="true">🏔</span> Himalayan</span>}
            {item.isBestseller && <span className="cic-badge best"><span aria-hidden="true">⭐</span> Bestseller</span>}
            {(item.maxQty ?? 99) <= 5  && (
              <span className="cic-badge stock"><span aria-hidden="true">⚡</span> Only {item.maxQty ?? 99} left</span>
            )}
          </div>
        </div>

        <div className="cic-footer">
          {/* Qty stepper */}
          <div className="cic-qty" role="group" aria-label={`Quantity for ${item.name}`}>
            <button
              type="button"
              className="cic-qty-btn"
              onClick={handleDecr}
              aria-label="Decrease quantity"
              disabled={item.qty <= 1}
            >−</button>
            {/* A3: aria-label gives screen readers "Quantity: N" context on change,
                rather than just announcing the bare number. */}
            <span
              className={`cic-qty-num${qtyAnim ? ` anim-${qtyAnim}` : ''}`}
              aria-live="polite"
              aria-atomic="true"
              aria-label={`Quantity: ${item.qty}`}
            >{item.qty}</span>
            <button
              type="button"
              className="cic-qty-btn"
              onClick={handleIncr}
              aria-label="Increase quantity"
              disabled={item.qty >= (item.maxQty ?? 99)}
            >+</button>
          </div>

          {/* Price */}
          <div className="cic-price-col">
            {hasSaving && (
              // A1: <s> provides semantic strikethrough. aria-label="Was ₹X" gives
              // screen readers meaningful context rather than just a raw number.
              // Visual appearance unchanged — .cic-mrp already applies line-through.
              <s className="cic-mrp" aria-label={`Was ${formatPrice(item.mrp * item.qty)}`}>
                {formatPrice(item.mrp * item.qty)}
              </s>
            )}
            <span className="cic-price">{formatPrice(item.price * item.qty)}</span>
            {hasSaving && (
              <span className="cic-save">Save {formatPrice((item.mrp - item.price) * item.qty)}</span>
            )}
          </div>

          {/* Remove — min 44×44px touch target per WCAG 2.5.5 */}
          <button
            type="button"
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
