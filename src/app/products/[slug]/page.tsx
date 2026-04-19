import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSiteSettings, isEnabled } from '@/lib/getSiteSettings'
import { formatPrice, savingsPercent, parseJsonArray } from '@/lib/utils'
import type { Product } from '@/types'
import ProductGallery from '@/components/product/ProductGallery'
import AddToCartSection from '@/components/product/AddToCartSection'
import AIContent from '@/components/product/AIContent'
import ReviewsSection from '@/components/product/ReviewsSection'
import RelatedProducts from '@/components/product/RelatedProducts'
import Breadcrumb from '@/components/ui/Breadcrumb'

export const revalidate = 3600 // 1 hour ISR

interface Props { params: { slug: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await fetchProduct(params.slug)
  if (!product) return { title: 'Product Not Found' }

  const desc = product.ai_description
    ? product.ai_description.slice(0, 155)
    : product.short_description?.slice(0, 155) || `Buy ${product.name} online — pure and natural.`

  return {
    title: `${product.name} — Buy Online`,
    description: desc,
    openGraph: {
      title:  `${product.name} | Pahadi Roots`,
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

  const variants       = product.product_variants?.filter(v => v.is_active) || []
  const images         = product.product_images   || []
  const allImages      = images.length > 0
    ? images.map(i => ({ url: i.url, alt: i.alt_text || product.name }))
    : product.image_url ? [{ url: product.image_url, alt: product.name }] : []

  const baseVariant    = variants.length > 0
    ? variants.reduce((min, v) => v.price < min.price ? v : min, variants[0])
    : null
  const displayPrice   = baseVariant?.price ?? product.price
  const displayMRP     = baseVariant?.mrp   ?? product.mrp ?? product.price
  const savings        = savingsPercent(displayMRP, displayPrice)
  const prepaidPct     = parseInt(settings.prepaid_discount_pct || '5')

  const showReviews    = isEnabled(settings.show_reviews_on_pdp)
  const showRelated    = isEnabled(settings.show_related_products)

  // Benefits + how-to parsed from AI fields
  const benefits       = parseJsonArray(product.ai_health_benefits)
  const howToUse       = parseJsonArray(product.ai_how_to_use)
  const storageTips    = parseJsonArray(product.ai_storage_tips)

  // Breadcrumb
  const crumbs = [
    { label: 'Home', href: '/' },
    { label: product.categories?.name || 'Products', href: product.categories ? `/collections/${product.categories.slug}` : '/products' },
    { label: product.name },
  ]

  // JSON-LD product schema
  const jsonLd = {
    '@context':     'https://schema.org',
    '@type':        'Product',
    name:           product.name,
    description:    product.ai_description || product.short_description || '',
    image:          allImages.map(i => i.url),
    sku:            product.sku || product.id,
    brand:          { '@type': 'Brand', name: 'Pahadi Roots' },
    offers: {
      '@type':       'Offer',
      price:          displayPrice,
      priceCurrency: 'INR',
      availability:  product.available_stock > 0
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      url:            `https://pahadiroots.com/products/${product.slug}`,
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">

        {/* Breadcrumb */}
        <Breadcrumb crumbs={crumbs} className="mb-6" />

        {/* Main product section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-14 mb-14">

          {/* Gallery */}
          <ProductGallery images={allImages} productName={product.name} />

          {/* Info panel */}
          <div className="flex flex-col">

            {/* Category + badges */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {product.categories && (
                <a href={`/collections/${product.categories.slug}`}
                  className="text-xs font-semibold text-forest-700 bg-forest-50 hover:bg-forest-100 px-2.5 py-1 rounded-full transition-colors">
                  {product.categories.name}
                </a>
              )}
              {product.badges_bestseller && (
                <span className="text-xs font-bold text-earth-700 bg-earth-50 px-2.5 py-1 rounded-full">
                  🔥 Best Seller
                </span>
              )}
              {product.badges_new && (
                <span className="text-xs font-bold text-forest-700 bg-forest-50 px-2.5 py-1 rounded-full">
                  ✨ New
                </span>
              )}
            </div>

            {/* Title */}
            <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 mb-1 leading-snug">
              {product.emoji && <span className="mr-1.5">{product.emoji}</span>}
              {product.name}
            </h1>

            {/* Short description */}
            {product.short_description && (
              <p className="text-stone-500 text-sm leading-relaxed mb-4">
                {product.short_description}
              </p>
            )}

            {/* Price */}
            <div className="flex items-end gap-3 mb-1">
              <span className="text-3xl font-bold text-stone-900">{formatPrice(displayPrice)}</span>
              {displayMRP > displayPrice && (
                <span className="text-lg text-stone-400 line-through mb-0.5">{formatPrice(displayMRP)}</span>
              )}
              {savings >= 5 && (
                <span className="text-sm font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full mb-0.5">
                  {savings}% off
                </span>
              )}
            </div>

            {/* Prepaid badge */}
            {prepaidPct > 0 && (
              <div className="inline-flex items-center gap-1.5 bg-earth-50 text-earth-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-4 w-fit border border-earth-100">
                💳 Save extra {prepaidPct}% on prepaid payment
              </div>
            )}

            {/* GST note */}
            <p className="text-[11px] text-stone-400 mb-5">
              Inclusive of all taxes · Free delivery above ₹{settings.free_shipping_min || '799'}
            </p>

            {/* Variant + Cart — client component */}
            <AddToCartSection
              product={product}
              variants={variants}
              settings={settings}
            />

            {/* Delivery estimate */}
            <div className="flex items-center gap-2 mt-4 p-3 bg-stone-50 rounded-xl border border-stone-100">
              <span className="text-lg">🚚</span>
              <div>
                <div className="text-xs font-semibold text-stone-700">Estimated Delivery</div>
                <div className="text-xs text-stone-500">3–5 business days across India</div>
              </div>
            </div>

            {/* Trust row */}
            <div className="grid grid-cols-3 gap-2 mt-4">
              {[
                { icon: '🌿', text: '100% Natural' },
                { icon: '🏔️', text: 'Mountain Sourced' },
                { icon: '📦', text: 'Secure Packaging' },
              ].map(item => (
                <div key={item.text} className="flex flex-col items-center text-center p-3 bg-stone-50 rounded-xl border border-stone-100">
                  <span className="text-xl mb-1">{item.icon}</span>
                  <span className="text-[11px] font-medium text-stone-600">{item.text}</span>
                </div>
              ))}
            </div>

          </div>
        </div>

        {/* AI Content tabs */}
        {(product.ai_description || benefits.length > 0 || howToUse.length > 0) && (
          <AIContent
            description={product.ai_description}
            benefits={benefits}
            howToUse={howToUse}
            storageTips={storageTips}
            whoShouldBuy={product.ai_who_should_buy}
          />
        )}

        {/* Reviews */}
        {showReviews && <ReviewsSection productId={product.id} />}

        {/* Related products */}
        {showRelated && product.category_id && (
          <RelatedProducts
            categoryId={product.category_id}
            excludeId={product.id}
          />
        )}

      </div>
    </>
  )
}

// ─── Data fetcher ─────────────────────────────────────────────────────────────

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
        product_variants(id, price, mrp, variant_value, sku, available_stock, is_active),
        product_images(id, url, sort_order, alt_text)
      `)
      .eq('slug', slug)
      .eq('is_deleted', false)
      .eq('is_active', true)
      .single()

    if (error || !data) return null

    // Normalize badges array → boolean flags ProductCard/detail expects
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
    } as unknown as Product
  } catch { return null }
}

// Generate static params for all active products (ISR)
export async function generateStaticParams() {
  let data = null
  try { const r = await supabase.from('products').select('slug').eq('is_deleted', false).eq('is_active', true); data = r.data } catch {}
  return (data || []).map((p: any) => ({ slug: p.slug }))
}
