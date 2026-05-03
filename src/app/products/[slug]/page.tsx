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
    </>
  )
}

// ─── Data fetcher ──────────────────────────────────────────────────────────────

async function fetchProduct(slug: string): Promise<Product | null> {
  try {
    // Same query as original — NO states join (avoids FK failure if relationship not set up)
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

    // Fetch state separately — avoids breaking if FK not configured in Supabase
    let stateData: any = null
    if (raw.state_id) {
      try {
        const { data: sd } = await supabase
          .from('states')
          .select('id, name, slug, image_url, image_path')
          .eq('id', raw.state_id)
          .single()
        stateData = sd
      } catch { /* state is optional */ }
    }

    return {
      ...raw,
      states: stateData,
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
