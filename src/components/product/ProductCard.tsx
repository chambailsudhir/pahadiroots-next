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

  const href = `/products/${product.slug}`

  return (
    // BUG FIX (accessibility/HTML validity): this used to be a <Link> with
    // <button> elements nested inside it — browsers/screen readers don't
    // handle interactive elements nested inside an <a> correctly, and it's
    // invalid HTML. Now a plain container; navigation is handled by the
    // ".pcard-stretched-link" anchor below (a standard "clickable card"
    // pattern), while the wishlist/Quick View/Add to Cart buttons are real
    // siblings that sit above it in z-index and get their own clicks.
    <article className="pcard" style={{ position: 'relative' }}>
      <Link
        href={href}
        className="pcard-stretched-link"
        aria-label={product.name}
      />

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

        {/* Hover overlay with Quick View — BUG FIX: this used to be a <button>
            whose onClick only called preventDefault/stopPropagation, i.e. a
            fake control that did nothing when clicked. It's a real link to
            the product page now (same destination as the rest of the card),
            styled identically, so it's an honest affordance instead of a
            decorative dead end. */}
        <div className="piw-hover-overlay">
          <Link href={href} className="piw-qv-btn" aria-label={`View details for ${product.name}`}>
            👁 Quick View
          </Link>
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

        {/* Price + ATC — BUG FIX: was raw `₹{price}` interpolation, skipping
            the app's own formatPrice() helper (used everywhere else — cart,
            checkout, PDP) that adds Indian thousands-grouping. Any product
            ≥ ₹1,000 rendered as "₹12500" here instead of "₹12,500". */}
        <div className="pfoot" style={{ marginTop: 8 }}>
          <div className="prow" style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
            <span className="pnow">{formatPrice(price)}</span>
            {mrp > price && <span className="pwas">{formatPrice(mrp)}</span>}
            {unitLabel && <span className="punt">{unitLabel}</span>}
          </div>

          {/* ATC / Notify — buttons are now real siblings of the stretched
              link (not nested inside it), so they sit above it in z-index
              (see .pcard-stretched-link in globals.css) and correctly
              intercept their own clicks without needing stopPropagation
              tricks to fight anchor-nesting behaviour. */}
          <div className="pcard-actions">
            {inStock ? (
              <button className="atc pcard-atc-full" onClick={handleAddToCart} style={{ position: 'relative', zIndex: 3 }}>
                🛒 Add to Cart
              </button>
            ) : (
              <button className="atc pcard-atc-full" disabled style={{ opacity: .5, cursor: 'not-allowed', position: 'relative', zIndex: 3 }}>
                🔔 Notify Me
              </button>
            )}
            <span className="atc-hint">View Details →</span>
          </div>
        </div>
      </div>
    </article>
  )
}
