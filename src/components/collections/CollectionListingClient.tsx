'use client'

// PERF FIX (F-3): the sort bar, In-Stock toggle and pagination on
// /collections/[slug] depend on the query string. Reading it in the Server
// Component made every category page dynamic (no ISR). The server now renders
// the default list and this component applies ?sort= / ?instock= / ?page= in
// the browser — same links, same markup. See useBrowseListing.ts.
import Link from 'next/link'
import { useMemo } from 'react'
import type { Product } from '@/types'
import { toCardProductData } from '@/lib/normalizeProduct'
import ProductCard from '@/components/product/ProductCard'
import { ProductGridSkeleton } from '@/components/ui/Skeleton'
import SearchParamsBridge from '@/components/ui/SearchParamsBridge'
import { computeListing, isDefaultView, useBrowseParams, useCatalog, usePageOverflowRedirect } from '@/components/product/useBrowseListing'

import { COLLECTION_PAGE_SIZE } from '@/lib/listingLimits'
export { COLLECTION_PAGE_SIZE }

const SORT_OPTIONS = [
  { value: 'newest',     label: 'Newest' },
  { value: 'price_asc',  label: 'Price ↑' },
  { value: 'price_desc', label: 'Price ↓' },
  { value: 'popular',    label: 'Best Sellers' },
]

interface Props {
  category:        { id: number | string; slug: string; name: string }
  initialProducts: Product[]
  totalCount:      number
}

export function collectionUrl(catSlug: string, current: { sort: string; instock: boolean }, overrides: Record<string, string | undefined>) {
  const p = new URLSearchParams()
  const vals: Record<string, string | undefined> = { sort: current.sort, instock: current.instock ? 'true' : undefined, page: '1', ...overrides }
  // 'false' is how the toggle link says "turn off" — never emit it (Issue 6.4).
  if (vals.instock !== 'true') vals.instock = undefined
  if (vals.sort === 'newest') vals.sort = undefined
  if (vals.page === '1') vals.page = undefined
  Object.entries(vals).forEach(([k, v]) => { if (v) p.set(k, v) })
  const q = p.toString()
  return `/collections/${catSlug}${q ? '?' + q : ''}`
}

/** Sort bar + grid + pagination (everything below the hero/nav, which the server page renders). */
export default function CollectionListingClient({ category, initialProducts, totalCount }: Props) {
  const { params, onChange } = useBrowseParams()
  const { sort, page, instock } = params
  const defaultView = isDefaultView(params)
  const catId = String(category.id)
  const source = useMemo(() => ({
    initialProducts, totalCount, baseFilter: (p: Product) => String(p.category_id) === catId,
  }), [initialProducts, totalCount, catId])
  const { base, loading, failed, prefetch } = useCatalog(source, !defaultView)

  const listing = computeListing(params, defaultView ? initialProducts : base, {}, COLLECTION_PAGE_SIZE, totalCount)
  const count      = defaultView ? totalCount : listing.count
  const totalPages = defaultView ? Math.ceil(totalCount / COLLECTION_PAGE_SIZE) : listing.totalPages
  const { paged: products, offset } = listing
  const catSlug = category.slug
  const url = (overrides: Record<string, string | undefined>) => collectionUrl(catSlug, { sort, instock }, overrides)

  usePageOverflowRedirect(page, totalPages, (defaultView || Boolean(base)) && !loading, url({ page: String(totalPages) }))

  const countText = loading ? '…' : String(count)

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 20px 60px' }}>
      <SearchParamsBridge onChange={onChange} />

      {/* Sort bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center',
        justifyContent: 'space-between', gap: '12px', marginBottom: '20px' }}>
        {/* Nov 2026 audit (F-5 / L6): #5a5448 was 3.9:1 on the #f9f4ec page background; #5a5448 is 6.9:1. "1 products" pluralised. */}
        <p style={{ fontSize: '13px', color: '#5a5448', margin: 0 }}>
          {countText} {count === 1 ? 'product' : 'products'} • Showing {Math.min(offset + 1, count)}–{Math.min(offset + COLLECTION_PAGE_SIZE, count)}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }} onPointerEnter={prefetch} onFocusCapture={prefetch}>
          <Link href={url({ instock: instock ? 'false' : 'true' })} style={{
            fontSize: '12px', fontWeight: 700, padding: '7px 14px', borderRadius: '20px',
            border: '1.5px solid', textDecoration: 'none',
            background: instock ? '#1a3a1e' : '#fff', color: instock ? '#fff' : '#555',
            borderColor: instock ? '#1a3a1e' : '#ddd' }}>In Stock</Link>
          {SORT_OPTIONS.map(opt => (
            <Link key={opt.value} href={url({ sort: opt.value })} style={{
              fontSize: '12px', fontWeight: 700, padding: '7px 14px', borderRadius: '20px',
              border: '1.5px solid', textDecoration: 'none',
              // F-5: white on #8a6508 was 2.8:1; the darker brand gold #8a6508 (globals.css --pm-gold-text) is 5.3:1.
              background: sort === opt.value ? '#8a6508' : '#fff',
              color:      sort === opt.value ? '#fff'    : '#555',
              borderColor: sort === opt.value ? '#8a6508' : '#ddd' }}>
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div aria-busy="true" data-testid="listing-loading"><ProductGridSkeleton count={8} /></div>
      ) : failed ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '80px 20px', textAlign: 'center' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1a3a1e', marginBottom: '8px' }}>Couldn&apos;t load these products right now</h3>
          <Link href={`/collections/${catSlug}`} style={ctaStyle}>Show all {category.name}</Link>
        </div>
      ) : products.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '80px 20px', textAlign: 'center' }}>
          {/* "Clear filters" only when a filter is actually narrowing the list (Nov 2026 audit). */}
          {instock ? (
            <>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1a3a1e', marginBottom: '8px' }}>
                No in-stock products here right now
              </h3>
              <Link href={`/collections/${catSlug}`} style={ctaStyle}>Clear filters</Link>
            </>
          ) : (
            <>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1a3a1e', marginBottom: '8px' }}>
                {category.name} is coming soon
              </h3>
              <p style={{ fontSize: '14px', color: '#5a5448', margin: '0 0 4px', maxWidth: '420px' }}>
                We are still sourcing this range from the mountains. Meanwhile, explore what is available now.
              </p>
              <Link href="/products" style={ctaStyle}>Browse all products</Link>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="prod-page-grid">
            {products.map((p, i) => <ProductCard key={p.id} product={toCardProductData(p)} priority={i < 4} />)}
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '40px', flexWrap: 'wrap' }}>
              {page > 1 && <Link href={url({ page: String(page - 1) })} style={pagStyle(false)}>← Prev</Link>}
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(pg => (
                <Link key={pg} href={url({ page: String(pg) })} style={pagStyle(pg === page)}>{pg}</Link>
              ))}
              {page < totalPages && <Link href={url({ page: String(page + 1) })} style={pagStyle(false)}>Next →</Link>}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const ctaStyle: React.CSSProperties = { background: '#1a3a1e', color: '#fff', borderRadius: '20px', padding: '10px 24px',
  fontSize: '13px', fontWeight: 700, textDecoration: 'none', marginTop: '12px', display: 'inline-block' }

function pagStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minWidth: '36px', height: '36px', padding: '0 10px', borderRadius: '10px',
    fontSize: '13px', fontWeight: active ? 700 : 500, textDecoration: 'none',
    background: active ? '#1a3a1e' : '#fff', color: active ? '#fff' : '#444',
    border: `1.5px solid ${active ? '#1a3a1e' : '#e0e0e0'}`,
  }
}
