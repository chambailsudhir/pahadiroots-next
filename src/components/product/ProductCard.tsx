'use client'

import Image from 'next/image'
import Link from 'next/link'
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
  // ⚠ Do NOT use `useUserStore(s => s.isInWishlist)` — that selector subscribes
  // to the function reference (which is stable) not to wishlist contents, so the
  // component never re-renders when items are added/removed.
  // Instead, read wishlist.includes() directly so Zustand's equality check fires
  // on every wishlist array update.
  const inWishlist         = useUserStore(s => s.wishlist.includes(String(product.id)))
  const addToWishlist      = useUserStore(s => s.addToWishlist)
  const removeFromWishlist = useUserStore(s => s.removeFromWishlist)

  const variants    = product.product_variants?.filter(v => v.is_active) || []
  const baseVariant = variants.length > 0
    ? variants.reduce((min, v) => v.price < min.price ? v : min, variants[0])
    : null

  const price   = baseVariant?.price ?? product.price
  const mrp     = baseVariant?.mrp   ?? product.mrp ?? product.price
  const savings = savingsPercent(mrp, price)

  const stock   = baseVariant?.available_stock ?? product.available_stock ?? 0
  const inStock = stock > 0
  const sClass  = stock > 20 ? 'high' : stock > 5 ? 'mid' : 'low'
  const sPct    = Math.min(100, Math.round(stock / 50 * 100))
  const sLbl    = !inStock ? 'Out of Stock' : stock > 20 ? 'In Stock' : `Only ${stock} left`

  // Badge: use badges array — same priority as old site (badge_type: bs/og/pm/nw)
  const badges: string[] = Array.isArray(product.badges) ? product.badges : []
  const isBestseller = product.badges_bestseller || badges.includes('bestseller')
  const isOrganic    = product.badges_organic    || badges.includes('organic')
  const isNew        = product.badges_new        || badges.includes('new')
  const isPremium    = badges.includes('premium')

  // Badge label & dot colour — same as old site pbd- classes
  let badgeLabel = ''
  let badgeDotClass = ''
  if (isBestseller) { badgeLabel = 'Bestseller'; badgeDotClass = 'pbd-bs' }
  else if (isOrganic)    { badgeLabel = 'Natural';     badgeDotClass = 'pbd-og' }
  else if (isPremium)    { badgeLabel = 'Premium';     badgeDotClass = 'pbd-pm' }
  else if (isNew)        { badgeLabel = 'New Arrival'; badgeDotClass = 'pbd-nw' }

  // Region: old site shows p.region (state name). We use categories.name as fallback
  const region = product.region || product.categories?.name || ''
  const unitLabel = baseVariant?.size || product.unit || product.unit_label || ''
  // Use the real DB review_count if available; fall back to null (no fake numbers).
  // Deterministic fake counts were removed — they're a trust-signal fabrication.
  const reviewCount = product.review_count ?? null

  function handleAddToCart(e: React.MouseEvent) {
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
      isOrganic:    product.badges_organic    ?? false,
      isHimalayan:  !!(product.state_id),
      isBestseller: product.badges_bestseller ?? false,
    })
    openCart()
  }

  function handleWishlist(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    inWishlist ? removeFromWishlist(String(product.id)) : addToWishlist(String(product.id))
  }

  return (
    <Link
      href={`/products/${product.slug}`}
      className="pcard"
      style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', position: 'relative' }}
    >
      {/* ── Badge — top-left, dot + text ── */}
      {badgeLabel && (
        <div className="pbadge-wrap">
          <span className={`pbadge-dot ${badgeDotClass}`} />
          <span className="pbadge-text">{badgeLabel}</span>
        </div>
      )}

      {/* ── Discount ribbon — top-right corner ── */}
      {savings >= 5 && inStock && (
        <div className="pdisc-ribbon">-{savings}%</div>
      )}

      {/* ── Image wrapper ── */}
      <div className="piw" style={{ background: product.card_bg || '#f5f0e8' }}>

        {/* Emoji fallback (behind image) */}
        <span className="pemo">{product.emoji || '🌿'}</span>

        {/* Real image — next/image: Vercel/Supabase auto-resizes + compresses per
            breakpoint via `sizes`, instead of every card downloading the full-res
            original (that was the main cause of "images loading slow everywhere" —
            a raw <img> has no responsive srcset and no optimization/caching). */}
        {product.image_url && (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(max-width:480px) 50vw, (max-width:900px) 33vw, (max-width:1100px) 25vw, 25vw"
            quality={75}
            loading={priority ? 'eager' : 'lazy'}
            priority={priority}
            style={{
              objectFit: 'cover', zIndex: 1, opacity: 0, transition: 'opacity .45s',
            }}
            onLoad={e => {
              const img = e.currentTarget
              img.style.opacity = '1'
              const emo = img.previousElementSibling as HTMLElement | null
              if (emo?.classList.contains('pemo')) emo.style.opacity = '0'
              img.closest('.piw')?.classList.add('img-ready')
            }}
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
        )}

        {/* Hover overlay with Quick View */}
        <div className="piw-hover-overlay">
          <button
            className="piw-qv-btn"
            onClick={e => { e.preventDefault(); e.stopPropagation() }}
            aria-label="Quick view"
          >
            👁 Quick View
          </button>
        </div>

        {/* Wishlist heart — bottom-right, shows on hover */}
        {showWishlist && (
          <button
            className={`piw-wl-btn${inWishlist ? ' active' : ''}`}
            onClick={handleWishlist}
            aria-label={inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
          >
            {inWishlist ? '❤️' : '🤍'}
          </button>
        )}
      </div>

      {/* ── Card body ── */}
      <div className="pbody">

        {/* Region / category label */}
        {region && <div className="pregion">📍 {region}</div>}

        {/* Name */}
        <div className="pname">{product.name}</div>

        {/* Rating — always 5 stars; review count shown only when real DB data exists */}
        <div className="prating">
          <span className="pstars">★★★★★</span>
          {reviewCount !== null && <span className="prc">({reviewCount})</span>}
        </div>

        {/* Stock bar + label */}
        <div className="stock-bar">
          <div className={`stock-fill ${sClass}`} style={{ width: `${sPct}%` }} />
        </div>
        <div className={`stock-label ${sClass}`}>{sLbl}</div>

        {/* Price + ATC */}
        <div className="pfoot" style={{ marginTop: 8 }}>
          <div className="prow" style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
            <span className="pnow">₹{price}</span>
            {mrp > price && <span className="pwas">₹{mrp}</span>}
            {unitLabel && <span className="punt">{unitLabel}</span>}
          </div>

          {/* ATC / Notify */}
          <div className="pcard-actions">
            {inStock ? (
              <button className="atc pcard-atc-full" onClick={handleAddToCart}>
                🛒 Add to Cart
              </button>
            ) : (
              <button className="atc pcard-atc-full" disabled style={{ opacity: .5, cursor: 'not-allowed' }}>
                🔔 Notify Me
              </button>
            )}
            <span className="atc-hint">View Details →</span>
          </div>
        </div>
      </div>
    </Link>
  )
}
