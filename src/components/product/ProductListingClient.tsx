'use client'

// PERF FIX (F-3): everything on /products and /new-arrivals that depends on the
// query string (sort, category, state, in-stock, price range, page) lives here,
// in the browser. The Server Component renders the default list from the ISR
// cache and never reads searchParams, so the route is static again. Markup and
// link building are the same as before — only the data source moved. See
// useBrowseListing.ts for the shared state.
import Link from 'next/link'
import { useMemo } from 'react'
import type { Product } from '@/types'
import { buildProductsUrl } from '@/lib/buildProductsUrl'
import { buildPaginationList } from '@/lib/filterAndSortProducts'
import { toCardProductData } from '@/lib/normalizeProduct'
import { filterNewArrivals, isJustAdded, NEW_ARRIVAL_WINDOW_DAYS } from '@/lib/newArrivals'
import { formatPrice } from '@/lib/utils'
import ProductCard from '@/components/product/ProductCard'
import MobileFilterBar from '@/components/product/MobileFilterBar'
import PriceRangeFilter from '@/components/product/PriceRangeFilter'
import { ProductGridSkeleton } from '@/components/ui/Skeleton'
import SearchParamsBridge from '@/components/ui/SearchParamsBridge'
import { computeListing, isDefaultView, useBrowseParams, useCatalog, usePageOverflowRedirect } from './useBrowseListing'

import { LISTING_PAGE_SIZE } from '@/lib/listingLimits'
export { LISTING_PAGE_SIZE }

export interface CategoryLite { id: number | string; slug: string; name: string }
export interface StateLite    { id: string; name: string }
export interface SortOption   { value: string; label: string; icon: string }

interface Props {
  variant:       'products' | 'new-arrivals'
  basePath:      string
  initialProducts: Product[]
  totalCount:    number
  /** Categories resolvable from ?category= (every active category). */
  allCategories: CategoryLite[]
  /** Categories offered in the sidebar/drawer (new-arrivals: only those with a new arrival). */
  sidebarCategories: CategoryLite[]
  states?:       StateLite[]
  sortOptions:   SortOption[]
  /** new-arrivals hero: "N added this week" (computed server-side from the whole collection). */
  justAddedCount?: number
}

const newArrivalFilter = (p: Product) => filterNewArrivals([p]).length === 1

export default function ProductListingClient({
  variant, basePath, initialProducts, totalCount, allCategories, sidebarCategories, states = [], sortOptions, justAddedCount = 0,
}: Props) {
  const isNew = variant === 'new-arrivals'
  const { params, onChange } = useBrowseParams()
  const { sort, category: catSlug, state: stateId, page, instock, minPrice, maxPrice } = params
  const defaultView = isDefaultView(params)

  const source = useMemo(() => ({
    initialProducts, totalCount, baseFilter: isNew ? newArrivalFilter : undefined,
  }), [initialProducts, totalCount, isNew])
  const { base, loading, failed, prefetch } = useCatalog(source, !defaultView)

  const activeCat   = allCategories.find(c => c.slug === catSlug)
  const activeState = stateId ? states.find(s => String(s.id) === String(stateId)) : undefined
  // An unknown ?category= slug used to 404 on the server. The page is static now, so it shows the
  // honest empty state ("No products found") instead of silently falling through to All Products.
  const unknownCat = Boolean(catSlug && !activeCat)
  // Nov 2026 verification: an unknown ?state= (a removed region, a typo, or any ?state= on /new-arrivals, which offers no
  // region filter) still filtered the list down to nothing while the page title said "All Products", and counted as an
  // active filter (a phantom "1" on the mobile Filters button, a "Filters: Clear all" row with no chip). Same handling as
  // unknownCat: honest empty state, never counted as a filter, plus a visible way back.
  const unknownState = Boolean(stateId && (isNew || !activeState))
  const unknownFilter = unknownCat || unknownState

  const listing = defaultView
    ? computeListing(params, initialProducts, {}, LISTING_PAGE_SIZE, totalCount)
    : computeListing(params, unknownFilter ? [] : base, { categoryId: activeCat?.id, stateId }, LISTING_PAGE_SIZE, totalCount)
  // The default view ships only the first page: the count/pagination come from the server's total.
  const count      = defaultView ? totalCount : listing.count
  const totalPages = defaultView ? Math.ceil(totalCount / LISTING_PAGE_SIZE) : listing.totalPages
  const { paged, priceBounds, offset } = listing
  // Built from the view's real page count (the default view ships one page but may have more).
  const paginationItems = buildPaginationList(page, totalPages)
  const ready = defaultView || Boolean(base) || unknownFilter

  const urlState = { sort, category: catSlug, state: isNew ? '' : stateId, instock, minPrice: minPrice != null ? String(minPrice) : undefined, maxPrice: maxPrice != null ? String(maxPrice) : undefined }
  const url = (overrides: Parameters<typeof buildProductsUrl>[1]) => buildProductsUrl(urlState, overrides, basePath)

  usePageOverflowRedirect(page, totalPages, ready && !loading, url({ page: String(totalPages) }))

  const justAdded = isNew && base ? base.filter(p => isJustAdded(p)).length : justAddedCount
  const baseEmpty = isNew && (base ? base.length === 0 : totalCount === 0)

  const pageTitle = isNew
    ? (activeCat ? activeCat.name : 'New Arrivals')
    : activeState ? `${activeState.name} Products` : activeCat ? activeCat.name : 'All Products'
  const rootLabel = isNew ? 'New Arrivals' : 'All Products'
  const allLabel  = isNew ? '🆕 All New Arrivals' : '🌿 All Products'
  const hasFilters = Boolean(activeCat || (stateId && !unknownState) || instock || sort !== 'newest' || minPrice != null || maxPrice != null)
  const countText = loading ? '…' : String(count)

  const chip = (href: string, label: string, gold = false) => (
    <Link href={href} prefetch={false} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px',
      background: gold ? '#8a6508' : '#1a3a1e', color: '#fff', borderRadius: '20px', padding: '4px 12px',
      fontSize: '12px', fontWeight: 700, textDecoration: 'none' }}>{label}</Link>
  )

  return (
    <>
      <SearchParamsBridge onChange={onChange} />

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
              ? <><Link href={basePath} style={{ color: 'rgba(255,255,255,.6)', textDecoration: 'none' }}>{isNew ? 'New Arrivals' : 'Products'}</Link><span>/</span><span style={{ color: '#fff' }}>{pageTitle}</span></>
              : <span style={{ color: '#fff' }}>{rootLabel}</span>
            }
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <h1 style={{ fontFamily: 'var(--font-playfair),"Playfair Display",serif', fontSize: 'clamp(26px,4vw,44px)',
              fontWeight: 700, color: '#fff', margin: 0, fontStyle: 'italic' }}>
              {pageTitle}
            </h1>
            {isNew && (
              <span style={{ background: 'rgba(201,168,76,.25)', border: '1px solid rgba(201,168,76,.5)',
                borderRadius: '20px', padding: '4px 14px', fontSize: '12px', color: '#f0d080', fontWeight: 700 }}>
                🆕 Just In
              </span>
            )}
          </div>
          <p style={{ color: 'rgba(255,255,255,.75)', fontSize: '14px', margin: 0 }}>
            {isNew
              ? <>{countText} new Himalayan product{count === 1 ? '' : 's'}{activeCat ? ` in ${activeCat.name}` : ''}{justAdded > 0 ? ` • ${justAdded} added this week` : ''} • Sourced directly from mountain families</>
              : <>{countText} natural Himalayan products{activeCat ? ` in ${activeCat.name}` : activeState ? ` from ${activeState.name}` : ''} • Sourced directly from mountain families</>}
          </p>
        </div>
      </div>

      {/* Category strip (new arrivals only) */}
      {isNew && sidebarCategories.length > 1 && (
        <div style={{ background: '#fff', borderBottom: '1px solid #e8e0d0', padding: '12px 40px', overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: '8px', minWidth: 'max-content' }}>
            <Link href={url({ category: undefined })} style={{ padding: '6px 16px', borderRadius: '20px', fontSize: '12px',
              fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap',
              background: !catSlug ? '#1a3a1e' : 'transparent', color: !catSlug ? '#fff' : '#555',
              border: `1.5px solid ${!catSlug ? '#1a3a1e' : '#e0e0e0'}` }}>🆕 All New Arrivals</Link>
            {sidebarCategories.map(cat => (
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
        <aside className="products-sidebar" onPointerEnter={prefetch} onFocusCapture={prefetch}
          style={{ width: '200px', flexShrink: 0, background: '#fff', borderRadius: '20px',
          padding: '18px', position: 'sticky', top: '80px',
          boxShadow: '0 2px 16px rgba(0,0,0,.06)', border: '1px solid rgba(0,0,0,.06)' }}>

          <div style={sectionLabel}>Sort By</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '24px' }}>
            {sortOptions.map(opt => (
              <Link key={opt.value} href={url({ sort: opt.value })} prefetch={false} style={{
                display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px',
                padding: '7px 10px', borderRadius: '10px', textDecoration: 'none',
                fontWeight: sort === opt.value ? 700 : 500,
                background: sort === opt.value ? '#f0f7f1' : 'transparent',
                color: sort === opt.value ? '#1a3a1e' : '#444' }}>
                {opt.icon} {opt.label}
              </Link>
            ))}
          </div>

          <div style={sectionLabel}>Price Range</div>
          <div style={{ marginBottom: '24px' }}>
            <PriceRangeFilter
              key={`${minPrice ?? priceBounds.min}-${maxPrice ?? priceBounds.max}`}
              bounds={priceBounds}
              current={{ min: minPrice ?? priceBounds.min, max: maxPrice ?? priceBounds.max }}
              urlState={urlState}
              basePath={basePath}
            />
          </div>

          <div style={sectionLabel}>Collections</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '24px' }}>
            <Link href={url({ category: undefined, state: undefined })} prefetch={false} style={{
              display: 'block', fontSize: '13px', padding: '7px 10px', borderRadius: '10px',
              textDecoration: 'none', fontWeight: (!catSlug && !stateId) ? 700 : 500,
              background: (!catSlug && !stateId) ? '#1a3a1e' : 'transparent',
              color: (!catSlug && !stateId) ? '#fff' : '#444' }}>
              {allLabel}
            </Link>
            {sidebarCategories.map(cat => (
              <Link key={cat.id} href={url({ category: cat.slug, state: undefined })} prefetch={false} style={{
                display: 'block', fontSize: '13px', padding: '7px 10px', borderRadius: '10px',
                textDecoration: 'none', fontWeight: catSlug === cat.slug ? 700 : 500,
                background: catSlug === cat.slug ? '#1a3a1e' : 'transparent',
                color: catSlug === cat.slug ? '#fff' : '#444' }}>
                {cat.name}
              </Link>
            ))}
          </div>

          <div style={sectionLabel}>Availability</div>
          <Link href={url({ instock: instock ? 'false' : 'true' })} prefetch={false} style={{
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
          {hasFilters && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#5a5448', fontWeight: 600 }}>Filters:</span>
              {activeCat && chip(url({ category: undefined }), `${activeCat.name} ×`)}
              {activeState && chip(url({ state: undefined }), `📍 ${activeState.name} ×`)}
              {instock && chip(url({ instock: 'false' }), 'In Stock ×')}
              {(minPrice != null || maxPrice != null) && chip(url({ minPrice: undefined, maxPrice: undefined }),
                `${formatPrice(minPrice ?? priceBounds.min)}–${formatPrice(maxPrice ?? priceBounds.max)} ×`)}
              {sort !== 'newest' && chip(url({ sort: 'newest' }), `${sortOptions.find(o => o.value === sort)?.label} ×`, true)}
              <Link href={basePath} prefetch={false} style={{ fontSize: '12px', color: '#8a6508', fontWeight: 700, textDecoration: 'underline' }}>
                Clear all
              </Link>
            </div>
          )}

          {/* Mobile: a sticky Filters & Sort bar under the header */}
          <MobileFilterBar
            categories={sidebarCategories}
            activeCatSlug={unknownCat ? '' : catSlug}
            activeStateId={isNew || unknownState ? '' : stateId}
            activeStateName={activeState?.name ?? null}
            sort={sort}
            instock={instock}
            count={count}
            sortOptions={sortOptions}
            priceBounds={priceBounds}
            priceCurrent={{ min: minPrice ?? priceBounds.min, max: maxPrice ?? priceBounds.max }}
            minPriceParam={minPrice != null ? String(minPrice) : undefined}
            maxPriceParam={maxPrice != null ? String(maxPrice) : undefined}
            basePath={basePath}
            allLabel={allLabel}
            clearAllHref={basePath}
          />

          <div style={{ fontSize: '12px', color: '#5a5448', marginBottom: '16px' }}>
            Showing {Math.min(offset + 1, count)}–{Math.min(offset + LISTING_PAGE_SIZE, count)} of {countText} products
          </div>

          {unknownFilter && !loading ? (
            <div data-testid="unknown-filter" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1a3a1e', marginBottom: '8px' }}>No products found</h3>
              <p style={{ color: '#5a5448', fontSize: '14px', marginBottom: '20px', maxWidth: 360 }}>This filter no longer exists.</p>
              <Link href={basePath} style={ctaStyle}>{isNew ? 'Show all new arrivals' : 'Show all products'}</Link>
            </div>
          ) : loading ? (
            <div aria-busy="true" data-testid="listing-loading"><ProductGridSkeleton count={8} /></div>
          ) : failed ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', textAlign: 'center' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1a3a1e', marginBottom: '8px' }}>Couldn&apos;t load these products right now</h3>
              <p style={{ color: '#5a5448', fontSize: '14px', marginBottom: '20px' }}>Please try again in a moment.</p>
              <Link href={basePath} style={ctaStyle}>{isNew ? 'All New Arrivals' : 'All Products'}</Link>
            </div>
          ) : paged.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', padding: '80px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>{isNew ? '🌱' : '🔍'}</div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1a3a1e', marginBottom: '8px' }}>
                {isNew ? (baseEmpty ? 'No new arrivals right now' : 'No products match your filters') : 'No products found'}
              </h3>
              <p style={{ color: '#5a5448', fontSize: '14px', marginBottom: '20px', maxWidth: 360 }}>
                {isNew
                  ? (baseEmpty ? "We're sourcing the next batch from the mountains — check back soon, or browse everything we currently have." : 'Try changing or clearing your filters.')
                  : 'Try changing your filters'}
              </p>
              <Link href={baseEmpty ? '/products' : basePath} style={ctaStyle}>
                {baseEmpty ? 'Shop All Products' : 'Clear all filters'}
              </Link>
            </div>
          ) : (
            <>
              <div className="prod-page-grid">
                {/* Two full rows of the auto-fit grid load eagerly (see the /products image-loading fix). */}
                {paged.map((p, i) => <ProductCard key={p.id} product={toCardProductData(p)} priority={i < (isNew ? 4 : 8)} />)}
              </div>
              {totalPages > 1 && (
                <nav aria-label="Pagination" style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '40px', flexWrap: 'wrap' }}>
                  {page > 1 && <Link href={url({ page: String(page - 1) })} prefetch={false} style={pagStyle(false)}>← Prev</Link>}
                  {paginationItems.map((item, i) =>
                    item === 'ellipsis'
                      ? <span key={`e${i}`} style={{ ...pagStyle(false), border: 'none', background: 'transparent' }}>…</span>
                      : <Link key={item} href={url({ page: String(item) })} prefetch={false} style={pagStyle(item === page)} aria-current={item === page ? 'page' : undefined}>{item}</Link>
                  )}
                  {page < totalPages && <Link href={url({ page: String(page + 1) })} prefetch={false} style={pagStyle(false)}>Next →</Link>}
                </nav>
              )}
              {isNew && (
                <p style={{ fontSize: '11px', color: '#b0b0b0', marginTop: '28px', textAlign: 'center' }}>
                  &ldquo;New Arrival&rdquo; = added in the last {NEW_ARRIVAL_WINDOW_DAYS} days, or hand-picked by our team.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

const sectionLabel: React.CSSProperties = { fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#8a6a1f', marginBottom: '10px' }
const ctaStyle: React.CSSProperties = { background: '#1a3a1e', color: '#fff', borderRadius: '20px', padding: '10px 24px', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }

function pagStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minWidth: '36px', height: '36px', padding: '0 10px', borderRadius: '10px',
    fontSize: '13px', fontWeight: active ? 700 : 500, textDecoration: 'none',
    background: active ? '#1a3a1e' : '#fff', color: active ? '#fff' : '#444',
    border: `1.5px solid ${active ? '#1a3a1e' : '#e0e0e0'}`,
  }
}
