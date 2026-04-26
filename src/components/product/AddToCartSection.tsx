'use client'

import { useState } from 'react'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import { formatPrice } from '@/lib/utils'
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
  const [qty, setQty]       = useState(1)
  const [added, setAdded]   = useState(false)

  const price    = selectedVariant?.price ?? product.price
  const mrp      = selectedVariant?.mrp   ?? product.mrp ?? product.price
  const maxStock = selectedVariant?.available_stock ?? product.available_stock
  const inStock  = maxStock > 0

  function handleAdd() {
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
      mrp,
      gstRate:   product.gst_rate,
      maxQty:    maxStock,
      qty,
    })

    setAdded(true)
    openCart()
    setTimeout(() => setAdded(false), 2000)
  }

  function handleBuyNow() {
    handleAdd()
    // Slight delay so cart opens first, then navigate
    setTimeout(() => {
      window.location.href = '/checkout'
    }, 300)
  }

  return (
    <div className="space-y-4">

      {/* Variant selector */}
      {variants.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-stone-700 mb-2">
            Size / Weight
            {selectedVariant && (
              <span className="ml-2 font-normal text-stone-500">
                — {selectedVariant.size}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {variants.map(v => {
              const isSelected = selectedVariant?.id === v.id
              const outOfStock = v.available_stock === 0
              return (
                <button
                  key={v.id}
                  onClick={() => !outOfStock && setSelectedVariant(v)}
                  disabled={outOfStock}
                  className={`relative px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all
                    ${isSelected
                      ? 'border-forest-600 bg-forest-50 text-forest-800'
                      : outOfStock
                        ? 'border-stone-100 text-stone-300 cursor-not-allowed bg-stone-50'
                        : 'border-stone-200 text-stone-700 hover:border-forest-400 hover:bg-forest-50'
                    }`}
                >
                  {v.size}
                  {outOfStock && (
                    <span className="absolute -top-1.5 -right-1.5 bg-stone-400 text-white text-[8px] font-bold px-1 rounded-full">
                      OOS
                    </span>
                  )}
                  {!outOfStock && v.price !== price && isSelected && (
                    <span className="block text-[10px] font-medium text-forest-600 mt-0.5">
                      {formatPrice(v.price)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Quantity */}
      {inStock && (
        <div>
          <div className="text-sm font-semibold text-stone-700 mb-2">Quantity</div>
          <div className="flex items-center gap-3">
            <div className="flex items-center border-2 border-stone-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setQty(q => Math.max(1, q - 1))}
                className="w-10 h-10 flex items-center justify-center text-stone-500 hover:bg-stone-50 transition-colors text-lg font-bold"
                aria-label="Decrease quantity"
              >
                −
              </button>
              <span className="w-10 text-center text-sm font-bold text-stone-800">{qty}</span>
              <button
                onClick={() => setQty(q => Math.min(maxStock, q + 1))}
                className="w-10 h-10 flex items-center justify-center text-stone-500 hover:bg-stone-50 transition-colors text-lg font-bold"
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
            {maxStock <= 5 && maxStock > 0 && (
              <span className="text-xs text-red-500 font-semibold">
                Only {maxStock} left!
              </span>
            )}
          </div>
        </div>
      )}

      {/* CTA buttons */}
      <div className="flex gap-3 pt-1">
        {inStock ? (
          <>
            <button
              onClick={handleAdd}
              className={`flex-1 py-3.5 rounded-xl font-bold text-sm border-2 transition-all
                ${added
                  ? 'border-forest-600 bg-forest-600 text-white'
                  : 'border-forest-600 text-forest-700 hover:bg-forest-600 hover:text-white'
                }`}
            >
              {added ? '✓ Added to Cart' : '+ Add to Cart'}
            </button>
            <button
              onClick={handleBuyNow}
              className="flex-1 py-3.5 rounded-xl font-bold text-sm bg-earth-500 hover:bg-earth-600 text-white transition-colors"
            >
              Buy Now
            </button>
          </>
        ) : (
          <div className="flex-1 py-3.5 rounded-xl font-bold text-sm bg-stone-100 text-stone-400 text-center border-2 border-stone-200">
            Out of Stock
          </div>
        )}
      </div>

    </div>
  )
}
