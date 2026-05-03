'use client'

import { useState } from 'react'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import { useRouter } from 'next/navigation'
import type { Product, ProductVariant, SiteSettings } from '@/types'

interface Props {
  product:  Product
  variants: ProductVariant[]
  settings: SiteSettings
}

export default function AddToCartSection({ product, variants, settings }: Props) {
  const router    = useRouter()
  const addItem   = useCartStore(s => s.addItem)
  const openCart  = useUIStore(s => s.openCart)

  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(
    variants.length > 0 ? variants[0] : null
  )
  const [qty, setQty]         = useState(1)
  const [added, setAdded]     = useState(false)
  const [buying, setBuying]   = useState(false)
  const [wishlisted, setWL]   = useState(false)

  const price    = selectedVariant?.price   ?? product.price
  const mrp      = selectedVariant?.mrp     ?? product.mrp ?? product.price
  const maxStock = selectedVariant?.available_stock ?? product.available_stock ?? 0
  const inStock  = maxStock > 0

  function selectVariant(v: ProductVariant) {
    if (v.available_stock <= 0) return
    setSelectedVariant(v)
    setQty(1)
  }

  function changeQty(d: number) {
    setQty(q => Math.max(1, Math.min(q + d, maxStock || 99)))
  }

  function handleAdd(mode: 'add' | 'buy') {
    if (!inStock) return
    const variantId = selectedVariant
      ? String(selectedVariant.id)
      : String(product.id)
    const size = selectedVariant?.size
      || (selectedVariant as any)?.variant_value
      || product.unit_label
      || ''

    addItem({
      productId: String(product.id),
      variantId,
      name:      product.name + (size ? ` (${size})` : ''),
      slug:      product.slug,
      image:     product.image_url,
      emoji:     product.emoji,
      size,
      price,
      mrp:    mrp ?? price,
      gstRate: product.gst_rate,
      maxQty:  maxStock,
      qty,
    })

    if (mode === 'buy') {
      setBuying(true)
      setTimeout(() => router.push('/checkout'), 300)
    } else {
      setAdded(true)
      openCart()
      setQty(1)
      setTimeout(() => setAdded(false), 2200)
    }
  }

  const hasMore = variants.length > 3

  return (
    <div style={{ marginTop: '20px', position: 'relative', zIndex: 2 }}>

      {/* ── Variant selector ── */}
      {variants.length > 0 && (
        <div style={{ marginBottom: '4px', paddingTop: '14px' }}>
          <div className="pdp-variants-label">
            Select Size: <span id="var-label-display">{selectedVariant?.size || variants[0]?.size}</span>
          </div>
          <div className={`pdp-variant-grid${hasMore ? ' has-more' : ''}`}>
            {variants.map((v, i) => {
              const savePct = v.mrp && v.mrp > v.price ? Math.round((1 - v.price / v.mrp) * 100) : 0
              const isActive = selectedVariant?.id === v.id
              const oos = v.available_stock <= 0
              return (
                <button
                  key={v.id}
                  type="button"
                  className={`pdp-vcard${isActive ? ' active' : ''}`}
                  onClick={() => selectVariant(v)}
                  disabled={oos}
                  aria-pressed={isActive}
                >
                  {i === 1 && variants.length >= 3 && (
                    <span className="pdp-vcard-tag best">Best Value</span>
                  )}
                  {i === variants.length - 1 && variants.length >= 3 && i !== 1 && (
                    <span className="pdp-vcard-tag deal">Steal Deal</span>
                  )}
                  <span className="pdp-vc-size">{v.size}</span>
                  <span className="pdp-vc-price">
                    ₹{v.price}
                    {v.mrp && v.mrp > v.price && (
                      <span className="pdp-vc-orig"> ₹{v.mrp}</span>
                    )}
                  </span>
                  {savePct > 0 && <span className="pdp-vc-save">Save {savePct}%</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Qty + Cart row ── */}
      <div className="pdp-qty-atc">
        <div className="pdp-qty-row">
          {/* Qty control */}
          <div className="pdp-qty-ctrl">
            <div className="pdp-qty-above">Qty</div>
            <div className="pdp-qty-inner">
              <button
                type="button"
                className="pdp-qty-btn"
                onClick={() => changeQty(-1)}
                disabled={qty <= 1}
                aria-label="Decrease quantity"
              >−</button>
              <span className="pdp-qty-num">{qty}</span>
              <button
                type="button"
                className="pdp-qty-btn"
                onClick={() => changeQty(1)}
                disabled={qty >= (maxStock || 99)}
                aria-label="Increase quantity"
              >+</button>
            </div>
          </div>

          {/* Wishlist */}
          <button
            type="button"
            className={`pdp-wl-btn${wishlisted ? ' active' : ''}`}
            onClick={() => setWL(w => !w)}
            title="Save to Wishlist"
            aria-label="Add to Wishlist"
          >
            {wishlisted ? '❤️' : '🤍'}
          </button>

          {/* Add to Cart */}
          <button
            type="button"
            className={`pdp-btn-atc${added ? ' added' : ''}`}
            onClick={() => handleAdd('add')}
            disabled={!inStock || added}
          >
            {added ? '✅ Added to Cart!' : !inStock ? 'Out of Stock' : '🛒 Add to Cart'}
          </button>
        </div>

        {/* Buy Now */}
        {inStock && (
          <button
            type="button"
            className="pdp-btn-buy"
            onClick={() => handleAdd('buy')}
            disabled={buying}
          >
            {buying ? '⚡ Processing…' : '⚡ Buy Now'}
          </button>
        )}
      </div>

    </div>
  )
}
