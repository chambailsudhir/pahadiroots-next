'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import { formatPrice } from '@/lib/utils'
import { getBaseVariant } from '@/lib/normalizeProduct'
import type { Product } from '@/types'
import styles from './ExploreByRegion.module.css'

/**
 * Compact product card used only by the homepage "Explore by Region" row.
 * Mirrors the approved design: photo, name, price + pack size, small cart button.
 * Price / stock / cart payload come from the same helpers ProductCard uses,
 * so the two can never disagree about which variant a card represents.
 */
export default function RegionProductCard({ product, priority = false }: { product: Product; priority?: boolean }) {
  const addItem  = useCartStore(s => s.addItem)
  const openCart = useUIStore(s => s.openCart)

  const baseVariant = getBaseVariant(product)
  const price   = baseVariant?.price ?? product.selling_price ?? product.price
  const mrp     = baseVariant?.mrp ?? product.mrp ?? product.selling_price ?? product.price
  const stock   = baseVariant?.available_stock ?? product.available_stock ?? 0
  const inStock = stock > 0
  const unit    = baseVariant?.size || product.unit || product.unit_label || ''

  function handleAdd(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
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
      maxQty:    stock,
      isOrganic:    product.badges_organic ?? false,
      isHimalayan:  !!product.state_id,
      isBestseller: product.badges_bestseller ?? false,
    })
    openCart()
  }

  return (
    <article className={styles.card}>
      <Link href={`/products/${product.slug}`} prefetch={false} className={styles.cardLink} aria-label={product.name} />
      <div className={styles.cardImg} style={{ background: product.card_bg || '#f3ecdc' }}>
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(max-width: 700px) 50vw, 230px"
            quality={75}
            priority={priority}
            style={{ objectFit: 'cover' }}
          />
        ) : <span className={styles.cardEmoji}>{product.emoji || '🌿'}</span>}
      </div>
      <div className={styles.cardBody}>
        <h4 className={styles.cardName}>{product.name}</h4>
        <div className={styles.cardFoot}>
          <div className={styles.cardPrice}>
            <strong>{formatPrice(price)}</strong>
            {unit && <span>{unit}</span>}
          </div>
          <button
            type="button"
            className={styles.cardCart}
            onClick={handleAdd}
            disabled={!inStock}
            aria-label={inStock ? `Add ${product.name} to cart` : `${product.name} is out of stock`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.5 3.5h2.6l2.2 11.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.78L19.5 7.5H6" />
              <circle cx="9.5" cy="19.5" r="1.3" />
              <circle cx="16.5" cy="19.5" r="1.3" />
            </svg>
          </button>
        </div>
      </div>
    </article>
  )
}
