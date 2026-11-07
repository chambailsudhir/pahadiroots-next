import type { Metadata } from 'next'
import { collectionTitle } from '@/lib/collectionTitle'
import { notFound } from 'next/navigation'
import { getStoreData, buildBrowseCategories, getProductsWithImages } from '@/lib/storeData'
import { normalizeProducts, toCardProductData } from '@/lib/normalizeProduct'
import { filterProducts, sortProducts } from '@/lib/filterAndSortProducts'
import CategoryMotif from '@/components/collections/CategoryMotif'
import CollectionListingClient from '@/components/collections/CollectionListingClient'
import ComingLaterCollection from '@/components/collections/ComingLaterCollection'
import { COLLECTION_PAGE_SIZE } from '@/lib/listingLimits'
import Link from 'next/link'
import OurPromiseSection from '@/components/homepage/WhySection'

export const revalidate = 180   // was 60: ISR-write budget (Hobby plan); admin edits revalidate on demand

// PERF FIX (F-3, Nov 2026): this page (and generateMetadata) awaited
// `searchParams`, which makes Next render the route on EVERY request
// (`cache-control: private, no-store`, `x-vercel-cache: MISS` live), so every
// visit and every crawler hit Supabase and `revalidate` above did nothing.
// The Server Component now renders only the default view (newest, page 1, no
// in-stock filter) and is served from the ISR cache; ?sort= / ?instock= /
// ?page= are applied in the browser by CollectionListingClient (same URLs,
// same helpers, same markup). `params` is a route segment, so awaiting it
// keeps the page static.
interface Props {
  params: Promise<{ slug: string }>
}


const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const storeData = await getStoreData()
  const cat = storeData.categories.find(c => c.slug === slug)
  if (!cat) return { title: 'Collection Not Found', robots: { index: false, follow: false } }

  const canonicalUrl = `${BASE}/collections/${slug}`

  // SEO FIX: no canonical previously — with ?sort=/?page=/?instock= all live
  // on this route, Google could index /collections/honey?sort=price_asc and
  // /collections/honey?page=2 as separate near-duplicate pages competing
  // with the real category page. The canonical always points at the clean
  // category URL. (The per-variant `noindex` that used to accompany it read
  // the query string, which is what made the route dynamic — the canonical
  // alone already keeps filtered/paginated variants out of the index; the
  // filtered view is applied client-side now and the HTML is identical.)
  // Nov 2026 audit: an empty collection is a thin page — keep it out of search results until it has products (links still followed).
  const isEmpty = !storeData.products.some(prod => String(prod.category_id) === String(cat.id))

  return {
    // Brand suffix comes from layout.tsx's title.template — do not repeat it here.
    title:       collectionTitle(cat.name),
    description: cat.description || `Shop pure ${cat.name} sourced from the Himalayas.`,
    alternates:  { canonical: canonicalUrl },
    robots:      isEmpty ? { index: false, follow: true } : undefined,
    openGraph: {
      title:       `${cat.name} | HimVeda by Pahadi Roots`,
      description: cat.description || `Shop pure ${cat.name} sourced from the Himalayas.`,
      url:         canonicalUrl,
      type:        'website',
      // BUG FIX: fell back to `[]` (no image at all) when a category has no
      // image_url — same class of bug as page.tsx/blog/products, causing a
      // broken WhatsApp/Facebook share preview for any category without a
      // photo. Falls back to the real logo instead.
      images:      [{ url: cat.image_url || '/og-default.jpg', width: 1200, height: 630, alt: cat.name }],
    },
  }
}

export default async function CollectionPage({ params }: Props) {
  // BUG FIX (sync audit): getSiteSettings() was fetched here and never used
  // anywhere in this file — an unused settings read (and its own Supabase
  // hit / cache entry) on every single category-page load, unlike /products
  // and /products/[slug] which fetch it and actually consume the fields.
  // Removed; nothing else in this file referenced it.
  const [{ slug }, storeData] = await Promise.all([params, getStoreData()])

  // Find category using SERVICE KEY data (no RLS issues)
  const cat = storeData.categories.find(c => c.slug === slug)
  if (!cat) notFound()

  // All categories for the nav bar (apply images same way)
  const allCategories = buildBrowseCategories(storeData)

  // BUG FIX (price mismatch — this page showed a different price than the
  // homepage/products page/admin for the same product): was
  // `applyProductImages(storeData.products, storeData.product_images)`,
  // which never attaches product_variants. getBaseVariant() then always
  // returned null here, so ProductCard fell back to the stale top-level
  // `products.price` column (a leftover from an older pricing-engine run —
  // confirmed live: 714.29, vs the real current price of 800 in
  // products.selling_price / product_variants.price). Every other listing
  // page (new-arrivals, /products, homepage via getNormalizedProducts())
  // already uses this same combined helper — this page was the one
  // outlier still doing the two steps manually and skipping the second one.
  const allProductsWithImages = getProductsWithImages(storeData)
  const allNormalized = normalizeProducts(allProductsWithImages)

  // BUG FIX (Issue 4 of the Oct 2026 audit): this page had its own copy of
  // the In Stock filter and sort. The filter used the raw top-level
  // `available_stock`, which disagrees with the stock ProductCard shows (the
  // base variant's), and the "popular" sort compared only the bestseller badge
  // with no tie-breaker, so equal items had unstable order. /products and
  // /new-arrivals already use the shared helpers; so does this page now.
  const catProducts = sortProducts(filterProducts(allNormalized, { categoryId: cat.id }), 'newest')

  // Default view: first page, card-sized rows only (the client fetches the rest on demand).
  const count    = catProducts.length
  const products = catProducts.slice(0, COLLECTION_PAGE_SIZE).map(toCardProductData)
  const catSlug  = cat.slug
  // Redesign (Nov 2026): an empty collection shows a "coming later" note and the products available now, instead of
  // "0 Products" and an empty sort bar. Same WhatsApp number fallback as layout.tsx.
  const isEmpty   = count === 0
  const available = isEmpty ? sortProducts(allNormalized, 'popular').slice(0, 8).map(toCardProductData) : []
  const waNumber  = String(storeData.settings?.whatsapp_number || '').replace(/\D/g, '') || '919899984895'

  // BUG FIX (Aug 23 2026 — user flagged the collection hero's product photo
  // as still looking wrong, circled on Himalayan Tea): the featured product
  // image approach from Aug 21 traded one problem for another. Several
  // source product photos have letterboxing/black bars baked into the shot
  // itself (visible in the product grid below the hero too) — contained at
  // a fixed 210×210 box, that letterboxing shows up as ugly black rectangles
  // floating in the hero. A decorative element sourced from data we don't
  // fully control (arbitrary product photography) isn't reliable enough to
  // keep shipping. Removed entirely per explicit request — the hero is now
  // deliberately simple: gradient + line-art motif + text, matching the
  // plain, considered look of the /products "All Products" hero, no photo.
  // Also fixed a real color inconsistency flagged in the same message: this
  // hero was using `120deg,#12271a→#1a3a1e→#2d5a35`, a different angle and a
  // darker start stop than every other hero on the site. /products (and
  // BestSellersClient) use `135deg,#1a3a1e 0%,#2d5a35 60%,#3a7042 100%` —
  // this page now matches that exactly, and the dot-pattern opacity (was
  // 0.06 here vs 0.04 on /products) matches too.

  // BUG FIX (Aug 23 2026 — hero was visibly taller than /products' hero for
  // the same amount of content, flagged with a side-by-side comparison):
  // root cause was a structural mismatch, not a tunable number. /products'
  // hero has no fixed height — it's `padding: 40px 40px 36px` and the box
  // sizes itself to whatever content is inside. This page instead forced
  // `height: 320px` and absolutely centered a flex column inside it, so it
  // was always exactly 320px regardless of content — taller than /products
  // for the same title + one line of text. Removed the fixed height and the
  // absolute-center layout; this hero now uses the identical padding-based
  // box as /products, so the two are the same size for the same content.
  // The product-count pill was also its own row before (extra height /products
  // doesn't have) — it now sits inline with the description on one line,
  // the way /products keeps its count line to one row.

  return (
    <div style={{ background: '#f9f4ec', minHeight: '100vh' }}>

      {/* SEO FIX: category pages had zero structured data despite being the
          highest-intent search landing pages on the site (e.g. "buy honey
          online India") — every product page and region page already carries
          BreadcrumbList. Matches the exact pattern + XSS-safe escaping used
          on /regions/[slug]. CollectionPage + ItemList lets Google understand
          this is a product listing, not a generic page. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: cat.name,
            description: cat.description || `Shop pure ${cat.name} sourced from the Himalayas.`,
            url: `${BASE}/collections/${catSlug}`,
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: count,
              itemListElement: products.map((p, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                url: `${BASE}/products/${p.slug}`,
              })),
            },
          })
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026'),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
              { '@type': 'ListItem', position: 2, name: 'Products', item: `${BASE}/products` },
              { '@type': 'ListItem', position: 3, name: cat.name },
            ],
          })
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026'),
        }}
      />

      {/* ── Hero — same box model as /products: padding-based, not fixed-height ── */}
      <div style={{ background: 'linear-gradient(135deg,#1a3a1e 0%,#2d5a35 60%,#3a7042 100%)',
        padding: '40px 40px 36px', position: 'relative', overflow: 'hidden' }}>

        {/* Soft radial glow so a flat gradient doesn't read as a plain block */}
        <div style={{ position: 'absolute', inset: 0,
          background: 'radial-gradient(circle at 15% 30%, rgba(201,168,76,.14), transparent 55%)' }} />
        <div style={{ position: 'absolute', inset: 0, opacity: 0.04,
          backgroundImage: 'radial-gradient(circle at 20% 50%,#fff 1px,transparent 1px)',
          backgroundSize: '28px 28px' }} />
        {/* Bespoke on-brand line-art motif — see CategoryMotif.tsx */}
        <CategoryMotif slug={catSlug} style={{
          position: 'absolute', top: '-60px', right: '-40px', width: '460px', height: '460px',
        }} />

        <div style={{ maxWidth: '1200px', margin: '0 auto', position: 'relative' }}>

          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
            color: 'rgba(255,255,255,.6)', marginBottom: '16px' }}>
            <Link href="/" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Home</Link>
            <span>/</span>
            <Link href="/products" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Products</Link>
            <span>/</span>
            <span style={{ color: '#fff' }}>{cat.name}</span>
          </div>
          <h1 style={{ fontFamily: 'var(--font-playfair),"Playfair Display",serif', fontSize: 'clamp(26px,4vw,44px)',
            fontWeight: 700, color: '#fff', margin: '0 0 8px', fontStyle: 'italic' }}>{cat.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            {cat.description && (
              <p style={{ color: 'rgba(255,255,255,.75)', fontSize: '14px', maxWidth: '520px', margin: 0, lineHeight: 1.6 }}>
                {cat.description}
              </p>
            )}
            {!isEmpty && <span style={{ background: 'rgba(201,168,76,.25)', border: '1px solid rgba(201,168,76,.5)',
              borderRadius: '20px', padding: '4px 14px', fontSize: '12px', color: '#f0d080', fontWeight: 700,
              whiteSpace: 'nowrap' }}>
              {count} Products
            </span>}
          </div>
        </div>
      </div>

      {/* ── Category nav bar ── */}
      {allCategories.length > 1 && (
        <div style={{ background: '#fff', borderBottom: '1px solid #e8e0d0',
          padding: '12px 40px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: '8px', minWidth: 'max-content' }}>
            <Link href="/products" style={{ padding: '6px 16px', borderRadius: '20px', fontSize: '12px',
              fontWeight: 700, textDecoration: 'none', background: '#f0f7f1', color: '#1a3a1e',
              border: '1.5px solid #c8d8ca', whiteSpace: 'nowrap' }}>All</Link>
            {allCategories.map(c => (
              <Link key={c.id} href={`/collections/${c.slug}`} style={{
                padding: '6px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
                textDecoration: 'none', whiteSpace: 'nowrap',
                background: c.slug === catSlug ? '#1a3a1e' : 'transparent',
                color:      c.slug === catSlug ? '#fff'    : '#555',
                border:     `1.5px solid ${c.slug === catSlug ? '#1a3a1e' : '#e0e0e0'}`,
              }}>{c.name}</Link>
            ))}
          </div>
        </div>
      )}

      {/* Sort bar + grid + pagination — applies the query string in the browser (see CollectionListingClient) */}
      {isEmpty ? (
        <ComingLaterCollection categoryName={cat.name} whatsappNumber={waNumber} products={available} />
      ) : (
        <CollectionListingClient
          category={{ id: cat.id, slug: catSlug, name: cat.name }}
          initialProducts={products}
          totalCount={count}
        />
      )}
      {/* "Our Promise — From the Himalayas. With Nothing to Hide." (shared with the homepage). Full-width, so it
          sits outside the padded page shell. Replaces the old per-page "Why HimVeda by Pahadi Roots" block. */}
      <OurPromiseSection />
    </div>
  )
}


export async function generateStaticParams() {
  try {
    const sd = await getStoreData()
    return sd.categories.map(c => ({ slug: c.slug }))
  } catch { return [] }
}
