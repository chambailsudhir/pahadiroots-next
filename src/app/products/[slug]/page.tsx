import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSiteSettings, isEnabled } from '@/lib/getSiteSettings'
import { formatPrice, savingsPercent, parseJsonArray } from '@/lib/utils'
import type { Product } from '@/types'
import ProductGallery from '@/components/product/ProductGallery'
import AddToCartSection from '@/components/product/AddToCartSection'
import ReviewsSection from '@/components/product/ReviewsSection'
import RelatedProducts from '@/components/product/RelatedProducts'
import Link from 'next/link'

export const revalidate = 3600

interface Props { params: { slug: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await fetchProduct(params.slug)
  if (!product) return { title: 'Product Not Found' }
  const desc = product.ai_description
    ? product.ai_description.replace(/<[^>]+>/g, '').slice(0, 155)
    : product.short_description?.slice(0, 155) || `Buy ${product.name} online — pure and natural.`
  return {
    title: `${product.name} — 5 Pahadi Roots`,
    description: desc,
    openGraph: {
      title: `${product.name} | 5 Pahadi Roots`,
      description: desc,
      images: product.image_url ? [{ url: product.image_url, width: 800, height: 800, alt: product.name }] : [],
    },
  }
}

export default async function ProductPage({ params }: Props) {
  const [product, settings] = await Promise.all([
    fetchProduct(params.slug),
    getSiteSettings(),
  ])

  if (!product) notFound()

  const variants    = product.product_variants?.filter(v => v.is_active) || []
  const images      = product.product_images || []
  const allImages   = images.length > 0
    ? images.map(i => ({ url: i.url, alt: i.alt_text || product.name }))
    : product.image_url ? [{ url: product.image_url, alt: product.name }] : []

  const baseVariant  = variants.length > 0
    ? variants.reduce((min, v) => v.price < min.price ? v : min, variants[0])
    : null
  const displayPrice = baseVariant?.price ?? product.price
  const displayMRP   = baseVariant?.mrp ?? product.mrp ?? product.price
  const savings      = savingsPercent(displayMRP ?? displayPrice, displayPrice)

  const showReviews  = isEnabled(settings.show_reviews_on_pdp)
  const showRelated  = isEnabled(settings.show_related_products)

  const benefits     = parseJsonArray(product.ai_health_benefits)
  const howToUse     = parseJsonArray(product.ai_how_to_use)
  const storageTips  = parseJsonArray(product.ai_storage_tips)
  const freeShipMin  = parseInt(settings.free_shipping_min || '799')
  const flatShip     = parseInt(settings.flat_shipping_charge || '99')

  const regionName   = (product as any).states?.name || 'Himalayan Region'
  const stateImg     = (product as any).states?.image_url || (product as any).states?.image_path || ''
  const regionEmojis: Record<string, string> = {
    'Assam': '🌿', 'Himachal Pradesh': '🏔️', 'Uttarakhand': '🌲',
    'Jammu & Kashmir': '❄️', 'Sikkim': '🌸', 'Nagaland': '🌿',
    'Meghalaya': '☁️', 'Ladakh': '⛰️',
  }
  const rEmoji = regionEmojis[regionName] || '🏔️'

  const descHtml = product.ai_description?.trim()
    || product.long_description?.trim()
    || (product.short_description ? `<p>${product.short_description}</p>` : '')
    || '<p>Authentic Himalayan product sourced directly from local farmers. No preservatives, no additives — pure and natural.</p>'

  const stockCount = baseVariant?.available_stock ?? product.available_stock
  const inStock    = stockCount > 0

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: (product.ai_description || product.short_description || '').replace(/<[^>]+>/g, ''),
    image: allImages.map(i => i.url),
    brand: { '@type': 'Brand', name: '5 Pahadi Roots' },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.8', reviewCount: '39' },
    offers: {
      '@type': 'Offer',
      price: displayPrice,
      priceCurrency: 'INR',
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `https://pahadiroots.com/products/${product.slug}`,
    },
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Back Bar */}
      <div className="back-bar">
        <div className="back-bar-inner">
          <Link href="/products" className="back-bar-link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15,18 9,12 15,6" />
            </svg>
            Back to All Products
          </Link>
          <Link href="/products" className="back-bar-shop">
            🌿 Browse Himalayan Products
          </Link>
        </div>
      </div>

      {/* Breadcrumb */}
      <nav className="breadcrumb">
        <Link href="/">Home</Link>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6" /></svg>
        <Link href="/products">All Products</Link>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6" /></svg>
        <span>{product.name}</span>
      </nav>

      <div style={{ background: '#faf6ee' }}>
        <div className="product-wrap">

          {/* Gallery */}
          <div className="img-section">
            <ProductGallery images={allImages} productName={product.name} savings={savings} />
          </div>

          {/* Info panel */}
          <div className="info-section">

            <div className="prod-vendor">{rEmoji} {regionName}</div>
            <div className="prod-vendor-tag">VENDOR : 5 PAHADI ROOTS</div>

            <h1 className="prod-name">{product.name}</h1>

            {product.short_description && (
              <p className="prod-tagline">{product.short_description}</p>
            )}

            {/* Rating */}
            <div className="rating-row">
              <div className="stars">
                {[1,2,3,4,5].map(i => (
                  <svg key={i} className="star" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                ))}
              </div>
              <span className="rating-num">4.8</span>
              <span className="rating-reviews">(39 reviews)</span>
            </div>

            {/* Price */}
            <div className="price-block">
              <div className="price-row">
                <span className="price-now">₹{displayPrice}</span>
                {displayMRP && displayMRP > displayPrice && (
                  <>
                    <span className="price-was">₹{displayMRP}</span>
                    <span className="price-save-badge">SAVE {savings}%</span>
                  </>
                )}
              </div>
              <p className="price-tax-note">
                MRP inclusive of all taxes{variants.length > 0 && baseVariant ? ` · ${baseVariant.size}` : ''}
              </p>
              {stockCount > 0 && stockCount < 50 && (
                <div className="urgency-bar">
                  <div className="urgency-label">🔥 Only {stockCount} left — selling fast!</div>
                  <div className="urgency-track">
                    <div className="urgency-fill" style={{ width: `${Math.min((100 - stockCount) * 2, 95)}%` }} />
                  </div>
                </div>
              )}
            </div>

            {/* Key Benefits */}
            {benefits.length > 0 && (
              <div className="inline-benefits">
                <div className="inline-ben-title">✨ Key Benefits</div>
                <div>
                  {benefits.map((b: any, i: number) => (
                    <div key={i} className="ben-item">
                      <div className="ben-icon">{typeof b === 'object' ? (b.icon || '✓') : '✓'}</div>
                      <div>
                        <div className="ben-title">{typeof b === 'object' ? b.title : b}</div>
                        {typeof b === 'object' && b.desc && <div className="ben-desc">{b.desc}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Variant + Cart */}
            <div style={{ position: 'relative', zIndex: 2, marginTop: '20px' }}>
              <AddToCartSection product={product} variants={variants} settings={settings} />
            </div>

            {/* Stock indicator */}
            <div className="stock-row">
              <div className={`stock-dot${stockCount <= 0 ? ' oos' : stockCount <= 5 ? ' low' : ''}`} />
              <span>
                {stockCount <= 0 ? 'Out of Stock'
                  : stockCount <= 5 ? `Only ${stockCount} left!`
                  : stockCount <= 20 ? `${stockCount} in stock`
                  : 'In Stock'}
              </span>
            </div>

            {/* Pincode + Vendor */}
            <div className="pincode-row">
              <span>📍</span>
              <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--tx2)' }}>Check delivery:</span>
              <input className="pincode-input" type="text" placeholder="Enter PIN" maxLength={6} readOnly />
              <button className="pincode-check" type="button">Check</button>
              <span className="vendor-tag">VENDOR : 5 PAHADI ROOTS</span>
            </div>

            {/* Share */}
            <div className="share-row">
              <span className="share-label">Share on</span>
              <div className="share-icons">
                <a href={`https://wa.me/?text=${encodeURIComponent(`🌿 Check out *${product.name}* on 5 Pahadi Roots!\n🏔️ Pure Himalayan, directly from mountain farmers.\n👉 https://pahadiroots.com/products/${product.slug}`)}`}
                  target="_blank" rel="noopener noreferrer" className="share-icon-btn wa" title="WhatsApp">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#25d366">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                    <path d="M12.004 2.003A9.997 9.997 0 002.007 12c0 1.762.461 3.418 1.268 4.861L2.003 22l5.29-1.247A9.952 9.952 0 0012.004 22c5.523 0 9.997-4.477 9.997-9.998A9.997 9.997 0 0012.004 2.003z" />
                  </svg>
                </a>
                <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`https://pahadiroots.com/products/${product.slug}`)}`}
                  target="_blank" rel="noopener noreferrer" className="share-icon-btn fb" title="Facebook">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="#1877f2">
                    <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.791-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.883v2.271h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
                  </svg>
                </a>
                <a href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(`https://pahadiroots.com/products/${product.slug}`)}&text=${encodeURIComponent(product.name + ' — 5 Pahadi Roots')}`}
                  target="_blank" rel="noopener noreferrer" className="share-icon-btn tw" title="X / Twitter">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#000">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.261 5.633 5.903-5.633zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </a>
                <a href={`https://t.me/share/url?url=${encodeURIComponent(`https://pahadiroots.com/products/${product.slug}`)}&text=${encodeURIComponent(product.name)}`}
                  target="_blank" rel="noopener noreferrer" className="share-icon-btn tg" title="Telegram">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="#229ed9">
                    <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                  </svg>
                </a>
              </div>
            </div>

            {/* Delivery */}
            <div className="delivery-bar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="1" y="3" width="15" height="13" /><polygon points="16,8 20,8 23,11 23,16 16,16" />
                <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
              {freeShipMin === 0
                ? '🚚 Free delivery on all orders · Pan India · Metro 3–5 days · Others 7–12 days'
                : `🚚 Pan India delivery · Free above ₹${freeShipMin} (₹${flatShip} below) · Metro 3–5 days · Others 7–12 days`}
            </div>

            {/* Trust badges */}
            <div className="trust-badges">
              <div className="trust-badge"><div className="tb-icon">🔬</div><div className="tb-label">Lab Tested & Certified</div></div>
              <div className="trust-badge"><div className="tb-icon">🌿</div><div className="tb-label">100% Pure & Natural</div></div>
              <div className="trust-badge"><div className="tb-icon">🏔️</div><div className="tb-label">Direct from Farmers</div></div>
              <div className="trust-badge">
                <div className="tb-icon">🚚</div>
                <div className="tb-label">{freeShipMin === 0 ? 'Free Delivery' : `Free Delivery ₹${freeShipMin}+`}</div>
              </div>
            </div>

            {/* Origin card */}
            <div className="origin-card">
              <div className="origin-header">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="2" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polygon points="3 20 9 8 13 14 16 10 21 20" /><circle cx="18.5" cy="5.5" r="1.5" fill="#f0c840" stroke="none" />
                </svg>
                Himalayan Origin Story
              </div>
              <div className="origin-body">
                <div className="origin-map">
                  {stateImg
                    ? <img src={stateImg} alt={regionName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                    : <span style={{ fontSize: '26px', lineHeight: 1 }}>{rEmoji}</span>}
                </div>
                <div className="origin-text">
                  <div className="origin-region">{regionName}</div>
                  <p>This product is sourced directly from farming families in {regionName}, nestled in the pristine Himalayan region. Grown at altitude, harvested with traditional methods — pure as the mountains themselves.</p>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Accordion tabs */}
        <div className="desc-section">
          <div className="acc-list">
            <details className="acc-item" open>
              <summary className="acc-head">
                <div className="acc-head-left">
                  <div className="acc-icon-wrap">
                    <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                  </div>
                  <span className="acc-title">Description</span>
                </div>
                <div className="acc-chevron"><svg viewBox="0 0 14 14" style={{ width: '13px', height: '13px', stroke: '#8a7060', strokeWidth: '2.5', fill: 'none' }}><polyline points="2,4 7,10 12,4" /></svg></div>
              </summary>
              <div className="acc-body" dangerouslySetInnerHTML={{ __html: descHtml }} />
            </details>

            {howToUse.length > 0 && (
              <details className="acc-item">
                <summary className="acc-head">
                  <div className="acc-head-left">
                    <div className="acc-icon-wrap"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg></div>
                    <span className="acc-title">How to Use</span>
                  </div>
                  <div className="acc-chevron"><svg viewBox="0 0 14 14" style={{ width: '13px', height: '13px', stroke: '#8a7060', strokeWidth: '2.5', fill: 'none' }}><polyline points="2,4 7,10 12,4" /></svg></div>
                </summary>
                <div className="acc-body">
                  <ul>{howToUse.map((s: any, i: number) => <li key={i}>{typeof s === 'string' ? s : s?.step || JSON.stringify(s)}</li>)}</ul>
                </div>
              </details>
            )}

            {storageTips.length > 0 && (
              <details className="acc-item">
                <summary className="acc-head">
                  <div className="acc-head-left">
                    <div className="acc-icon-wrap"><svg viewBox="0 0 24 24"><path d="M21 8v13H3V8" /><rect x="1" y="3" width="22" height="5" rx="1" /><line x1="10" y1="12" x2="14" y2="12" /></svg></div>
                    <span className="acc-title">Storage Tips</span>
                  </div>
                  <div className="acc-chevron"><svg viewBox="0 0 14 14" style={{ width: '13px', height: '13px', stroke: '#8a7060', strokeWidth: '2.5', fill: 'none' }}><polyline points="2,4 7,10 12,4" /></svg></div>
                </summary>
                <div className="acc-body">
                  <ul>{storageTips.map((s: any, i: number) => <li key={i}>{typeof s === 'string' ? s : JSON.stringify(s)}</li>)}</ul>
                </div>
              </details>
            )}

            {product.ai_who_should_buy && (
              <details className="acc-item">
                <summary className="acc-head">
                  <div className="acc-head-left">
                    <div className="acc-icon-wrap"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg></div>
                    <span className="acc-title">Who Should Buy</span>
                  </div>
                  <div className="acc-chevron"><svg viewBox="0 0 14 14" style={{ width: '13px', height: '13px', stroke: '#8a7060', strokeWidth: '2.5', fill: 'none' }}><polyline points="2,4 7,10 12,4" /></svg></div>
                </summary>
                <div className="acc-body" dangerouslySetInnerHTML={{ __html: product.ai_who_should_buy }} />
              </details>
            )}

            <details className="acc-item">
              <summary className="acc-head">
                <div className="acc-head-left">
                  <div className="acc-icon-wrap"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg></div>
                  <span className="acc-title">Certifications</span>
                </div>
                <div className="acc-chevron"><svg viewBox="0 0 14 14" style={{ width: '13px', height: '13px', stroke: '#8a7060', strokeWidth: '2.5', fill: 'none' }}><polyline points="2,4 7,10 12,4" /></svg></div>
              </summary>
              <div className="acc-body">
                <div className="cert-badges">
                  <div className="cert-badge">🔬 Lab Tested</div>
                  <div className="cert-badge">🌿 100% Natural</div>
                  <div className="cert-badge">🏛️ FSSAI Licensed</div>
                  <div className="cert-badge">✅ No Adulterants</div>
                </div>
              </div>
            </details>

            <details className="acc-item">
              <summary className="acc-head">
                <div className="acc-head-left">
                  <div className="acc-icon-wrap">
                    <svg viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
                  </div>
                  <span className="acc-title">Shipping</span>
                </div>
                <div className="acc-chevron"><svg viewBox="0 0 14 14" style={{ width: '13px', height: '13px', stroke: '#8a7060', strokeWidth: '2.5', fill: 'none' }}><polyline points="2,4 7,10 12,4" /></svg></div>
              </summary>
              <div className="acc-body">
                <strong>Pan India Shipping</strong><br /><br />
                {freeShipMin === 0
                  ? 'Free shipping on all orders · COD available.'
                  : `Free shipping on orders above ₹${freeShipMin} · Flat ₹${flatShip} below ₹${freeShipMin} · COD available.`}{' '}
                Dispatched within <strong>1–2 business days</strong>.<br />
                Delivery: <strong>Metro cities: 3–5 business days</strong> after dispatch · <strong>Non-metro / remote areas: 7–12 business days</strong> after dispatch.
              </div>
            </details>

            <details className="acc-item">
              <summary className="acc-head">
                <div className="acc-head-left">
                  <div className="acc-icon-wrap"><svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" /></svg></div>
                  <span className="acc-title">Returns & Refunds</span>
                </div>
                <div className="acc-chevron"><svg viewBox="0 0 14 14" style={{ width: '13px', height: '13px', stroke: '#8a7060', strokeWidth: '2.5', fill: 'none' }}><polyline points="2,4 7,10 12,4" /></svg></div>
              </summary>
              <div className="acc-body">
                ✅ <strong>Eligible:</strong> Damaged, defective or wrong item — report within <strong>48 hours</strong> of delivery with photo/video proof.<br /><br />
                ❌ <strong>Not eligible:</strong> Opened/used edible products (honey, ghee, spices, etc.) or items reported after 48 hours.<br /><br />
                Refunds processed within <strong>7–10 business days</strong> after approval.
              </div>
            </details>
          </div>
        </div>

        {/* Reviews */}
        {showReviews && (
          <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 28px 40px' }}>
            <ReviewsSection productId={product.id} />
          </div>
        )}

        {/* Related */}
        {showRelated && product.category_id && (
          <div className="related-section">
            <RelatedProducts categoryId={product.category_id} excludeId={product.id} />
          </div>
        )}

        {/* Why 5 Pahadi Roots */}
        <section className="why-bg">
          <div className="ct">
            <div className="chip">Our Promise</div>
            <h2 className="sh2">Why 5 Pahadi Roots</h2>
            <p className="ssub">Four pillars that define everything we do — mountain to doorstep.</p>
          </div>
          <div className="pgr">
            {([
              { num: '01', title: 'Lab Tested Purity', desc: 'Every batch tested for heavy metals, pesticides & adulterants. Certificate with every order.', emoji: '🔬' },
              { num: '02', title: 'Direct from Farmers', desc: 'Zero middlemen. 200+ farming families across 12 Himalayan states — fair wages, always.', emoji: '🌾' },
              { num: '03', title: 'Eco Packaging', desc: 'Glass jars, recycled cardboard, zero single-use plastic. Packaging as clean as our products.', emoji: '♻️' },
              { num: '04', title: 'Give-Back Program', desc: '5% of every order funds Himalayan forest restoration and village school programs.', emoji: '🌲' },
            ] as const).map(p => (
              <div key={p.num} className="pillar">
                <div className="pnum">{p.num}</div>
                <div style={{ fontSize: '36px', marginBottom: '10px' }}>{p.emoji}</div>
                <div className="pt">{p.title}</div>
                <p className="pd">{p.desc}</p>
              </div>
            ))}
          </div>
        </section>

      </div>

      {/* Page-level styles */}
      <style>{`
:root{
  --g:#1a3a1e;--g2:#2d5233;--g3:#3d6b42;
  --gd:#c8920a;--gd2:#e8b84b;
  --tx:#1a1a1a;--tx2:#4a4a4a;--tx3:#7a7a7a;
  --bd:rgba(26,58,30,.12);--bd2:rgba(26,58,30,.22);
  --g-pale:#f0f7f0;--g-light:#e8f5e9;
  --red:#c0392b;
  --bg:#fff;--bg2:#f8f9f5;--bg3:#f3f5f0;
  --radius:16px;
  --shadow-lg:0 12px 40px rgba(0,0,0,.14);
  --warm-bd:#e8e0d0;
  --gold:#c8920a;
}
.back-bar{background:#f5f0e8;border-bottom:1px solid rgba(26,58,30,.1);position:sticky;top:0;z-index:200}
.back-bar-inner{max-width:1320px;margin:0 auto;padding:0 32px;display:flex;align-items:center;justify-content:space-between;gap:12px;height:42px}
.back-bar-link{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:700;color:var(--g);text-decoration:none;white-space:nowrap;transition:color .15s}
.back-bar-link:hover{color:var(--g3)}
.back-bar-shop{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--tx3);text-decoration:none;white-space:nowrap}
.back-bar-shop:hover{color:var(--g)}
@media(max-width:600px){.back-bar-inner{padding:0 14px}.back-bar-shop{display:none}}
.breadcrumb{padding:12px 32px;font-size:12px;color:var(--tx3);max-width:1280px;margin:0 auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.breadcrumb a{color:var(--g3);font-weight:700;text-decoration:none}
.product-wrap{max-width:1320px;margin:0 auto;padding:0 32px 32px;display:grid;grid-template-columns:1fr 1.15fr;gap:44px;align-items:start;width:100%}
@media(max-width:900px){.product-wrap{grid-template-columns:1fr;gap:24px;padding:0 16px 16px}}
.img-section{position:sticky;top:80px;width:100%}
.info-section{padding-top:4px}
.prod-vendor{font-size:10.5px;font-weight:800;color:var(--gd);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:8px;font-family:'Josefin Sans',sans-serif}
.prod-vendor::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,rgba(200,146,10,.3),transparent)}
.prod-vendor-tag{font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:var(--g);margin-bottom:10px;font-family:'Josefin Sans',sans-serif}
.prod-name{font-family:'Playfair Display',serif;font-size:clamp(24px,3.2vw,38px);font-weight:900;color:var(--g);line-height:1.12;margin-bottom:8px;letter-spacing:-.4px}
.prod-tagline{font-size:16px;color:#3a3030;line-height:1.75;margin-bottom:16px;font-family:'Cormorant Garamond',serif;font-weight:600;letter-spacing:.1px;font-style:italic}
.rating-row{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.stars{display:flex;gap:2px}
.star{width:16px;height:16px;fill:#e8a020}
.rating-num{font-size:13.5px;font-weight:800;color:var(--tx2)}
.rating-reviews{font-size:13px;color:var(--tx3);text-decoration:underline;cursor:pointer}
.price-block{margin-bottom:20px}
.price-row{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:4px}
.price-now{font-family:'Playfair Display',serif;font-size:42px;font-weight:900;color:var(--g);line-height:1;letter-spacing:-1.5px}
.price-was{font-size:20px;color:var(--tx3);text-decoration:line-through;font-weight:400}
.price-save-badge{background:linear-gradient(135deg,#c0392b,#e74c3c);color:#fff;font-size:12px;font-weight:900;padding:5px 13px;border-radius:20px;letter-spacing:.3px;box-shadow:0 2px 8px rgba(192,57,43,.3)}
.price-tax-note{font-size:12px;color:var(--tx3);margin-top:3px}
.urgency-bar{margin-top:10px}
.urgency-label{font-size:11.5px;font-weight:700;color:var(--red);margin-bottom:5px}
.urgency-track{height:5px;background:var(--bg3);border-radius:4px;overflow:hidden}
.urgency-fill{height:100%;background:linear-gradient(90deg,var(--g),var(--gold));border-radius:4px}
.inline-benefits{background:linear-gradient(135deg,#fffdf8,#fff9ee);border:1.5px solid #e8a020;border-radius:16px;padding:22px 24px;margin-top:16px;box-shadow:0 2px 12px rgba(232,160,32,.08)}
.inline-ben-title{font-size:16px;font-weight:900;color:#7a4400;margin-bottom:16px;font-family:'Playfair Display',serif}
.ben-item{display:flex;align-items:flex-start;gap:13px;margin-bottom:10px}
.ben-item:last-child{margin-bottom:0}
.ben-icon{width:30px;height:30px;border-radius:50%;background:rgba(232,160,32,.14);border:1.5px solid rgba(232,160,32,.4);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;margin-top:1px}
.ben-title{font-size:13.5px;font-weight:800;color:#1a1a1a;margin-bottom:2px;line-height:1.3}
.ben-desc{font-size:12.5px;color:#5a5a5a;line-height:1.55}
.stock-row{display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:13px;font-weight:700}
.stock-dot{width:8px;height:8px;border-radius:50%;background:#4caf50;animation:pulse-g 2s infinite}
.stock-dot.low{background:#ff9800;animation:pulse-o 2s infinite}
.stock-dot.oos{background:#f44336;animation:none}
@keyframes pulse-g{0%,100%{box-shadow:0 0 0 0 rgba(76,175,80,.4)}50%{box-shadow:0 0 0 5px rgba(76,175,80,0)}}
@keyframes pulse-o{0%,100%{box-shadow:0 0 0 0 rgba(255,152,0,.4)}50%{box-shadow:0 0 0 5px rgba(255,152,0,0)}}
.pincode-row{display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.pincode-input{border:1.5px solid var(--bd);border-radius:7px;padding:7px 11px;font-size:12.5px;color:var(--tx);outline:none;width:120px;background:#fff}
.pincode-check{background:var(--g-pale);color:var(--g);border:1.5px solid var(--g);border-radius:7px;padding:7px 13px;font-size:12px;font-weight:800;cursor:pointer;transition:all .2s;font-family:inherit}
.pincode-check:hover{background:var(--g);color:#fff}
.vendor-tag{font-size:10.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:var(--g);white-space:nowrap;font-family:'Josefin Sans',sans-serif;margin-left:auto}
.share-row{display:flex;align-items:center;gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid rgba(26,58,30,.08);flex-wrap:wrap}
.share-label{font-size:10px;color:#9a9a9a;font-weight:700;white-space:nowrap;letter-spacing:1.8px;text-transform:uppercase}
.share-icons{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.share-icon-btn{width:36px;height:36px;border-radius:50%;border:1.5px solid #e8e0d4;background:#fff;display:flex;align-items:center;justify-content:center;transition:all .22s;flex-shrink:0;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.share-icon-btn:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.15)}
.share-icon-btn.wa:hover{background:#25d366;border-color:#25d366}
.share-icon-btn.fb:hover{background:#1877f2;border-color:#1877f2}
.share-icon-btn.tw:hover{background:#000;border-color:#000}
.share-icon-btn.tg:hover{background:#229ed9;border-color:#229ed9}
.delivery-bar{display:flex;align-items:center;gap:10px;padding:13px 16px;background:linear-gradient(135deg,#e8f5e9,#f0f9f0);border-radius:12px;margin-bottom:16px;font-size:13px;color:var(--g);font-weight:700;border:1px solid rgba(26,58,30,.12)}
.trust-badges{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:18px}
.trust-badge{display:flex;flex-direction:column;align-items:center;gap:5px;padding:12px 6px;background:linear-gradient(160deg,#f8f9f5,#eef1e8);border:1px solid rgba(26,58,30,.09);border-radius:12px;text-align:center;transition:all .22s}
.trust-badge:hover{border-color:rgba(26,58,30,.22);transform:translateY(-2px);box-shadow:0 4px 14px rgba(26,58,30,.09)}
.trust-badge .tb-icon{font-size:22px;line-height:1}
.trust-badge .tb-label{font-size:9.5px;font-weight:700;color:var(--tx2);letter-spacing:.3px;line-height:1.4;text-transform:uppercase}
@media(max-width:480px){.trust-badges{grid-template-columns:repeat(2,1fr)}}
.origin-card{border:1px solid var(--warm-bd);border-radius:var(--radius);overflow:hidden;background:#fff;margin-top:18px}
.origin-header{background:var(--g);color:#fff;padding:10px 16px;font-size:12px;font-weight:800;display:flex;align-items:center;gap:8px;letter-spacing:.3px}
.origin-body{padding:14px 16px;display:flex;gap:14px;align-items:center}
.origin-map{width:60px;height:60px;border-radius:50%;background:var(--g-pale);display:flex;align-items:center;justify-content:center;font-size:32px;flex-shrink:0;border:2px solid var(--bd);overflow:hidden}
.origin-text .origin-region{font-family:'Playfair Display',serif;font-size:14px;font-weight:700;color:var(--g);margin-bottom:3px}
.origin-text p{font-size:12px;color:var(--tx3);line-height:1.6}
.desc-section{max-width:1200px;margin:40px auto 0;padding:0 32px 40px}
@media(max-width:900px){.desc-section{padding:24px 16px 40px}}
.acc-list{display:flex;flex-direction:column;gap:10px}
details.acc-item{background:#fff;border:1.5px solid #ddd8cc;border-radius:16px;overflow:hidden;transition:border-color .25s,box-shadow .25s;box-shadow:0 1px 4px rgba(0,0,0,.04)}
details.acc-item[open]{border-color:#c8920a;box-shadow:0 6px 24px rgba(200,146,10,.12)}
summary.acc-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;cursor:pointer;transition:background .2s;user-select:none;gap:12px;list-style:none}
summary.acc-head::-webkit-details-marker{display:none}
summary.acc-head::marker{display:none}
summary.acc-head:hover{background:linear-gradient(135deg,#fdf9f0,#faf5e8)}
.acc-head-left{display:flex;align-items:center;gap:14px}
.acc-icon-wrap{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#f5ede0,#ede0cc);border:1.5px solid rgba(200,146,10,.22);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .25s}
.acc-icon-wrap svg{width:19px;height:19px;stroke:#8a6030;stroke-width:1.8;fill:none}
details.acc-item[open] .acc-icon-wrap{background:linear-gradient(135deg,#fdf0d8,#f5e0b8);border-color:rgba(200,146,10,.5)}
details.acc-item[open] .acc-icon-wrap svg{stroke:#c8920a}
.acc-title{font-size:14.5px;font-weight:600;color:#1a2a1e}
.acc-chevron{width:28px;height:28px;border-radius:50%;background:#f5ede0;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .3s,background .25s}
details.acc-item[open] .acc-chevron{transform:rotate(180deg);background:#fde8b8}
.acc-body{padding:2px 20px 20px 76px;font-size:14px;color:#1a1a1a;line-height:1.85}
.acc-body p{margin-bottom:8px}
.acc-body ul{padding-left:0;list-style:none;display:flex;flex-direction:column;gap:9px}
.acc-body li{display:flex;align-items:flex-start;gap:10px;font-size:14px;line-height:1.65}
.acc-body li::before{content:'';display:inline-flex;min-width:20px;height:20px;border-radius:50%;background:rgba(200,146,10,.1);border:1.5px solid rgba(200,146,10,.3);flex-shrink:0;margin-top:2px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpolyline points='2,6 5,9 10,3' stroke='%23c8920a' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:center;background-size:12px}
.cert-badges{display:flex;gap:9px;flex-wrap:wrap}
.cert-badge{display:flex;align-items:center;gap:7px;padding:9px 13px;background:rgba(26,58,30,.05);border:1.5px solid rgba(26,58,30,.12);border-radius:10px;font-size:13px;font-weight:600;color:#1a3a1e}
.related-section{max-width:1200px;margin:0 auto;padding:0 28px 40px}
.why-bg{background:linear-gradient(180deg,#faf6ee,#f2eadc);padding:52px 40px;margin-top:40px}
.why-bg .ct{text-align:center;margin-bottom:28px}
.why-bg .chip{display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:var(--gd);border:1px solid rgba(200,146,10,.3);padding:5px 14px;border-radius:20px;margin-bottom:10px}
.why-bg .sh2{font-family:'Playfair Display',serif;font-size:clamp(22px,3.5vw,40px);color:var(--g);font-weight:700;margin-bottom:8px}
.why-bg .ssub{font-size:14px;color:var(--tx2);max-width:560px;margin:0 auto}
.pgr{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;max-width:1150px;margin:0 auto}
.pillar{background:#fff;border-radius:16px;padding:20px 16px 18px;position:relative;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07);display:flex;flex-direction:column;align-items:center;text-align:center;transition:transform .3s,box-shadow .3s}
.pillar:hover{transform:translateY(-6px);box-shadow:0 12px 32px rgba(26,58,30,.15)}
.pillar .pnum{font-size:22px;font-weight:900;color:rgba(26,58,30,.07);position:absolute;top:6px;right:10px;font-family:'Playfair Display',serif}
.pillar .pt{font-size:13px;font-weight:700;color:var(--g);margin-bottom:4px;font-family:'Playfair Display',serif}
.pillar .pd{font-size:11.5px;color:var(--tx3);line-height:1.6;max-width:180px}
@media(max-width:760px){.pgr{grid-template-columns:1fr 1fr}.why-bg{padding:32px 16px}}
      `}</style>
    </>
  )
}

// ─── Data fetcher ──────────────────────────────────────────────────────────────

async function fetchProduct(slug: string): Promise<Product | null> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(`
        id, name, slug, emoji, sku, category_id, state_id, status, unit_label,
        gst_rate, price, mrp, cost_price, available_stock, initial_stock,
        short_description, long_description, image_url, tags,
        badges, is_deleted, created_at,
        ai_description, ai_health_benefits, ai_how_to_use, ai_storage_tips,
        ai_who_should_buy, ai_generated_at,
        categories:categories(id, name, slug),
        states:states(id, name, slug, image_url, image_path),
        product_variants(id, price, mrp, variant_value, sku, available_stock, is_active),
        product_images(id, url, sort_order, alt_text)
      `)
      .eq('slug', slug)
      .eq('is_deleted', false)
      .eq('status', 'active')
      .single()

    if (error || !data) return null

    const raw = data as any
    const badges: string[] = Array.isArray(raw.badges) ? raw.badges : []
    return {
      ...raw,
      badges_bestseller: badges.includes('bestseller'),
      badges_new:        badges.includes('new'),
      badges_organic:    badges.includes('organic'),
      product_variants: (raw.product_variants ?? []).map((v: any) => ({
        ...v,
        size: v.variant_value ?? v.size ?? '',
      })),
      product_images: (raw.product_images ?? []).sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    } as unknown as Product
  } catch { return null }
}

export async function generateStaticParams() {
  let data = null
  try { const r = await supabase.from('products').select('slug').eq('is_deleted', false); data = r.data } catch {}
  return (data || []).map((p: any) => ({ slug: p.slug }))
}
