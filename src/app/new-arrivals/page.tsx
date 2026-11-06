import type { Metadata } from 'next'
import { getStoreData, buildBrowseCategories, getProductsWithImages } from '@/lib/storeData'
import { normalizeProducts, toCardProductData } from '@/lib/normalizeProduct'
import { sortProducts } from '@/lib/filterAndSortProducts'
import { filterNewArrivals, isJustAdded } from '@/lib/newArrivals'
import ProductListingClient from '@/components/product/ProductListingClient'
import { LISTING_PAGE_SIZE } from '@/lib/listingLimits'
import OurPromiseSection from '@/components/homepage/WhySection'

export const revalidate = 180   // was 60: ISR-write budget (Hobby plan); admin edits revalidate on demand

const BASE_PATH = '/new-arrivals'

const SORT_OPTIONS = [
  { value: 'newest',     label: 'Newest First',      icon: '🆕' },
  { value: 'price_asc',  label: 'Price: Low → High', icon: '↑'  },
  { value: 'price_desc', label: 'Price: High → Low', icon: '↓'  },
  { value: 'popular',    label: 'Best Sellers',       icon: '⭐' },
]

// PERF FIX (F-3): see /products/page.tsx — no searchParams in the Server
// Component, so the route is served from the ISR cache; the query string is
// applied client-side. Metadata is static (canonical = clean /new-arrivals).
export async function generateMetadata(): Promise<Metadata> {
  let newCount = 0
  try {
    const storeData = await getStoreData()
    newCount = filterNewArrivals(normalizeProducts(getProductsWithImages(storeData))).length
  } catch { /* description falls back to the generic copy */ }
  return {
    title: 'New Arrivals',   // brand added by the layout's title template
    description: `${newCount} new Himalayan products just added — fresh honey, oils, spices and grains sourced directly from mountain families.`,
    alternates: { canonical: BASE_PATH },
  }
}

export default async function NewArrivalsPage() {
  const storeData = await getStoreData()
  const allCategories = buildBrowseCategories(storeData)
  const allProducts = normalizeProducts(getProductsWithImages(storeData))

  // Base collection — everything that qualifies as a new arrival, before any of the on-page filters.
  const newArrivals = sortProducts(filterNewArrivals(allProducts), 'newest')
  const justAddedCount = newArrivals.filter(p => isJustAdded(p)).length

  // Only show category chips that actually contain a new arrival — an empty
  // "Ghee" filter that returns zero products is worse than not showing it.
  // ?category= is still resolved against ALL categories (Oct 2026 audit), so a
  // valid category with no new arrival shows the honest empty state.
  const categoriesInNew = allCategories.filter(cat =>
    newArrivals.some(p => String(p.category_id) === String(cat.id))
  )
  const lite = (c: { id: number | string; slug: string; name: string }) => ({ id: c.id, slug: c.slug, name: c.name })

  return (
    <div style={{ background: '#f9f4ec', minHeight: '100vh' }}>
      <ProductListingClient
        variant="new-arrivals"
        basePath={BASE_PATH}
        initialProducts={newArrivals.slice(0, LISTING_PAGE_SIZE).map(toCardProductData)}
        totalCount={newArrivals.length}
        allCategories={allCategories.map(lite)}
        sidebarCategories={categoriesInNew.map(lite)}
        sortOptions={SORT_OPTIONS}
        justAddedCount={justAddedCount}
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
