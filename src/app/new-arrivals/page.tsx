import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getStoreData, buildBrowseCategories, getProductsWithImages } from '@/lib/storeData'
import { normalizeProducts, getEffectivePrice, toCardProductData } from '@/lib/normalizeProduct'
import { filterProducts, sortProducts, paginateProducts, buildPaginationList } from '@/lib/filterAndSortProducts'
import { filterNewArrivals, isJustAdded, NEW_ARRIVAL_WINDOW_DAYS } from '@/lib/newArrivals'
import { buildProductsUrl } from '@/lib/buildProductsUrl'
import { parseBrowseParams, type RawBrowseParams } from '@/lib/browseParams'
import ProductCard from '@/components/product/ProductCard'
import MobileFilterBar from '@/components/product/MobileFilterBar'
import PriceRangeFilter from '@/components/product/PriceRangeFilter'
import { formatPrice } from '@/lib/utils'
import type { Product } from '@/types'

export const revalidate = 60

const PAGE_SIZE = 24
const BASE_PATH = '/new-arrivals'

const SORT_OPTIONS = [
  { value: 'newest',     label: 'Newest First',      icon: '🆕' },
  { value: 'price_asc',  label: 'Price: Low → High', icon: '↑'  },
  { value: 'price_desc', label: 'Price: High → Low', icon: '↓'  },
  { value: 'popular',    label: 'Best Sellers',       icon: '⭐' },
]

type SP = RawBrowseParams
interface Props { searchParams: Promise<SP> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = parseBrowseParams(await searchParams)
  const storeData = await getStoreData()
  const withImgs = getProductsWithImages(storeData)
  const all = normalizeProducts(withImgs)
  const newCount = filterNewArrivals(all).length
  const categories = buildBrowseCategories(storeData)
  const activeCat = categories.find(c => c.slug === sp.category)
  const page = sp.page

  const title = `New Arrivals${activeCat ? ` — ${activeCat.name}` : ''}${page > 1 ? ` — Page ${page}` : ''} | HimVeda by Pahadi Roots`
  const description = `${newCount} new Himalayan products just added — fresh honey, oils, spices and grains sourced directly from mountain families.`

  const params = new URLSearchParams()
  if (sp.category) params.set('category', sp.category)
  if (sp.sort !== 'newest') params.set('sort', sp.sort)
  if (page > 1) params.set('page', String(page))
  if (sp.minPrice != null) params.set('minPrice', String(sp.minPrice))
  if (sp.maxPrice != null) params.set('maxPrice', String(sp.maxPrice))
  const qs = params.toString()

  return {
    title,
    description,
    alternates: { canonical: `${BASE_PATH}${qs ? '?' + qs : ''}` },
    robots: (sp.instock || page > 1 || sp.minPrice != null || sp.maxPrice != null) ? { index: false, follow: true } : undefined,
  }
}

export default async function NewArrivalsPage({ searchParams }: Props) {
  const sp        = parseBrowseParams(await searchParams)
  const storeData = await getStoreData()

  const { sort, category: catSlug, page, instock, minPrice, maxPrice } = sp
  const offset    = (page - 1) * PAGE_SIZE

  const allCategories = buildBrowseCategories(storeData)
  if (catSlug && !allCategories.some(c => c.slug === catSlug)) notFound()

  const withImages = getProductsWithImages(storeData)
  const allProducts = normalizeProducts(withImages)

  // Base collection — everything that qualifies as a new arrival, before
  // any of the on-page filters are applied.
  const newArrivals = filterNewArrivals(allProducts)
  const justAddedCount = newArrivals.filter(p => isJustAdded(p)).length

  // Only show category chips that actually contain a new arrival — an empty
  // "Ghee" filter that returns zero products is worse than not showing it.
  const categoriesInNew = allCategories.filter(cat =>
    newArrivals.some(p => String(p.category_id) === String(cat.id))
  )
  // BUG FIX (Oct 2026 audit): this searched only the chips that have a new arrival. A valid
  // category with none (e.g. ?category=ghee) therefore left activeCat undefined, so the page
  // silently showed EVERY new arrival with no filter, no breadcrumb and a canonical URL pointing
  // at the filtered address (duplicate content). Resolve it against ALL categories so the filter
  // applies and the empty state ("no products match") is shown honestly.
  const activeCat = allCategories.find(c => c.slug === catSlug)

  const baseFilters = { categoryId: activeCat?.id, inStockOnly: instock }
  const preRangeProducts = filterProducts(newArrivals, baseFilters)

  const rawPrices = preRangeProducts.map(getEffectivePrice)
  const priceBounds = rawPrices.length
    ? { min: Math.floor(Math.min(...rawPrices) / 10) * 10, max: Math.max(Math.ceil(Math.max(...rawPrices) / 10) * 10, 10) }
    : { min: 0, max: 1000 }

  let products = filterProducts(preRangeProducts, { minPrice, maxPrice })
  products = sortProducts(products, sort)

  const { pageItems: paged, totalPages, totalCount: count } = paginateProducts(products, page, PAGE_SIZE)
  const paginationItems = buildPaginationList(page, totalPages)

  const urlState = { sort, category: catSlug, state: '', instock, minPrice: minPrice != null ? String(minPrice) : undefined, maxPrice: maxPrice != null ? String(maxPrice) : undefined }
  function url(overrides: Parameters<typeof buildProductsUrl>[1]) {
    return buildProductsUrl(urlState, overrides, BASE_PATH)
  }

  // Past-the-last-page → last real page (see Issue 6.3).
  if (totalPages > 0 && page > totalPages) redirect(url({ page: String(totalPages) }))

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
            {activeCat
              ? <><Link href={BASE_PATH} style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>New Arrivals</Link><span>/</span><span style={{ color: '#fff' }}>{activeCat.name}</span></>
              : <span style={{ color: '#fff' }}>New Arrivals</span>
            }
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <h1 style={{ fontFamily: 'var(--font-playfair),"Playfair Display",serif', fontSize: 'clamp(26px,4vw,44px)',
              fontWeight: 700, color: '#fff', margin: 0, fontStyle: 'italic' }}>
              {activeCat ? activeCat.name : 'New Arrivals'}
            </h1>
            <span style={{ background: 'rgba(201,168,76,.25)', border: '1px solid rgba(201,168,76,.5)',
              borderRadius: '20px', padding: '4px 14px', fontSize: '12px', color: '#f0d080', fontWeight: 700 }}>
              🆕 Just In
            </span>
          </div>
          <p style={{ color: 'rgba(255,255,255,.75)', fontSize: '14px', margin: 0 }}>
            {count} new Himalayan product{count === 1 ? '' : 's'}{activeCat ? ` in ${activeCat.name}` : ''}
            {justAddedCount > 0 ? ` • ${justAddedCount} added this week` : ''} • Sourced from 200+ mountain families
          </p>
        </div>
      </div>

      {/* Category strip */}
      {categoriesInNew.length > 1 && (
        <div style={{ background: '#fff', borderBottom: '1px solid #e8e0d0',
          padding: '12px 40px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: '8px', minWidth: 'max-content' }}>
            <Link href={url({ category: undefined })} style={{ padding: '6px 16px', borderRadius: '20px', fontSize: '12px',
              fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap',
              background: !catSlug ? '#1a3a1e' : 'transparent',
              color: !catSlug ? '#fff' : '#555',
              border: `1.5px solid ${!catSlug ? '#1a3a1e' : '#e0e0e0'}` }}>🆕 All New Arrivals</Link>
            {categoriesInNew.map(cat => (
              <Link key={cat.id} href={url({ category: cat.slug })} style={{
                padding: '6px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
                textDecoration: 'none', whiteSpace: 'nowrap',
                background: cat.slug === catSlug ? '#1a3a1e' : 'transparent',
                color:      cat.slug === catSlug ? '#fff'    : '#555',
                border:     `1.5px solid ${cat.slug === catSlug ? '#1a3a1e' : '#e0e0e0'}`,
              }}>{cat.name}</Link>
            ))}
          </div>
        </div>
      )}

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
              basePath={BASE_PATH}
            />
          </div>

          <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase',
            letterSpacing: '2px', color: '#a07830', marginBottom: '10px' }}>Collections</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '24px' }}>
            <Link href={url({ category: undefined })} style={{
              display: 'block', fontSize: '13px', padding: '7px 10px', borderRadius: '10px',
              textDecoration: 'none', fontWeight: !catSlug ? 700 : 500,
              background: !catSlug ? '#1a3a1e' : 'transparent',
              color: !catSlug ? '#fff' : '#444' }}>
              🆕 All New Arrivals
            </Link>
            {categoriesInNew.map(cat => (
              <Link key={cat.id} href={url({ category: cat.slug })} style={{
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
          {(catSlug || instock || sort !== 'newest' || minPrice != null || maxPrice != null) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#7a7a7a', fontWeight: 600 }}>Filters:</span>
              {activeCat && (
                <Link href={url({ category: undefined })} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: '#1a3a1e', color: '#fff', borderRadius: '20px', padding: '4px 12px',
                  fontSize: '12px', fontWeight: 700, textDecoration: 'none' }}>{activeCat.name} ×</Link>
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
              <Link href={BASE_PATH} style={{ fontSize: '12px', color: '#c8920a', fontWeight: 700, textDecoration: 'underline' }}>
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
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🌱</div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1a3a1e', marginBottom: '8px' }}>
                {newArrivals.length === 0 ? 'No new arrivals right now' : 'No products match your filters'}
              </h3>
              <p style={{ color: '#7a7a7a', fontSize: '14px', marginBottom: '20px', maxWidth: 360 }}>
                {newArrivals.length === 0
                  ? "We're sourcing the next batch from the mountains — check back soon, or browse everything we currently have."
                  : 'Try changing or clearing your filters.'}
              </p>
              <Link href={newArrivals.length === 0 ? '/products' : BASE_PATH} style={{ background: '#1a3a1e', color: '#fff', borderRadius: '20px',
                padding: '10px 24px', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}>
                {newArrivals.length === 0 ? 'Shop All Products' : 'Clear all filters'}
              </Link>
            </div>
          ) : (
            <>
              <div className="prod-page-grid">
                {paged.map((p, i) => <ProductCard key={p.id} product={toCardProductData(p)} priority={i < 4} />)}
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
              <p style={{ fontSize: '11px', color: '#b0b0b0', marginTop: '28px', textAlign: 'center' }}>
                &ldquo;New Arrival&rdquo; = added in the last {NEW_ARRIVAL_WINDOW_DAYS} days, or hand-picked by our team.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Mobile filter/sort drawer */}
      <MobileFilterBar
        categories={categoriesInNew}
        activeCatSlug={catSlug}
        activeStateId=""
        activeStateName={null}
        sort={sort}
        instock={instock}
        count={count}
        sortOptions={SORT_OPTIONS}
        priceBounds={priceBounds}
        priceCurrent={{ min: minPrice ?? priceBounds.min, max: maxPrice ?? priceBounds.max }}
        minPriceParam={minPrice != null ? String(minPrice) : undefined}
        maxPriceParam={maxPrice != null ? String(maxPrice) : undefined}
        basePath={BASE_PATH}
        allLabel="🆕 All New Arrivals"
        clearAllHref={BASE_PATH}
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
