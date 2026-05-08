'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useCartStore } from '@/store/cartStore'
import { useUserStore } from '@/store/userStore'
import { useUIStore } from '@/store/uiStore'
import { formatPrice, savingsPercent } from '@/lib/utils'
import type { Product } from '@/types'

interface Props {
  product:       Product
  showWishlist?: boolean
  priority?:     boolean
}

export default function ProductCard({ product, showWishlist = true, priority = false }: Props) {
  const addItem            = useCartStore(s => s.addItem)
  const openCart           = useUIStore(s => s.openCart)
  const isInWishlist       = useUserStore(s => s.isInWishlist)
  const addToWishlist      = useUserStore(s => s.addToWishlist)
  const removeFromWishlist = useUserStore(s => s.removeFromWishlist)

  const inWishlist = isInWishlist(String(product.id))

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
      productId: String(product.id),
      variantId: String(baseVariant?.id ?? product.id),
      name:      product.name,
      slug:      product.slug,
      image:     product.image_url,
      emoji:     product.emoji,
      size:      baseVariant?.size ?? product.unit_label ?? '',
      price, mrp,
      gstRate:   product.gst_rate,
      maxQty:    baseVariant?.available_stock ?? product.available_stock,
    })
    openCart()
  }

  function handleWishlist(e: React.MouseEvent) {
    e.preventDefault()
    inWishlist ? removeFromWishlist(String(product.id)) : addToWishlist(String(product.id))
  }

  return (
    <Link href={`/products/${product.slug}`} className="pcard" style={{ textDecoration: 'none' }}>
      {/* Image area */}
      <div className="piw">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(max-width:640px) 50vw, (max-width:1024px) 33vw, 25vw"
            className="object-cover"
            style={{ transition: 'transform .4s' }}
            priority={priority}
          />
        ) : (
          <div className="pemo">{product.emoji || '🌿'}</div>
        )}

        {/* Badges */}
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', flexDirection: 'column', gap: 4, zIndex: 2 }}>
          {!inStock && <span className="pbadge" style={{ background: '#555', color: '#fff' }}>Out of Stock</span>}
          {inStock && product.badges_bestseller && <span className="pbadge bbs">Best Seller</span>}
          {inStock && product.badges_organic    && <span className="pbadge bog">Organic</span>}
          {inStock && product.badges_new        && <span className="pbadge bnw">New</span>}
          {savings >= 5 && inStock              && <span className="pbadge bpm">{savings}% off</span>}
        </div>

        {/* Wishlist */}
        {showWishlist && (
          <button
            onClick={handleWishlist}
            aria-label={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
            className={`wl-btn${inWishlist ? ' active' : ''}`}
          >
            {inWishlist ? '❤️' : '🤍'}
          </button>
        )}

        {/* Social proof */}
        {inStock && product.badges_bestseller && (
          <div className="soc-proof">
            <div className="soc-dot" />
            <span>Popular pick</span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="pbody">
        {product.categories?.name && (
          <div className="pregion">{product.categories.name}</div>
        )}
        <div className="pname">{product.name}</div>

        {/* Rating */}
        <div className="prating">
          <span className="pstars">★★★★★</span>
          <span className="prc">(4.9)</span>
        </div>

        {variants.length > 1 && (
          <div style={{ fontSize: 11, color: 'var(--tx3)', marginBottom: 4 }}>{variants.length} sizes available</div>
        )}

        <div className="pfoot">
          <div className="prow">
            <span className="pnow">{formatPrice(price)}</span>
            {mrp > price && <span className="pwas">{formatPrice(mrp)}</span>}
          </div>
          {inStock ? (
            <button onClick={handleAddToCart} className="atc">
              🛒 Add to Cart
            </button>
          ) : (
            <button disabled className="atc" style={{ opacity: .5, cursor: 'not-allowed' }}>
              Out of Stock
            </button>
          )}
        </div>
      </div>
    </Link>
  )
}
