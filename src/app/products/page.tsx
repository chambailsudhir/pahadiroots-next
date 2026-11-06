import type { Metadata } from 'next'
import { getStoreData, buildBrowseCategories, getProductsWithImages } from '@/lib/storeData'
import { normalizeProducts, toCardProductData } from '@/lib/normalizeProduct'
import { sortProducts } from '@/lib/filterAndSortProducts'
import ProductListingClient from '@/components/product/ProductListingClient'
import { LISTING_PAGE_SIZE } from '@/lib/listingLimits'
import OurPromiseSection from '@/components/homepage/WhySection'

export const revalidate = 180   // was 60: ISR-write budget (Hobby plan); admin edits revalidate on demand

const SORT_OPTIONS = [
  { value: 'newest',     label: 'Newest First',       icon: '🆕' },
  { value: 'price_asc',  label: 'Price: Low → High',  icon: '↑'  },
  { value: 'price_desc', label: 'Price: High → Low',  icon: '↓'  },
  { value: 'popular',    label: 'Best Sellers',        icon: '⭐' },
]

// PERF FIX (F-3, Nov 2026 — "slow collection page" / Vercel CPU budget): this
// page (and generateMetadata) awaited `searchParams`, which makes Next render
// the route on EVERY request — `cache-control: private, no-store`,
// `x-vercel-cache: MISS` live — so every visit and every crawler hit Supabase
// and the `revalidate` above did nothing. The Server Component now renders only
// the default view (no query string) from the cached catalogue and is served
// from the ISR cache; sort/category/state/in-stock/price/page from the query
// string are applied in the browser by ProductListingClient (same URLs, same
// helpers, same markup). Metadata is static for the same reason: the canonical
// is always the clean /products URL, so filtered variants (which /collections
// already handles this way) never compete with it in search.
export const metadata: Metadata = {
  title: 'All Products — Natural Himalayan Foods',   // the layout's title template appends the brand
  description: 'Browse our complete range of natural Himalayan products — honey, spices, grains, oils and more.',
  alternates: { canonical: '/products' },
}

export default async function ProductsPage() {
  const storeData = await getStoreData()

  const categories = buildBrowseCategories(storeData)
  // getProductsWithImages() also merges variants, so cards show the same
  // lowest-active-variant price the PDP shows (see storeData.ts).
  const all = sortProducts(normalizeProducts(getProductsWithImages(storeData)), 'newest')
  // Only the first page of card-sized rows goes into the HTML; the client fetches the rest on demand.
  const firstPage = all.slice(0, LISTING_PAGE_SIZE).map(toCardProductData)

  return (
    <div style={{ background: '#f9f4ec', minHeight: '100vh' }}>
      <ProductListingClient
        variant="products"
        basePath="/products"
        initialProducts={firstPage}
        totalCount={all.length}
        allCategories={categories.map(c => ({ id: c.id, slug: c.slug, name: c.name }))}
        sidebarCategories={categories.map(c => ({ id: c.id, slug: c.slug, name: c.name }))}
        states={(storeData.states || []).map(s => ({ id: String(s.id), name: s.name }))}
        sortOptions={SORT_OPTIONS}
      />

      <style>{`
        @media(max-width:768px){
          .products-sidebar { display: none !important; }
          body { padding-bottom: 76px; }
        }
      `}</style>
      {/* "Our Promise — From the Himalayas. With Nothing to Hide." (shared with the homepage). Full-width, so it
          sits outside the padded page shell. Replaces the old per-page "Why HimVeda by Pahadi Roots" block. */}
      <OurPromiseSection />
    </div>
  )
}
