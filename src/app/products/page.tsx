import type { Metadata } from 'next'
import Link from 'next/link'
import { getStoreData, buildCategories, getProductsWithImages } from '@/lib/storeData'
import { normalizeProducts, getEffectivePrice } from '@/lib/normalizeProduct'
import { filterProducts, sortProducts, paginateProducts, buildPaginationList } from '@/lib/filterAndSortProducts'
import { buildProductsUrl } from '@/lib/buildProductsUrl'
import ProductCard from '@/components/product/ProductCard'
import MobileFilterBar from '@/components/product/MobileFilterBar'
import PriceRangeFilter from '@/components/product/PriceRangeFilter'
import { formatPrice } from '@/lib/utils'
import type { Product } from '@/types'

export const revalidate = 60

const PAGE_SIZE = 24

const SORT_OPTIONS = [
  { value: 'newest',     label: 'Newest First',       icon: '🆕' },
  { value: 'price_asc',  label: 'Price: Low → High',  icon: '↑'  },
  { value: 'price_desc', label: 'Price: High → Low',  icon: '↓'  },
  { value: 'popular',    label: 'Best Sellers',        icon: '⭐' },
]

interface SP { sort?: string; category?: string; page?: string; instock?: string; state?: string; minPrice?: string; maxPrice?: string }

// BUG FIX (Next.js 15+/16 migration — CRITICAL, newly found during this pass):
// `searchParams` is a Promise in Next.js 15+/16 (every other dynamic page in
// this codebase — /products/[slug], /collections/[slug] — already awaits it).
// This page was still destructuring it as a plain synchronous object:
//   const sort = searchParams.sort || 'newest'
// Reading a property off a Promise returns undefined, so every one of these
// silently fell back to its default on EVERY request, regardless of the
// actual URL: category filter, state filter, sort order, in-stock toggle,
// and pagination were all completely non-functional — clicking any sidebar
// link changed the URL but never changed what rendered. No error was thrown
// because Promise simply doesn't have a `.sort`/`.category`/etc property, so
// this shipped silently. Fixed by awaiting searchParams like every other page.
interface Props { searchParams: Promise<SP> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams
  const storeData = await getStoreData()
  const categories = buildCategories(storeData)
  const activeCat = categories.find(c => c.slug === (sp.category || ''))
  const activeState = sp.state
    ? (storeData.states || []).find((s: any) => String(s.id) === String(sp.state))
    : null
  const page = Math.max(1, parseInt(sp.page || '1'))

  // BUG FIX (SEO — newly found): metadata was a static export, so every
  // category, state, sort, and page URL served an identical title/description.
  // Now built per-filter-combination, with a canonical that reflects the
  // actual filtered/paginated URL so duplicate-content variants don't compete
  // with each other in search results.
  const base = activeState ? `${activeState.name} Products`
    : activeCat ? activeCat.name
    : 'All Products'
  const pageSuffix = page > 1 ? ` — Page ${page}` : ''
  const title = `${base}${pageSuffix} — Natural Himalayan Foods | Pahadi Roots`
  const description = activeCat
    ? `Shop ${activeCat.name} — natural Himalayan ${activeCat.name.toLowerCase()} sourced directly from mountain families.`
    : activeState
    ? `Shop natural Himalayan products sourced from ${activeState.name}.`
    : 'Browse our complete range of natural Himalayan products — honey, spices, grains, oils and more.'

  const params = new URLSearchParams()
  if (sp.category) params.set('category', sp.category)
  if (sp.state)    params.set('state', sp.state)
  if (sp.sort && sp.sort !== 'newest') params.set('sort', sp.sort)
  if (page > 1)    params.set('page', String(page))
  if (sp.minPrice) params.set('minPrice', sp.minPrice)
  if (sp.maxPrice) params.set('maxPrice', sp.maxPrice)
  const qs = params.toString()

  return {
    title,
    description,
    alternates: { canonical: `/products${qs ? '?' + qs : ''}` },
    // Filtered/paginated combinations are useful to users but shouldn't
    // compete with the canonical category page in search results.
    robots: (sp.instock === 'true' || page > 1 || sp.minPrice || sp.maxPrice) ? { index: false, follow: true } : undefined,
  }
}

export default async function ProductsPage({ searchParams }: Props) {
  const sp        = await searchParams
  const storeData = await getStoreData()

  const sort      = sp.sort     || 'newest'
  const catSlug   = sp.category || ''
  const stateId   = sp.state    || ''
  const page      = Math.max(1, parseInt(sp.page || '1'))
  const instock   = sp.instock  === 'true'
  const minPrice  = sp.minPrice ? Number(sp.minPrice) : undefined
  const maxPrice  = sp.maxPrice ? Number(sp.maxPrice) : undefined
  const offset    = (page - 1) * PAGE_SIZE

  const categories  = buildCategories(storeData)
  const activeCat   = categories.find(c => c.slug === catSlug)

  // Resolve state name for display
  const activeState = stateId
    ? (storeData.states || []).find((s: any) => String(s.id) === String(stateId))
    : null

  // BUG FIX (data/pricing integrity): was applyProductImages() called
  // directly, which never attaches product_variants — see getStoreData.ts.
  // getProductsWithImages() now also merges variants, so cards here show the
  // same lowest-active-variant price the PDP shows, and price sort below
  // sorts on that same effective price instead of possibly-stale top-level
  // product.price.
  const withImages  = getProductsWithImages(storeData)
  let   products    = normalizeProducts(withImages)

  // Filter + sort — extracted to lib/filterAndSortProducts.ts (see BUG FIX
  // comment there: this logic used to live inline in this Server Component,
  // which is why it had zero test coverage — it's unit tested directly now).
  const baseFilters = { categoryId: activeCat?.id, stateId, inStockOnly: instock }
  const preRangeProducts = filterProducts(products, baseFilters)

  // Price-range slider bounds — computed from the category/state/in-stock
  // filtered set (not the price filter itself), rounded to nearest ₹10 so
  // the slider has clean endpoints. Falls back to a sane 0–1000 range on an
  // empty result so the slider never divides by zero.
  const rawPrices  = preRangeProducts.map(getEffectivePrice)
  const priceBounds = rawPrices.length
    ? { min: Math.floor(Math.min(...rawPrices) / 10) * 10, max: Math.max(Math.ceil(Math.max(...rawPrices) / 10) * 10, 10) }
    : { min: 0, max: 1000 }

  products = filterProducts(preRangeProducts, { minPrice, maxPrice })
  products = sortProducts(products, sort)

  const { pageItems: paged, totalPages, totalCount: count } = paginateProducts(products, page, PAGE_SIZE)
  const paginationItems = buildPaginationList(page, totalPages)

  const urlState = { sort, category: catSlug, state: stateId, instock, minPrice: sp.minPrice, maxPrice: sp.maxPrice }
  function url(overrides: Parameters<typeof buildProductsUrl>[1]) {
    return buildProductsUrl(urlState, overrides)
  }

  const pageTitle = activeState ? `${activeState.name} Products`
    : activeCat ? activeCat.name
    : 'All Products'

  return (
    <div style={{ background: '#f9f4ec', minHeight: '100vh' }}>

      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg,#1a3a1e 0%,#2d5a35 60%,#3a7042 100%)',
        padding: '40px 40px 36px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.04,
          backgroundImage: 'radial-gradient(circle at 20% 50%,#fff 1px,transparent 1px)',
          backgroundSize: '30px 30px' }} />
        <div style={{ maxWidth: '1400px', margin: '0 auto', position: 'relative' }}>
          <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px',
            color: 'rgba(255,255,255,.6)', marginBottom: '16px' }}>
            <Link href="/" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Home</Link>
            <span>/</span>
            {(activeCat || activeState)
              ? <><Link href="/products" style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>Products</Link><span>/</span><span style={{ color: '#fff' }}>{pageTitle}</span></>
              : <span style={{ color: '#fff' }}>All Products</span>
            }
          </nav>
          <h1 style={{ fontFamily: '"Playfair Display",serif', fontSize: 'clamp(26px,4vw,44px)',
            fontWeight: 700, color: '#fff', margin: '0 0 8px', fontStyle: 'italic' }}>
            {pageTitle}
          </h1>
          <p style={{ color: 'rgba(255,255,255,.75)', fontSize: '14px', margin: 0 }}>
            {count} natural Himalayan products{activeCat ? ` in ${activeCat.name}` : activeState ? ` from ${activeState.name}` : ''} • Sourced from 200+ mountain families
          </p>
        </div>
      </div>

      {/* Main layout — full width with sticky sidebar */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px 40px 60px',
        display: 'flex', gap: '24px', alignItems: 'flex-start' }}>

        {/* ── Sidebar (desktop only — mobile uses MobileFilterBar below) ── */}
        <aside className="products-sidebar" style={{ width: '200px', flexShrink: 0, background: '#fff', borderRadius: '20px',
          padding: '18px', position: 'sticky', top: '80px',
          boxShadow: '0 2px 16px rgba(0,0,0,.06)', border: '1px solid rgba(0,0,0,.06)' }}>

          <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase',
            letterSpacing: '2px', color: '#a07830', marginBottom: '10px' }}>Sort By</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '24px' }}>
            {SORT_OPTIONS.map(opt => (
              <Link key={opt.value} href={url({ sort: opt.value })} style={{
                display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px',
                padding: '7px 10px', borderRadius: '10px', textDecoration: 'none',
                fontWeight: sort === opt.value ? 700 : 500,
                background: sort === opt.value ? '#f0f7f1' : 'transparent',
                color: sort === opt.value ? '#1a3a1e' : '#444' }}>
                {opt.icon} {opt.label}
              </Link>
            ))}
          </div>

          <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase',
            letterSpacing: '2px', color: '#a07830', marginBottom: '10px' }}>Price Range</div>
          <div style={{ marginBottom: '24px' }}>
            <PriceRangeFilter
              key={`${minPrice ?? priceBounds.min}-${maxPrice ?? priceBounds.max}`}
              bounds={priceBounds}
              current={{ min: minPrice ?? priceBounds.min, max: maxPrice ?? priceBounds.max }}
              urlState={urlState}
            />
          </div>

          <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase',
            letterSpacing: '2px', color: '#a07830', marginBottom: '10px' }}>Collections</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '24px' }}>
            <Link href={url({ category: undefined, state: undefined })} style={{
              display: 'block', fontSize: '13px', padding: '7px 10px', borderRadius: '10px',
              textDecoration: 'none', fontWeight: (!catSlug && !stateId) ? 700 : 500,
              background: (!catSlug && !stateId) ? '#1a3a1e' : 'transparent',
              color: (!catSlug && !stateId) ? '#fff' : '#444' }}>
              🌿 All Products
            </Link>
            {categories.map(cat => (
              <Link key={cat.id} href={url({ category: cat.slug, state: undefined })} style={{
                display: 'block', fontSize: '13px', padding: '7px 10px', borderRadius: '10px',
                textDecoration: 'none', fontWeight: catSlug === cat.slug ? 700 : 500,
                background: catSlug === cat.slug ? '#1a3a1e' : 'transparent',
                color: catSlug === cat.slug ? '#fff' : '#444' }}>
                {cat.name}
              </Link>
            ))}
          </div>

          <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase',
            letterSpacing: '2px', color: '#a07830', marginBottom: '10px' }}>Availability</div>
          <Link href={url({ instock: instock ? 'false' : 'true' })} style={{
            display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px',
            padding: '7px 10px', borderRadius: '10px', textDecoration: 'none',
            background: instock ? '#1a3a1e' : 'transparent', color: instock ? '#fff' : '#444' }}>
            <span style={{ width: '16px', height: '16px', border: `2px solid ${instock ? '#fff' : '#999'}`,
              borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {instock && <span style={{ color: '#fff', fontSize: '10px' }}>✓</span>}
            </span>
            In Stock Only
          </Link>
        </aside>

        {/* ── Product grid ── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Active filters */}
          {(catSlug || stateId || instock || sort !== 'newest' || minPrice != null || maxPrice != null) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#7a7a7a', fontWeight: 600 }}>Filters:</span>
              {activeCat && (
                <Link href={url({ category: undefined })} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: '#1a3a1e', color: '#fff', borderRadius: '20px', padding: '4px 12px',
                  fontSize: '12px', fontWeight: 700, textDecoration: 'none' }}>{activeCat.name} ×</Link>
              )}
              {activeState && (
                <Link href={url({ state: undefined })} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: '#1a3a1e', color: '#fff', borderRadius: '20px', padding: '4px 12px',
                  fontSize: '12px', fontWeight: 700, textDecoration: 'none' }}>📍 {activeState.name} ×</Link>
              )}
              {instock && (
                <Link href={url({ instock: 'false' })} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: '#1a3a1e', color: '#fff', borderRadius: '20px', padding: '4px 12px',
                  fontSize: '12px', fontWeight: 700, textDecoration: 'none' }}>In Stock ×</Link>
              )}
              {(minPrice != null || maxPrice != null) && (
                <Link href={url({ minPrice: undefined, maxPrice: undefined })} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: '#1a3a1e', color: '#fff', borderRadius: '20px', padding: '4px 12px',
                  fontSize: '12px', fontWeight: 700, textDecoration: 'none' }}>
                  {formatPrice(minPrice ?? priceBounds.min)}–{formatPrice(maxPrice ?? priceBounds.max)} ×
                </Link>
              )}
              {sort !== 'newest' && (
                <Link href={url({ sort: 'newest' })} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: '#c8920a', color: '#fff', borderRadius: '20px', padding: '4px 12px',
                  fontSize: '12px', fontWeight: 700, textDecoration: 'none' }}>
                  {SORT_OPTIONS.find(o => o.value === sort)?.label} ×
                </Link>
              )}
              <Link href="/products" style={{ fontSize: '12px', color: '#c8920a', fontWeight: 700, textDecoration: 'underline' }}>
                Clear all
              </Link>
            </div>
          )}

          <div style={{ fontSize: '12px', color: '#9a9a9a', marginBottom: '16px' }}>
            Showing {Math.min(offset + 1, count)}–{Math.min(offset + PAGE_SIZE, count)} of {count} products
          </div>

          {paged.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', padding: '80px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1a3a1e', marginBottom: '8px' }}>No products found</h3>
              <p style={{ color: '#7a7a7a', fontSize: '14px', marginBottom: '20px' }}>Try changing your filters</p>
              <Link href="/products" style={{ background: '#1a3a1e', color: '#fff', borderRadius: '20px',
                padding: '10px 24px', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>
                Clear all filters
              </Link>
            </div>
          ) : (
            <>
              <div className="prod-page-grid">
                {paged.map((p, i) => <ProductCard key={p.id} product={p} priority={i < 4} />)}
              </div>
              {totalPages > 1 && (
                <nav aria-label="Pagination" style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '40px', flexWrap: 'wrap' }}>
                  {page > 1 && <Link href={url({ page: String(page - 1) })} style={pagStyle(false)}>← Prev</Link>}
                  {paginationItems.map((item, i) =>
                    item === 'ellipsis'
                      ? <span key={`e${i}`} style={{ ...pagStyle(false), border: 'none', background: 'transparent' }}>…</span>
                      : <Link key={item} href={url({ page: String(item) })} style={pagStyle(item === page)} aria-current={item === page ? 'page' : undefined}>{item}</Link>
                  )}
                  {page < totalPages && <Link href={url({ page: String(page + 1) })} style={pagStyle(false)}>Next →</Link>}
                </nav>
              )}
            </>
          )}
        </div>
      </div>

      {/* Mobile filter/sort drawer — BUG FIX: replaces the sidebar that used
          to just vanish below 768px with no alternative at all. */}
      <MobileFilterBar
        categories={categories}
        activeCatSlug={catSlug}
        activeStateId={stateId}
        activeStateName={activeState?.name ?? null}
        sort={sort}
        instock={instock}
        count={count}
        sortOptions={SORT_OPTIONS}
        priceBounds={priceBounds}
        priceCurrent={{ min: minPrice ?? priceBounds.min, max: maxPrice ?? priceBounds.max }}
        minPriceParam={sp.minPrice}
        maxPriceParam={sp.maxPrice}
      />

      <style>{`
        @media(max-width:768px){
          .products-sidebar { display: none !important; }
          body { padding-bottom: 76px; }
        }
      `}</style>
    </div>
  )
}

function pagStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minWidth: '36px', height: '36px', padding: '0 10px', borderRadius: '10px',
    fontSize: '13px', fontWeight: active ? 700 : 500, textDecoration: 'none',
    background: active ? '#1a3a1e' : '#fff', color: active ? '#fff' : '#444',
    border: `1.5px solid ${active ? '#1a3a1e' : '#e0e0e0'}`,
  }
}
