'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useCartStore } from '@/store/cartStore'
import { useUserStore } from '@/store/userStore'
import { useUIStore } from '@/store/uiStore'
import { formatPrice, savingsPercent } from '@/lib/utils'
import { getBaseVariant } from '@/lib/normalizeProduct'
import QuickViewModal from '@/components/product/QuickViewModal'
import type { Product } from '@/types'

// Shared by both the callback ref (catches "already loaded before hydration
// attached") and the onLoad handler (catches the normal async-load case) —
// see the BUG FIX comment at the <Image> below for why both are needed.
function revealCardImage(img: HTMLImageElement) {
  img.style.opacity = '1'
  const emo = img.previousElementSibling as HTMLElement | null
  if (emo?.classList.contains('pemo')) emo.style.opacity = '0'
  img.closest('.piw')?.classList.add('img-ready')
}

interface Props {
  product:       Product
  showWishlist?: boolean
  priority?:     boolean
}

export default function ProductCard({ product, showWishlist = true, priority = false }: Props) {
  const [showQuickView, setShowQuickView] = useState(false)
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

  // Uses the shared getBaseVariant() (also used by getEffectivePrice/
  // getEffectiveStock in lib/normalizeProduct.ts) instead of recomputing the
  // same "lowest active variant" reduction locally — one source of truth for
  // which variant a card represents, shared with the /products sort/filter.
  const baseVariant = getBaseVariant(product)
  const variants     = product.product_variants?.filter(v => v.is_active) || []

  const price   = baseVariant?.price ?? product.price
  const mrp     = baseVariant?.mrp   ?? product.mrp ?? product.price
  const savings = savingsPercent(mrp, price)

  const stock   = baseVariant?.available_stock ?? product.available_stock ?? 0
  const inStock = stock > 0
  const sClass  = stock > 20 ? 'high' : stock > 5 ? 'mid' : 'low'
  const sPct    = Math.min(100, Math.round(stock / 50 * 100))
  const sLbl    = !inStock ? 'Out of Stock' : stock > 20 ? 'In Stock' : `Only ${stock} left`

  // BUG FIX (premium UX — "multi-badge support" from the audit): this used
  // to be a single if/else-if chain, so a product that was BOTH a bestseller
  // AND organic only ever showed "Bestseller" — the organic signal was
  // silently dropped. Now builds a small ordered list and stacks up to 2
  // pills (3+ starts to clutter a card this size), highest-priority first.
  const badges: string[] = Array.isArray(product.badges) ? product.badges : []
  const isBestseller = product.badges_bestseller || badges.includes('bestseller')
  const isOrganic    = product.badges_organic    || badges.includes('organic')
  const isNew        = product.badges_new        || badges.includes('new')
  const isPremium    = badges.includes('premium')

  const activeBadges: { label: string; dotClass: string }[] = []
  if (isBestseller) activeBadges.push({ label: 'Bestseller',  dotClass: 'pbd-bs' })
  if (isOrganic)    activeBadges.push({ label: 'Natural',     dotClass: 'pbd-og' })
  if (isPremium)    activeBadges.push({ label: 'Premium',     dotClass: 'pbd-pm' })
  if (isNew)        activeBadges.push({ label: 'New Arrival', dotClass: 'pbd-nw' })
  const visibleBadges = activeBadges.slice(0, 2)

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

      {/* ── Badges — top-left, stacked pills (up to 2) ── */}
      {visibleBadges.length > 0 && (
        <div className="pbadge-stack">
          {visibleBadges.map(b => (
            <div className="pbadge-wrap" key={b.label}>
              <span className={`pbadge-dot ${b.dotClass}`} />
              <span className="pbadge-text">{b.label}</span>
            </div>
          ))}
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
            a raw <img> has no responsive srcset and no optimization/caching).
            BUG FIX (found via screen recording — every card showed only the
            emoji fallback, never the real photo): the fade-in reveal relied
            solely on the `onLoad` callback below. If the browser finishes
            loading the image (from HTTP cache, or just fast) before React
            finishes hydrating this page and attaches that listener — which
            is common on a server-rendered page where the <img> tag's `src`
            is already in the initial HTML — the native `load` event fires
            and is simply missed. The image is fully downloaded and sitting
            in the DOM the whole time, just permanently stuck at opacity: 0,
            letting the emoji underneath show through forever. The callback
            ref below runs synchronously the instant the DOM node exists
            (whether from hydration of server-rendered markup or a fresh
            mount) and checks `.complete` — a native, synchronous DOM
            property that's true the moment the browser has finished
            loading+decoding the image, regardless of when that happened —
            so the already-loaded case is caught immediately instead of
            waiting on an event that may never come. */}
        {product.image_url && (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            // BUG FIX (images loading slow on /products and every other grid
            // that reuses this card): the grids this card renders in
            // (.prod-page-grid, .pgrid, .pr-spgrid — see globals.css) all use
            // `grid-template-columns: repeat(auto-fit, minmax(260px, 340px))`.
            // That caps each card at a fixed ~260-340px pixel width no matter
            // how wide the browser window is — it does NOT keep scaling as a
            // percentage of viewport width past the point auto-fit stops
            // adding columns. The old `sizes` used vw-based breakpoints
            // (e.g. "25vw"), which on a normal 1600-1920px desktop screen
            // told the browser/Vercel image optimizer the image would render
            // at ~400-480px (and up to ~2x that for retina), so every card
            // downloaded an image 1.5-3x larger in each dimension — 2-9x the
            // file size — than the ~320-340px it's ever actually shown at.
            // Fixed to describe the real rendered width at each breakpoint
            // instead of a viewport fraction: full-width on phones (1
            // column), ~half-width on small tablets (2 columns), and the
            // fixed 340px card cap everywhere wider (3+ columns, where width
            // stops growing with the viewport).
            sizes="(max-width:480px) 100vw, (max-width:768px) 50vw, 340px"
            quality={75}
            loading={priority ? 'eager' : 'lazy'}
            priority={priority}
            style={{
              objectFit: 'cover', zIndex: 1, opacity: 0, transition: 'opacity .45s',
            }}
            ref={img => { if (img?.complete) revealCardImage(img) }}
            onLoad={e => revealCardImage(e.currentTarget)}
            onError={e => { e.currentTarget.style.display = 'none' }}
          />
        )}

        {/* Hover overlay with Quick View — opens the real modal (image, size
            selector, live price, working Add to Cart) instead of the earlier
            stopgap that just linked to the PDP. */}
        <div className="piw-hover-overlay">
          <button
            type="button"
            className="piw-qv-btn"
            onClick={e => { e.preventDefault(); e.stopPropagation(); setShowQuickView(true) }}
            aria-haspopup="dialog"
            aria-label={`Quick view ${product.name}`}
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

      {showQuickView && (
        <QuickViewModal
          product={product}
          initialVariant={baseVariant}
          onClose={() => setShowQuickView(false)}
        />
      )}
    </article>
  )
}
