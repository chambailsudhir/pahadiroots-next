'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useCartStore } from '@/store/cartStore'
import { useUserStore } from '@/store/userStore'
import { useUIStore } from '@/store/uiStore'
import { formatPrice, savingsPercent } from '@/lib/utils'
import type { Product } from '@/types'
import { cn } from '@/lib/utils'

interface Props {
  product:      Product
  showWishlist?: boolean
  priority?:    boolean   // LCP hint for first 4 images
}

export default function ProductCard({ product, showWishlist = true, priority = false }: Props) {
  const addItem        = useCartStore(s => s.addItem)
  const openCart       = useUIStore(s => s.openCart)
  const isInWishlist   = useUserStore(s => s.isInWishlist)
  const addToWishlist  = useUserStore(s => s.addToWishlist)
  const removeFromWishlist = useUserStore(s => s.removeFromWishlist)

  const inWishlist = isInWishlist(product.id)

  // Get cheapest active variant (or base product price)
  const variants    = product.product_variants?.filter(v => v.is_active) || []
  const baseVariant = variants.length > 0
    ? variants.reduce((min, v) => v.price < min.price ? v : min, variants[0])
    : null

  const price   = baseVariant?.price ?? product.price
  const mrp     = baseVariant?.mrp   ?? product.mrp ?? product.price
  const savings = savingsPercent(mrp, price)
  const inStock = (baseVariant?.available_stock ?? product.available_stock) > 0

  function handleAddToCart(e: React.MouseEvent) {
    e.preventDefault()
    if (!inStock) return

    addItem({
      productId: product.id,
      variantId: baseVariant?.id ?? product.id,
      name:      product.name,
      slug:      product.slug,
      image:     product.image_url,
      emoji:     product.emoji,
      size:      baseVariant?.size ?? product.unit_label ?? '',
      price,
      mrp,
      gstRate:   product.gst_rate,
      maxQty:    baseVariant?.available_stock ?? product.available_stock,
    })
    openCart()
  }

  function handleWishlist(e: React.MouseEvent) {
    e.preventDefault()
    inWishlist ? removeFromWishlist(product.id) : addToWishlist(product.id)
  }

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group relative flex flex-col bg-white rounded-2xl border border-stone-100 hover:border-stone-200 hover:shadow-lg transition-all duration-200 overflow-hidden"
    >
      {/* Image */}
      <div className="relative aspect-square bg-stone-50 overflow-hidden">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            priority={priority}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-6xl">{product.emoji || '🌿'}</span>
          </div>
        )}

        {/* Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {!inStock && (
            <span className="bg-stone-800/80 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full backdrop-blur-sm">
              Out of stock
            </span>
          )}
          {inStock && product.badges_bestseller && (
            <span className="bg-earth-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              Best Seller
            </span>
          )}
          {inStock && product.badges_new && (
            <span className="bg-forest-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              New
            </span>
          )}
          {savings >= 5 && inStock && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              {savings}% off
            </span>
          )}
        </div>

        {/* Wishlist button */}
        {showWishlist && (
          <button
            onClick={handleWishlist}
            aria-label={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
            className="absolute top-2 right-2 w-8 h-8 bg-white/90 backdrop-blur-sm rounded-full shadow flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110 active:scale-95"
          >
            <svg
              className={cn('w-4 h-4 transition-colors', inWishlist ? 'text-red-500 fill-red-500' : 'text-stone-400')}
              fill={inWishlist ? 'currentColor' : 'none'}
              viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
            </svg>
          </button>
        )}

        {/* Quick add — visible on hover */}
        {inStock && (
          <button
            onClick={handleAddToCart}
            className="absolute bottom-2 inset-x-2 bg-forest-700/95 hover:bg-forest-800 text-white text-xs font-semibold py-2 rounded-xl opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-200 backdrop-blur-sm"
          >
            + Add to Cart
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-1 flex-1">
        {/* Category (if available) */}
        {product.categories?.name && (
          <span className="text-[10px] text-stone-400 uppercase tracking-wide font-medium">
            {product.categories.name}
          </span>
        )}

        <h3 className="text-sm font-semibold text-stone-800 line-clamp-2 leading-snug">
          {product.emoji && <span className="mr-1">{product.emoji}</span>}
          {product.name}
        </h3>

        {/* Variant count */}
        {variants.length > 1 && (
          <span className="text-[11px] text-stone-400">
            {variants.length} sizes available
          </span>
        )}

        {/* Price */}
        <div className="flex items-baseline gap-2 mt-auto pt-2">
          <span className="text-base font-bold text-stone-900">{formatPrice(price)}</span>
          {mrp > price && (
            <span className="text-xs text-stone-400 line-through">{formatPrice(mrp)}</span>
          )}
        </div>
      </div>
    </Link>
  )
}
