'use client'

// Quick View modal — PREMIUM UX FEATURE (was on the "not yet built" list):
// the card-level "Quick View" button was fixed earlier to at least navigate
// to the PDP instead of doing nothing, but that's a stopgap, not the actual
// feature. This is the real thing: an in-place modal with the product image,
// a size/variant selector, live price for the selected variant, and a
// working Add to Cart — all using data already present on `product` (the
// listing page's variant-pricing fix means every card already carries its
// full variant list, so no extra fetch is needed here).

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import Link from 'next/link'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import { formatPrice, savingsPercent } from '@/lib/utils'
import type { Product, ProductVariant } from '@/types'

interface Props {
  product: Product
  initialVariant: ProductVariant | null
  onClose: () => void
}

export default function QuickViewModal({ product, initialVariant, onClose }: Props) {
  const addItem  = useCartStore(s => s.addItem)
  const openCart = useUIStore(s => s.openCart)

  const variants = (product.product_variants ?? []).filter(v => v.is_active)
  const [selectedId, setSelectedId] = useState(initialVariant?.id ?? variants[0]?.id ?? null)
  const selected = variants.find(v => v.id === selectedId) ?? initialVariant

  const price   = selected?.price ?? product.price
  const mrp     = selected?.mrp   ?? product.mrp ?? product.price
  const savings = savingsPercent(mrp, price)
  const stock   = selected?.available_stock ?? product.available_stock ?? 0
  const inStock = stock > 0

  // Escape-to-close + body scroll lock — same pattern as CartDrawer for consistency
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
    }
  }, [onClose])

  function handleAddToCart() {
    if (!inStock) return
    addItem({
      productId: String(product.id),
      variantId: String(selected?.id ?? product.id),
      name:      product.name,
      slug:      product.slug,
      image:     product.image_url,
      emoji:     product.emoji,
      size:      selected?.size ?? product.unit_label ?? '',
      price, mrp,
      gstRate:   product.gst_rate,
      maxQty:    stock,
      isOrganic:    product.badges_organic    ?? false,
      isHimalayan:  !!(product.state_id),
      isBestseller: product.badges_bestseller ?? false,
    })
    onClose()
    openCart()
  }

  const modal = (
    <div className="qv-overlay" role="presentation" onClick={onClose}>
      <div
        className="qv-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Quick view: ${product.name}`}
        onClick={e => e.stopPropagation()}
      >
        <button type="button" className="qv-close" onClick={onClose} aria-label="Close quick view">✕</button>

        <div className="qv-image" style={{ background: product.card_bg || '#f5f0e8' }}>
          {product.image_url
            ? <Image src={product.image_url} alt={product.name} fill sizes="(max-width:600px) 90vw, 360px" style={{ objectFit: 'cover' }} />
            : <span className="qv-emoji">{product.emoji || '🌿'}</span>}
        </div>

        <div className="qv-body">
          {(product.region || product.categories?.name) && (
            <div className="qv-region">📍 {product.region || product.categories?.name}</div>
          )}
          <h3 className="qv-name">{product.name}</h3>

          <div className="qv-price-row">
            <span className="qv-price">{formatPrice(price)}</span>
            {mrp > price && <span className="qv-mrp">{formatPrice(mrp)}</span>}
            {savings >= 5 && <span className="qv-savings">{savings}% off</span>}
          </div>

          {variants.length > 1 && (
            <div className="qv-variants">
              <div className="qv-variants-label">Size</div>
              <div className="qv-variants-list">
                {variants.map(v => (
                  <button
                    key={v.id}
                    type="button"
                    className={`qv-variant-btn${v.id === selectedId ? ' active' : ''}${v.available_stock <= 0 ? ' disabled' : ''}`}
                    onClick={() => v.available_stock > 0 && setSelectedId(v.id)}
                    disabled={v.available_stock <= 0}
                  >
                    {v.size}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`qv-stock qv-stock-${inStock ? (stock > 20 ? 'high' : 'mid') : 'low'}`}>
            {inStock ? (stock > 20 ? 'In Stock' : `Only ${stock} left`) : 'Out of Stock'}
          </div>

          <button type="button" className="qv-atc" onClick={handleAddToCart} disabled={!inStock}>
            {inStock ? '🛒 Add to Cart' : 'Notify Me'}
          </button>

          <Link href={`/products/${product.slug}`} className="qv-full-details">
            View Full Details →
          </Link>
        </div>
      </div>

      <style>{`
        .qv-overlay {
          position: fixed; inset: 0; z-index: 200; background: rgba(20,30,20,.55);
          display: flex; align-items: center; justify-content: center; padding: 20px;
          animation: qv-fade-in .15s ease;
        }
        @keyframes qv-fade-in { from { opacity: 0 } to { opacity: 1 } }
        .qv-sheet {
          position: relative; background: #fff; border-radius: 22px; max-width: 760px; width: 100%;
          max-height: 88vh; overflow-y: auto; display: flex; box-shadow: 0 30px 80px rgba(0,0,0,.3);
        }
        @media (max-width: 640px) { .qv-sheet { flex-direction: column; } }
        .qv-close {
          position: absolute; top: 14px; right: 14px; z-index: 2;
          background: rgba(255,255,255,.9); border: none; border-radius: 50%;
          width: 32px; height: 32px; font-size: 14px; cursor: pointer;
        }
        .qv-image { position: relative; width: 320px; flex-shrink: 0; }
        @media (max-width: 640px) { .qv-image { width: 100%; height: 240px; } }
        .qv-emoji {
          position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); font-size: 72px;
        }
        .qv-body { padding: 28px 28px 24px; flex: 1; min-width: 0; }
        .qv-region { font-size: 10.5px; color: #a07830; font-weight: 700; letter-spacing: .5px; margin-bottom: 6px; }
        .qv-name { font-family: var(--font-playfair), 'Playfair Display', serif; font-size: 22px; font-weight: 700; color: #1a1a1a; margin: 0 0 12px; }
        .qv-price-row { display: flex; align-items: baseline; gap: 10px; margin-bottom: 18px; }
        .qv-price { font-size: 24px; font-weight: 900; color: #1a3a1e; }
        .qv-mrp { font-size: 14px; color: #999; text-decoration: line-through; }
        .qv-savings { font-size: 12px; font-weight: 700; color: #c8920a; }
        .qv-variants { margin-bottom: 16px; }
        .qv-variants-label { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; color: #a07830; margin-bottom: 8px; }
        .qv-variants-list { display: flex; flex-wrap: wrap; gap: 8px; }
        .qv-variant-btn {
          padding: 8px 16px; border-radius: 20px; border: 1.5px solid #e0e0e0; background: #fff;
          font-size: 13px; font-weight: 600; cursor: pointer; color: #444;
        }
        .qv-variant-btn.active { border-color: #1a3a1e; background: #1a3a1e; color: #fff; }
        .qv-variant-btn.disabled { opacity: .4; text-decoration: line-through; cursor: not-allowed; }
        .qv-stock { font-size: 12px; font-weight: 700; margin-bottom: 16px; }
        .qv-stock-high { color: #22c55e; }
        .qv-stock-mid { color: #f59e0b; }
        .qv-stock-low { color: #ef4444; }
        .qv-atc {
          width: 100%; background: #1a3a1e; color: #fff; border: none; border-radius: 26px;
          padding: 13px; font-size: 14px; font-weight: 800; cursor: pointer; margin-bottom: 12px;
        }
        .qv-atc:disabled { opacity: .5; cursor: not-allowed; }
        .qv-full-details { display: block; text-align: center; font-size: 12.5px; color: #7a7a7a; text-decoration: underline; }
      `}</style>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(modal, document.body)
}
