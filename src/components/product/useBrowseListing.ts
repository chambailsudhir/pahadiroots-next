'use client'

// PERF FIX (F-3): shared client-side state for the listing pages (/products,
// /new-arrivals, /collections/[slug]). The server renders the DEFAULT view (no
// query string) from the ISR cache and ships only the first page of cards; the
// query string is applied here, in the browser, with the same pure helpers the
// server used (browseParams / filterAndSortProducts / buildProductsUrl), so the
// URLs and what they show are unchanged. When a filter/sort/page needs products
// the server did not ship, the full card-sized catalogue is fetched once from
// /api/v1/search-catalog (same cached catalogue the search UI and the homepage
// Bestsellers filters use — see BestSellersClient.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Product } from '@/types'
import { parseBrowseParams, type BrowseParams } from '@/lib/browseParams'
import { filterProducts, sortProducts, paginateProducts, buildPaginationList } from '@/lib/filterAndSortProducts'
import { getEffectivePrice } from '@/lib/normalizeProduct'

export const CATALOG_ENDPOINT = '/api/v1/search-catalog'

export interface BrowseSource {
  /** Server-rendered default view: the base collection sorted newest-first, first page only. */
  initialProducts: Product[]
  /** Size of the whole base collection on the server. Equal to initialProducts.length when everything was shipped. */
  totalCount: number
  /** Narrows the fetched catalogue to this page's base collection (a category, the new-arrival rule). */
  baseFilter?: (p: Product) => boolean
}

export function rawFromSearchParams(sp: URLSearchParams) {
  const get = (k: string) => sp.get(k) ?? undefined
  return { sort: get('sort'), category: get('category'), state: get('state'), page: get('page'), instock: get('instock'), minPrice: get('minPrice'), maxPrice: get('maxPrice') }
}

export function isDefaultView(p: BrowseParams): boolean {
  return p.sort === 'newest' && !p.category && !p.state && p.page === 1 && !p.instock && p.minPrice == null && p.maxPrice == null
}

export function useBrowseParams() {
  const [sp, setSp] = useState<URLSearchParams | null>(null)
  const onChange = useCallback((next: URLSearchParams) => setSp(next), [])
  const params = useMemo(() => parseBrowseParams(sp ? rawFromSearchParams(sp) : {}), [sp])
  return { params, onChange }
}

export function useCatalog(source: BrowseSource, wanted: boolean) {
  const [catalog, setCatalog] = useState<Product[] | null>(null)
  const [failed, setFailed] = useState(false)
  const requested = useRef(false)
  const hasAll = source.initialProducts.length >= source.totalCount
  const { baseFilter } = source

  const load = useCallback(() => {
    if (requested.current || hasAll) return
    requested.current = true
    fetch(CATALOG_ENDPOINT)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { products?: Product[] }) => {
        const all = Array.isArray(d.products) ? d.products : []
        setCatalog(baseFilter ? all.filter(baseFilter) : all)
        setFailed(false)
      })
      .catch(() => { requested.current = false; setFailed(true) })
  }, [hasAll, baseFilter])

  useEffect(() => { if (wanted) load() }, [wanted, load])

  return {
    /** The whole base collection when known (shipped or fetched), else null. */
    base: hasAll ? source.initialProducts : catalog,
    loading: wanted && !hasAll && !catalog && !failed,
    failed: wanted && !hasAll && !catalog && failed,
    prefetch: load,
  }
}

export interface BrowseFilters { categoryId?: number | string; stateId?: string }

/** Filter + sort + paginate one view. `base` = whole collection, or null while it is still loading. */
export function computeListing(params: BrowseParams, base: Product[] | null, filters: BrowseFilters, pageSize: number, fallbackTotal: number) {
  const { sort, page, instock, minPrice, maxPrice } = params
  const preRange = base ? filterProducts(base, { categoryId: filters.categoryId, stateId: filters.stateId, inStockOnly: instock }) : []
  const rawPrices = preRange.map(getEffectivePrice)
  const priceBounds = rawPrices.length
    ? { min: Math.floor(Math.min(...rawPrices) / 10) * 10, max: Math.max(Math.ceil(Math.max(...rawPrices) / 10) * 10, 10) }
    : { min: 0, max: 1000 }
  const products = sortProducts(filterProducts(preRange, { minPrice, maxPrice }), sort)
  const { pageItems, totalPages, totalCount } = base
    ? paginateProducts(products, page, pageSize)
    : { pageItems: [] as Product[], totalPages: Math.ceil(fallbackTotal / pageSize), totalCount: fallbackTotal }
  return { paged: pageItems, totalPages, count: totalCount, priceBounds, paginationItems: buildPaginationList(page, totalPages), offset: (page - 1) * pageSize }
}

/** Past-the-last-page → last real page (Issue 6.3), now done in the browser. */
export function usePageOverflowRedirect(page: number, totalPages: number, ready: boolean, target: string) {
  const router = useRouter()
  useEffect(() => {
    if (ready && totalPages > 0 && page > totalPages) router.replace(target, { scroll: false })
  }, [ready, page, totalPages, target, router])
}
