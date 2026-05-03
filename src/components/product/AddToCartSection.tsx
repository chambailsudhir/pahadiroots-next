'use client'

import { useState } from 'react'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import type { Product, ProductVariant, SiteSettings } from '@/types'

interface Props {
  product:  Product
  variants: ProductVariant[]
  settings: SiteSettings
}

export default function AddToCartSection({ product, variants, settings }: Props) {
  const addItem  = useCartStore(s => s.addItem)
  const openCart = useUIStore(s => s.openCart)

  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(
    variants.length > 0 ? variants[0] : null
  )
  const [qty, setQty]     = useState(1)
  const [added, setAdded] = useState(false)
  const [buying, setBuying] = useState(false)

  const price    = selectedVariant?.price ?? product.price
  const mrp      = selectedVariant?.mrp   ?? product.mrp ?? product.price
  const maxStock = selectedVariant?.available_stock ?? product.available_stock
  const inStock  = maxStock > 0

  function handleAdd(mode: 'add' | 'buy' = 'add') {
    if (!inStock) return
    addItem({
      productId: String(product.id),
      variantId: String(selectedVariant?.id ?? product.id),
      name:      product.name,
      slug:      product.slug,
      image:     product.image_url,
      emoji:     product.emoji,
      size:      selectedVariant?.size ?? product.unit_label ?? '',
      price,
      mrp:       mrp ?? price,
      gstRate:   product.gst_rate,
      maxQty:    maxStock,
      qty,
    })
    if (mode === 'buy') {
      setBuying(true)
      setTimeout(() => { window.location.href = '/checkout' }, 300)
    } else {
      setAdded(true)
      openCart()
      setQty(1)
      setTimeout(() => setAdded(false), 2200)
    }
  }

  const hasMore = variants.length > 3

  return (
    <div>
      {/* Variant selector */}
      {variants.length > 0 && (
        <div className="variants-section">
          <div className="variants-label">
            Select Size: <span id="var-label">{selectedVariant?.size || variants[0]?.size}</span>
          </div>
          <div className={`variant-grid${hasMore ? ' has-more' : ''}`}>
            {variants.map((v, i) => {
              const savePct = v.mrp && v.mrp > v.price ? Math.round((1 - v.price / v.mrp) * 100) : 0
              const isActive = selectedVariant?.id === v.id
              const oos = v.available_stock <= 0
              return (
                <button
                  key={v.id}
                  className={`vcard${isActive ? ' active' : ''}${oos ? ' oos' : ''}`}
                  onClick={() => !oos && setSelectedVariant(v)}
                  disabled={oos}
                  type="button"
                >
                  {i === 1 && variants.length >= 3 && <span className="vcard-tag best">Best Value</span>}
                  {i === variants.length - 1 && variants.length >= 3 && i !== 1 && <span className="vcard-tag deal">Steal Deal</span>}
                  <span className="vc-size">{v.size}</span>
                  <span className="vc-price">
                    ₹{v.price}
                    {v.mrp && v.mrp > v.price && <span className="vc-orig"> ₹{v.mrp}</span>}
                  </span>
                  {savePct > 0 && <span className="vc-save">Save {savePct}%</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Qty + Buttons */}
      <div className="qty-atc">
        <div className="qty-row">
          <div className="qty-ctrl">
            <div className="qty-above">Qty</div>
            <div className="qty-ctrl-inner">
              <button
                className="qty-btn"
                onClick={() => setQty(q => Math.max(1, q - 1))}
                style={{ opacity: qty <= 1 ? 0.3 : 1 }}
                type="button"
                aria-label="Decrease"
              >−</button>
              <span className="qty-num">{qty}</span>
              <button
                className="qty-btn"
                onClick={() => setQty(q => Math.min(maxStock || 99, q + 1))}
                style={{ opacity: qty >= (maxStock || 99) ? 0.3 : 1 }}
                type="button"
                aria-label="Increase"
              >+</button>
            </div>
          </div>

          {inStock ? (
            <button
              className={`btn-add-cart${added ? ' added' : ''}`}
              onClick={() => handleAdd('add')}
              disabled={!inStock || added}
              type="button"
            >
              {added ? '✅ Added to Cart!' : '🛒 Add to Cart'}
            </button>
          ) : (
            <button className="btn-add-cart" disabled type="button">Out of Stock</button>
          )}
        </div>

        {inStock && (
          <button
            className="btn-buy-now"
            onClick={() => handleAdd('buy')}
            disabled={buying}
            type="button"
          >
            {buying ? '⚡ Processing…' : '⚡ Buy Now'}
          </button>
        )}
      </div>
    </div>
  )
}
