import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getStoreData } from '@/lib/storeData'
import { getSiteSettings, isEnabled } from '@/lib/getSiteSettings'
import { savingsPercent, parseJsonArray, truncate } from '@/lib/utils'
import { sanitizeHtml } from '@/lib/server/sanitize'
import type { Product, ProductVariant, SiteSettings } from '@/types'
import ProductGallery from '@/components/product/ProductGallery'
import AddToCartSection from '@/components/product/AddToCartSection'
import ReviewsSection from '@/components/product/ReviewsSection'
import RelatedProducts from '@/components/product/RelatedProducts'
import PincodeRow from '@/components/product/PincodeRow'
import Breadcrumb from '@/components/ui/Breadcrumb'
import Link from 'next/link'
import Image from 'next/image'

export const revalidate = 3600

interface Props { params: { slug: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { product } = await fetchProductData(params.slug)
  if (!product) return { title: 'Product Not Found' }

  const rawDesc = product.ai_description || product.short_description || `Buy ${product.name} online — pure Himalayan.`
  // BUG FIX (3.1 + 5.3): use product.name only so the layout template
  // appends " | 5 Pahadi Roots" exactly once.
  // BUG FIX (5.3): use the existing truncate() utility (word-boundary aware,
  // adds ellipsis) instead of the raw .slice(0,155) that cut mid-word.
  const desc = truncate(rawDesc.replace(/<[^>]+>/g, ''), 155)
  const canonicalUrl = `https://pahadiroots.com/products/${product.slug}`
  const ogImage = product.image_url
    ? [{ url: product.image_url, width: 800, height: 800, alt: product.name }]
    : []

  return {
    // BUG FIX (3.1): was `${product.name} — 5 Pahadi Roots` which rendered
    // "Lakadong Turmeric — 5 Pahadi Roots | 5 Pahadi Roots" (brand name twice)
    title: product.name,
    description: desc,
    // BUG FIX (5.1): add canonical so the slug URL is always authoritative
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${product.name} | 5 Pahadi Roots`,
      description: desc,
      // BUG FIX (3.2): og:url was missing — Meta uses it as the share-cache
      // de-dup key, so every product shared the homepage card
      url: canonicalUrl,
      images: ogImage,
    },
    // BUG FIX (3.2): twitter was never overridden so all product pages
    // inherited the layout's generic hardcoded Twitter card
    twitter: {
      card:        'summary_large_image',
      title:       `${product.name} | 5 Pahadi Roots`,
      description: desc,
      images:      ogImage.map(i => i.url),
    },
  }
}

export default async function ProductPage({ params }: Props) {
  const [{ product, variants, images, stateData, related, reviewStats, settings: storeSettings }, siteSettings] = await Promise.all([
    fetchProductData(params.slug),
    getSiteSettings(),
  ])

  if (!product) notFound()

  // Merge settings (storeData service-key settings override getSiteSettings anon key)
  const settings: SiteSettings = { ...siteSettings, ...storeSettings } as SiteSettings

  const freeShipMin    = parseInt(settings.free_shipping_min || '0')
  const flatShipCharge = parseInt(settings.flat_shipping_charge || '0')
  const showReviews    = isEnabled(settings.show_reviews_on_pdp)
  const showRelated    = isEnabled(settings.show_related_products)

  // Images: product_images table (full res, sorted) → fallback image_url
  const allImages = images.length > 0
    ? images.map((i: any) => ({ url: i.image_url || i.url, alt: product.name }))
    : product.image_url ? [{ url: product.image_url, alt: product.name }] : []

  // Active variants sorted by price
  const activeVariants: ProductVariant[] = variants
    .filter((v: any) => v.is_active)
    .sort((a: any, b: any) => a.price - b.price)
    .map((v: any) => ({ ...v, size: v.variant_value ?? v.size ?? v.variant_label ?? '' }))

  const baseVariant = activeVariants.length > 0
    ? activeVariants.reduce((min: any, v: any) => v.price < min.price ? v : min, activeVariants[0])
    : null

  const displayPrice = baseVariant?.price ?? product.price
  const displayMRP   = baseVariant?.mrp ?? product.mrp ?? product.price
  const savings      = savingsPercent(displayMRP ?? displayPrice, displayPrice)
  const stockCount   = baseVariant?.available_stock ?? product.available_stock
  const inStock      = stockCount > 0

  // AI content
  const benefits    = parseJsonArray(product.ai_health_benefits)
  const howToUse    = parseJsonArray(product.ai_how_to_use)
  const storageTips = parseJsonArray(product.ai_storage_tips)

  // Region
  const regionName  = stateData?.name || 'Himalayan Region'
  const stateImg    = stateData?.image_path || stateData?.image_url || ''
  const rEmoji      = ({ 'Assam': '🌿', 'Himachal Pradesh': '🏔️', 'Uttarakhand': '🌲',
    'Jammu & Kashmir': '❄️', 'Sikkim': '🌸', 'Nagaland': '🌿',
    'Meghalaya': '☁️', 'Ladakh': '⛰️' } as Record<string, string>)[regionName] || '🏔️'

  // Description: 4-layer fallback matching old site
  // BUG FIX (02): sanitize HTML from DB/AI pipeline before dangerouslySetInnerHTML
  const descHtml = sanitizeHtml(
    (product.ai_description?.trim())
    || (product.long_description?.trim())
    || (product.short_description ? `<p>${product.short_description}</p>` : '')
    || '<p>Authentic Himalayan product sourced directly from local farmers. No preservatives, no additives — pure and natural.</p>'
  )

  // BUG FIX (02): sanitize ai_who_should_buy before dangerouslySetInnerHTML
  const whoHtml = product.ai_who_should_buy ? sanitizeHtml(product.ai_who_should_buy) : ''

  // BUG FIX (3.8): highlights were computed from product.tags but never
  // rendered, and the JSON.parse had no try/catch. Removed entirely.

  // WhatsApp
  const waNumber = (settings.whatsapp_number || '919899984895').replace(/\D/g, '')
  const waNumDisplay = waNumber.replace('91', '').replace(/(\d{5})(\d{5})/, '$1 $2')

  // BUG FIX (3.3): aggregateRating was hardcoded to 4.8 / 39 on every product.
  // Now wired to real review data from fetchProductData.
  // JSON-LD: only include aggregateRating when there are real reviews.
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type':    'Product',
    name:        product.name,
    description: (product.short_description || ''),
    image:       allImages.map((i: any) => i.url),
    url:         `https://pahadiroots.com/products/${product.slug}`,
    brand:       { '@type': 'Brand', name: '5 Pahadi Roots' },
    ...(reviewStats && reviewStats.count > 0 ? {
      aggregateRating: {
        '@type':      'AggregateRating',
        ratingValue:  reviewStats.avg.toFixed(1),
        reviewCount:  String(reviewStats.count),
      },
    } : {}),
    ...(displayPrice ? {
      offers: {
        '@type':        'Offer',
        priceCurrency:  'INR',
        price:          String(displayPrice),
        availability:   inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        seller:         { '@type': 'Organization', name: '5 Pahadi Roots' },
      },
    } : {}),
  }

  const crumbs = [
    { label: 'Home', href: '/' },
    { label: 'All Products', href: '/products' },
    { label: product.name },
  ]

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* ── Breadcrumb + Back pill in one compact row ── */}
      <div className="pdp-nav-row">
        <Breadcrumb crumbs={crumbs} className="pdp-breadcrumb" />
        <Link href="/products" className="pdp-back-pill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15,18 9,12 15,6" />
          </svg>
          All Products
        </Link>
      </div>

      <div className="pdp-page-bg">

        {/* ── Main two-column layout ── */}
        <div className="pdp-wrap">

          {/* LEFT: Gallery */}
          <div className="pdp-img-col">
            <ProductGallery images={allImages} productName={product.name} savings={savings} />
          </div>

          {/* RIGHT: Info */}
          <div className="pdp-info-col">

            {/* Region + vendor */}
            <div className="pdp-vendor">{rEmoji} {regionName}</div>
            <div className="pdp-vendor-sub">VENDOR : 5 PAHADI ROOTS</div>

            {/* Title */}
            <h1 className="pdp-title">{product.name}</h1>

            {/* Short description / tagline */}
            {product.short_description && (
              <p className="pdp-tagline">{product.short_description}</p>
            )}

            {/* BUG FIX (3.3 + 3.6): Rating row — no longer hardcoded to 4.8/39.
                Only shown when real review data exists (reviewStats from DB).
                The "(N reviews)" span now scrolls to the reviews section on
                click instead of faking interactivity with no handler. */}
            {reviewStats && reviewStats.count > 0 && (
              <div className="pdp-rating-row">
                <div className="pdp-stars">
                  {[1,2,3,4,5].map(i => (
                    <svg key={i} className="pdp-star" viewBox="0 0 24 24">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                  ))}
                </div>
                <span className="pdp-rating-num">{reviewStats.avg.toFixed(1)}</span>
                {/* BUG FIX (3.6): was styled as link but had no href/onClick */}
                <a href="#reviews" className="pdp-rating-count">({reviewStats.count} reviews)</a>
              </div>
            )}

            {/* Price block */}
            <div className="pdp-price-block">
              <div className="pdp-price-row">
                <span className="pdp-price">₹{displayPrice}</span>
                {displayMRP && displayMRP > displayPrice && (
                  <>
                    <span className="pdp-mrp">₹{displayMRP}</span>
                    <span className="pdp-save-badge">SAVE {savings}%</span>
                  </>
                )}
              </div>
              <p className="pdp-tax-note">
                MRP inclusive of all taxes{activeVariants.length > 0 && baseVariant ? ` · ${baseVariant.size}` : ''}
              </p>
              {/* BUG FIX (3.4): urgency bar was always capped at 95% because
                  (100 - x) * 2 >= 95 for any x <= 52, and the bar only renders
                  when stockCount < 50. Now uses initial_stock when available for
                  a real sold-percentage; falls back to a proportional formula. */}
              {stockCount > 0 && stockCount < 50 && (
                <div className="pdp-urgency">
                  <div className="pdp-urgency-label">🔥 Only {stockCount} left — selling fast!</div>
                  <div className="pdp-urgency-track">
                    <div
                      className="pdp-urgency-fill"
                      style={{
                        width: (() => {
                          const initial = (product as any).initial_stock
                          if (initial && initial > 0) {
                            // Real sold-percentage based on initial stock
                            return `${Math.min(Math.round((1 - stockCount / initial) * 100), 95)}%`
                          }
                          // Fallback: proportional within the 1–49 visible range
                          // 1 unit → ~95%, 49 units → ~2%
                          return `${Math.round(((50 - stockCount) / 49) * 93 + 2)}%`
                        })(),
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Key Benefits card */}
            {benefits.length > 0 && (
              <div className="pdp-benefits-card">
                <div className="pdp-benefits-title">✨ Key Benefits</div>
                {benefits.map((b: any, i: number) => (
                  <div key={i} className="pdp-ben-item">
                    <div className="pdp-ben-icon">{typeof b === 'object' ? (b.icon || '✓') : '✓'}</div>
                    <div>
                      <div className="pdp-ben-title">{typeof b === 'object' ? b.title : b}</div>
                      {typeof b === 'object' && b.desc && (
                        <div className="pdp-ben-desc">{b.desc}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Variant + Qty + Buttons — Client Component */}
            <AddToCartSection product={product} variants={activeVariants} settings={settings} />

            {/* Stock indicator */}
            <div className="pdp-stock-row">
              <div className={`pdp-stock-dot${stockCount <= 0 ? ' oos' : stockCount <= 5 ? ' low' : ''}`} />
              <span>
                {stockCount <= 0 ? 'Out of Stock'
                  : stockCount <= 5 ? `Only ${stockCount} left!`
                  : stockCount <= 20 ? `${stockCount} in stock`
                  : 'In Stock'}
              </span>
            </div>

            {/* BUG FIX (3.5): PincodeRow is now a real client component with
                state, validation, and a WhatsApp-based delivery-check handler.
                waNumber is actually used. */}
            <PincodeRow waNumber={waNumber} />

            {/* Share row */}
            <ShareRow productName={product.name} productSlug={product.slug} productImage={product.image_url} productPrice={displayPrice} />

            {/* Delivery bar */}
            <div className="pdp-delivery-bar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="1" y="3" width="15" height="13" /><polygon points="16,8 20,8 23,11 23,16 16,16" />
                <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
              {freeShipMin === 0
                ? '🚚 Free delivery on all orders · Pan India · Metro 3–5 days · Others 7–12 days'
                : `🚚 Pan India · Free above ₹${freeShipMin} (₹${flatShipCharge} below) · Metro 3–5 days · Others 7–12 days`}
            </div>

            {/* Trust badges */}
            <div className="pdp-trust-badges">
              <div className="pdp-trust-badge"><div className="pdp-tb-icon">🔬</div><div className="pdp-tb-label">Lab Tested & Certified</div></div>
              <div className="pdp-trust-badge"><div className="pdp-tb-icon">🌿</div><div className="pdp-tb-label">100% Pure & Natural</div></div>
              <div className="pdp-trust-badge"><div className="pdp-tb-icon">🏔️</div><div className="pdp-tb-label">Direct from Farmers</div></div>
              <div className="pdp-trust-badge">
                <div className="pdp-tb-icon">🚚</div>
                <div className="pdp-tb-label">{freeShipMin === 0 ? 'Free Delivery' : `Free ₹${freeShipMin}+`}</div>
              </div>
            </div>

            {/* Origin card */}
            <div className="pdp-origin-card">
              <div className="pdp-origin-head">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="2" strokeLinejoin="round">
                  <polygon points="3 20 9 8 13 14 16 10 21 20" /><circle cx="18.5" cy="5.5" r="1.5" fill="#f0c840" stroke="none" />
                </svg>
                Himalayan Origin Story
              </div>
              <div className="pdp-origin-body">
                <div className="pdp-origin-map">
                  {stateImg
                    ? <Image src={stateImg} alt={regionName} width={80} height={80} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                    : <span style={{ fontSize: '26px', lineHeight: '1' }}>{rEmoji}</span>}
                </div>
                <div className="pdp-origin-text">
                  <div className="pdp-origin-region">{regionName}</div>
                  <p>Sourced directly from farming families in {regionName}, nestled in the pristine Himalayas. Grown at altitude, harvested with traditional methods — pure as the mountains.</p>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ── Accordion section ── */}
        <div className="pdp-acc-section">
          <div className="pdp-acc-list">

            <AccItem title="Description" icon="desc" open>
              {/* BUG FIX (02): sanitized above with server-safe sanitizeHtml() */}
              <div dangerouslySetInnerHTML={{ __html: descHtml }} />
            </AccItem>

            {howToUse.length > 0 && (
              <AccItem title="How to Use" icon="how">
                <ul>
                  {howToUse.map((s: any, i: number) => (
                    <li key={i}>{typeof s === 'string' ? s : s?.step || JSON.stringify(s)}</li>
                  ))}
                </ul>
              </AccItem>
            )}

            {storageTips.length > 0 && (
              <AccItem title="Storage Tips" icon="storage">
                <ul>
                  {storageTips.map((s: any, i: number) => (
                    <li key={i}>{typeof s === 'string' ? s : JSON.stringify(s)}</li>
                  ))}
                </ul>
              </AccItem>
            )}

            {whoHtml && (
              <AccItem title="Who Should Buy" icon="who">
                {/* BUG FIX (02): sanitized above with server-safe sanitizeHtml() */}
                <div dangerouslySetInnerHTML={{ __html: whoHtml }} />
              </AccItem>
            )}

            <AccItem title="Certifications" icon="cert">
              <div className="pdp-cert-badges">
                <div className="pdp-cert-badge">🔬 Lab Tested</div>
                <div className="pdp-cert-badge">🌿 100% Natural</div>
                <div className="pdp-cert-badge">🏛️ FSSAI Licensed</div>
                <div className="pdp-cert-badge">✅ No Adulterants</div>
              </div>
            </AccItem>

            <AccItem title="Shipping" icon="ship">
              <strong>Pan India Shipping</strong><br /><br />
              {freeShipMin === 0
                ? 'Free shipping on all orders · COD available. '
                : `Free shipping above ₹${freeShipMin} · Flat ₹${flatShipCharge} below. COD available. `}
              Dispatched within <strong>1–2 business days</strong>.<br />
              Metro cities: <strong>3–5 days</strong> · Non-metro / remote: <strong>7–12 days</strong>.
            </AccItem>

            <AccItem title="Returns & Refunds" icon="returns">
              ✅ <strong>Eligible:</strong> Damaged, defective or wrong item — report within <strong>48 hours</strong> with photo/video.<br /><br />
              ❌ <strong>Not eligible:</strong> Opened/used edible products or items reported after 48 hours.<br /><br />
              WhatsApp +91 {waNumDisplay} with order number & photo. Refunds within <strong>7–10 business days</strong>.
            </AccItem>

          </div>
        </div>

        {/* ── Reviews ── */}
        {showReviews && (
          <div id="reviews" className="pdp-reviews-wrap">
            <ReviewsSection productId={product.id} />
          </div>
        )}

        {/* ── Related ──
            BUG FIX (3.9): was calling RelatedProducts with categoryId/excludeId
            which caused it to independently re-fetch the full catalog (a second
            getStoreData() call) and filter by category_id only — ignoring the
            already-computed `related` array (which matched state OR category).
            Now passes the pre-fetched array directly. */}
        {showRelated && related.length > 0 && (
          <div className="pdp-related-wrap">
            <RelatedProducts products={related} />
          </div>
        )}

        {/* ── Why 5 Pahadi Roots ── */}
        <WhySection />

      </div>
    </>
  )
}

// ─── Sub-components (Server) ──────────────────────────────────────────────────

const ACC_ICONS: Record<string, React.ReactNode> = {
  desc:    <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  how:     <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  storage: <svg viewBox="0 0 24 24"><path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/></svg>,
  who:     <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
  cert:    <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  ship:    <svg viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  returns: <svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>,
}

function AccItem({ title, icon, open = false, children }: {
  title: string; icon: string; open?: boolean; children: React.ReactNode
}) {
  return (
    <details className="pdp-acc-item" open={open}>
      <summary className="pdp-acc-head">
        <div className="pdp-acc-head-left">
          <div className="pdp-acc-icon">{ACC_ICONS[icon]}</div>
          <span className="pdp-acc-title">{title}</span>
        </div>
        <div className="pdp-acc-chevron">
          <svg viewBox="0 0 14 14"><polyline points="2,4 7,10 12,4"/></svg>
        </div>
      </summary>
      <div className="pdp-acc-body">{children}</div>
    </details>
  )
}

function ShareRow({ productName, productSlug, productImage, productPrice }: {
  productName: string; productSlug: string; productImage: string | null; productPrice: number
}) {
  const url = `https://pahadiroots.com/products/${productSlug}`
  const waText = encodeURIComponent(`🌿 Check out *${productName}* at ₹${productPrice} on 5 Pahadi Roots!\n🏔️ Pure Himalayan, directly from mountain farmers.\n👉 ${url}`)
  return (
    <div className="pdp-share-row">
      <span className="pdp-share-label">Share on</span>
      <div className="pdp-share-icons">
        <a href={`https://wa.me/?text=${waText}`} target="_blank" rel="noopener noreferrer" className="pdp-share-btn pdp-share-wa" title="WhatsApp">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12.004 2.003A9.997 9.997 0 002.007 12c0 1.762.461 3.418 1.268 4.861L2.003 22l5.29-1.247A9.952 9.952 0 0012.004 22c5.523 0 9.997-4.477 9.997-9.998A9.997 9.997 0 0012.004 2.003z"/></svg>
        </a>
        <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" className="pdp-share-btn pdp-share-fb" title="Facebook">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="#1877f2"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.791-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.883v2.271h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
        </a>
        <a href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(productName + ' — 5 Pahadi Roots')}`} target="_blank" rel="noopener noreferrer" className="pdp-share-btn pdp-share-tw" title="X / Twitter">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.261 5.633 5.903-5.633zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </a>
        <a href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(productName)}`} target="_blank" rel="noopener noreferrer" className="pdp-share-btn pdp-share-tg" title="Telegram">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="#229ed9"><path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
        </a>
        <a href={`https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&media=${encodeURIComponent(productImage || '')}&description=${encodeURIComponent(productName + ' — 5 Pahadi Roots')}`} target="_blank" rel="noopener noreferrer" className="pdp-share-btn pdp-share-pin" title="Pinterest">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="#e60023"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>
        </a>
      </div>
    </div>
  )
}

function WhySection() {
  return (
    <section className="pdp-why-bg">
      <div className="pdp-why-inner">
        <div className="pdp-why-chip">Our Promise</div>
        <h2 className="pdp-why-title">Why 5 Pahadi Roots</h2>
        <p className="pdp-why-sub">Four pillars that define everything we do — mountain to doorstep.</p>
      </div>
      <div className="pdp-why-grid">
        {/* PILLAR 1: Lab Tested */}
        <div className="pdp-why-pillar">
          <div className="pdp-why-num">01</div>
          <svg viewBox="0 0 148 148" xmlns="http://www.w3.org/2000/svg" style={{width:'110px',height:'110px',marginBottom:'10px'}}>
            <defs><radialGradient id="lt1" cx="45%" cy="35%" r="65%"><stop offset="0%" stopColor="#f0f8e8"/><stop offset="100%" stopColor="#4a9858"/></radialGradient></defs>
            <circle cx="74" cy="74" r="74" fill="url(#lt1)"/>
            <rect x="54" y="112" width="40" height="6" rx="3" fill="#1a4828"/>
            <rect x="68" y="90" width="12" height="24" rx="2" fill="#2a6840"/>
            <rect x="68" y="58" width="8" height="36" rx="2" fill="#2a6840"/>
            <rect x="68" y="56" width="30" height="8" rx="2" fill="#1a4828"/>
            <rect x="70" y="44" width="8" height="16" rx="3" fill="#3a7850"/>
            <circle cx="74" cy="42" r="6" fill="#1a4828"/>
            <circle cx="74" cy="42" r="3" fill="#88c8f8" opacity=".8"/>
            <rect x="40" y="86" width="28" height="8" rx="1" fill="#c8e8f8" opacity=".9"/>
            <circle cx="52" cy="90" r="4" fill="#50a840" opacity=".7"/>
            <circle cx="108" cy="44" r="18" fill="#f0c840" opacity=".95"/>
            <circle cx="108" cy="44" r="14" fill="white" opacity=".9"/>
            <polyline points="100,44 106,50 118,36" stroke="#1a4828" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="88" y="66" width="40" height="12" rx="3" fill="#1a4828" opacity=".85"/>
            <text x="108" y="75" fontSize="7" fontWeight="700" fill="white" textAnchor="middle">CERTIFIED</text>
            <circle cx="28" cy="30" r="11" fill="#f0c840" opacity=".88"/>
            <text x="22" y="35" fontSize="9" fontWeight="700" fill="#7a6000">LAB</text>
          </svg>
          <div className="pdp-why-pt">Lab Tested Purity</div>
          <p className="pdp-why-pd">Every batch tested for heavy metals, pesticides &amp; adulterants. Certificate with every order.</p>
        </div>
        {/* PILLAR 2: Direct from Farmers */}
        <div className="pdp-why-pillar">
          <div className="pdp-why-num">02</div>
          <svg viewBox="0 0 148 148" xmlns="http://www.w3.org/2000/svg" style={{width:'110px',height:'110px',marginBottom:'10px'}}>
            <defs><radialGradient id="fd2" cx="45%" cy="35%" r="65%"><stop offset="0%" stopColor="#d8f0d8"/><stop offset="100%" stopColor="#4a9858"/></radialGradient></defs>
            <circle cx="74" cy="74" r="74" fill="url(#fd2)"/>
            <polygon points="0,90 24,52 50,72 74,42 98,68 124,48 148,80 148,148 0,148" fill="#2a6840" opacity=".4"/>
            <polygon points="0,106 20,72 46,88 74,58 102,84 128,66 148,96 148,148 0,148" fill="#1a4828"/>
            <circle cx="116" cy="26" r="13" fill="#f0c840" opacity=".9"/>
            <text x="108" y="30" fontSize="7" fontWeight="700" fill="#7a6000">FARM</text>
            <text x="108" y="39" fontSize="7" fill="#7a6000">→HOME</text>
          </svg>
          <div className="pdp-why-pt">Direct from Farmers</div>
          <p className="pdp-why-pd">Zero middlemen. 200+ farming families across 12 Himalayan states — fair wages, always.</p>
        </div>
        {/* PILLAR 3: Eco Packaging */}
        <div className="pdp-why-pillar">
          <div className="pdp-why-num">03</div>
          <svg viewBox="0 0 148 148" xmlns="http://www.w3.org/2000/svg" style={{width:'110px',height:'110px',marginBottom:'10px'}}>
            <defs><radialGradient id="ed3" cx="45%" cy="42%" r="65%"><stop offset="0%" stopColor="#c8e8f8"/><stop offset="100%" stopColor="#5890c0"/></radialGradient></defs>
            <circle cx="74" cy="74" r="74" fill="url(#ed3)"/>
            <circle cx="74" cy="80" r="46" fill="#2878b8" opacity=".7"/>
            <line x1="74" y1="34" x2="74" y2="18" stroke="#38b040" strokeWidth="3.5" strokeLinecap="round"/>
            <path d="M74,28 Q58,20 60,8 Q70,16 74,28Z" fill="#50c850"/>
            <path d="M74,24 Q90,16 88,4 Q78,12 74,24Z" fill="#60d860"/>
            <circle cx="116" cy="30" r="13" fill="#f0c840" opacity=".9"/>
            <text x="110" y="35" fontSize="9" fontWeight="700" fill="#7a6000">ECO</text>
          </svg>
          <div className="pdp-why-pt">Eco Packaging</div>
          <p className="pdp-why-pd">Glass jars, recycled cardboard, zero single-use plastic. Packaging as clean as our products.</p>
        </div>
        {/* PILLAR 4: Give-Back Program */}
        <div className="pdp-why-pillar">
          <div className="pdp-why-num">04</div>
          <svg viewBox="0 0 148 148" xmlns="http://www.w3.org/2000/svg" style={{width:'110px',height:'110px',marginBottom:'10px'}}>
            <defs><radialGradient id="gb3" cx="45%" cy="35%" r="65%"><stop offset="0%" stopColor="#c8e8f8"/><stop offset="100%" stopColor="#5888b8"/></radialGradient></defs>
            <circle cx="74" cy="74" r="74" fill="url(#gb3)"/>
            <polygon points="0,106 20,72 46,88 74,58 102,84 128,66 148,96 148,148 0,148" fill="#2a5838"/>
            <circle cx="30" cy="38" r="13" fill="#f0c840" opacity=".88"/>
            <text x="24" y="43" fontSize="10" fontWeight="700" fill="#7a6000">5%</text>
          </svg>
          <div className="pdp-why-pt">Give-Back Program</div>
          <p className="pdp-why-pd">5% of every order funds Himalayan forest restoration and village school programs.</p>
        </div>
      </div>
    </section>
  )
}

// ─── Data fetcher — uses SERVICE KEY via storeData (bypasses all RLS) ─────────
async function fetchProductData(slug: string) {
  try {
    const storeData = await getStoreData()

    // Find product by slug or id
    let rawProduct = storeData.products.find((p: any) =>
      (p.slug || '').toLowerCase() === slug.toLowerCase()
    )
    if (!rawProduct) rawProduct = storeData.products.find((p: any) => String(p.id) === slug)
    if (!rawProduct) return { product: null, variants: [], images: [], stateData: null, related: [], reviewStats: null, settings: {} }

    // Normalize badges
    const badges: string[] = Array.isArray(rawProduct.badges) ? rawProduct.badges : []
    const product: Product = {
      ...rawProduct,
      badges_bestseller: badges.includes('bestseller'),
      badges_new:        badges.includes('new'),
      badges_organic:    badges.includes('organic'),
    }

    // Variants for this product
    const variants = storeData.product_variants
      .filter((v: any) => String(v.product_id) === String(product.id))
      .map((v: any) => ({ ...v, size: v.variant_value ?? v.size ?? v.variant_label ?? '' }))

    // Product images sorted by sort_order
    const images = storeData.product_images
      .filter((i: any) => String(i.product_id) === String(product.id))
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

    // State data
    const stateData = product.state_id
      ? storeData.states.find((s: any) => String(s.id) === String(product.state_id)) || null
      : null

    // Related: same state OR same category, exclude self, max 4
    // BUG FIX (3.9): attach images and variants here so RelatedProducts
    // doesn't need a second getStoreData() call
    const relatedRaw = storeData.products
      .filter((p: any) =>
        p.id !== product.id &&
        (p.state_id === product.state_id || p.category_id === product.category_id)
      )
      .slice(0, 4)

    const related = relatedRaw.map((p: any) => {
      const imgs = storeData.product_images
        .filter((i: any) => String(i.product_id) === String(p.id))
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      const vars = storeData.product_variants
        .filter((v: any) => String(v.product_id) === String(p.id) && v.is_active)
        .sort((a: any, b: any) => a.price - b.price)
      const badgeArr: string[] = Array.isArray(p.badges) ? p.badges : []
      return {
        ...p,
        badges_bestseller: badgeArr.includes('bestseller'),
        badges_new:        badgeArr.includes('new'),
        badges_organic:    badgeArr.includes('organic'),
        _firstImage:       imgs[0]?.image_url || p.image_url || '',
        _variants:         vars,
      }
    })

    // Settings object
    const settings = storeData.settings

    // BUG FIX (3.3): fetch real review aggregate from Supabase.
    // Uses the anon client — reviews are public data.
    // Wrapped in its own try/catch so a reviews DB error never 404s the PDP.
    let reviewStats: { avg: number; count: number } | null = null
    try {
      const { createClient } = await import('@supabase/supabase-js')
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const anonClient = createClient(supabaseUrl, supabaseAnonKey)
      const { data: reviewRows } = await anonClient
        .from('reviews')
        .select('rating')
        .eq('product_id', product.id)
        .eq('status', 'approved')
      if (reviewRows && reviewRows.length > 0) {
        const sum = reviewRows.reduce((acc: number, r: any) => acc + (r.rating || 0), 0)
        reviewStats = {
          avg:   sum / reviewRows.length,
          count: reviewRows.length,
        }
      }
    } catch (reviewErr) {
      // Non-fatal — PDP renders fine without aggregate rating
      console.warn('[fetchProductData] review stats fetch failed:', reviewErr)
    }

    return { product, variants, images, stateData, related, reviewStats, settings }
  } catch (err) {
    console.error('[fetchProductData] error:', err)
    return { product: null, variants: [], images: [], stateData: null, related: [], reviewStats: null, settings: {} }
  }
}

export async function generateStaticParams() {
  try {
    const storeData = await getStoreData()
    return storeData.products.map((p: any) => ({ slug: p.slug || String(p.id) }))
  } catch { return [] }
}
