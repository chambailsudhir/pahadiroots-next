import type { Product } from '@/types'
import { getEffectivePrice, getEffectiveStock } from '@/lib/normalizeProduct'

// BUG FIX (low-severity — zero test coverage, found during products-page
// audit): the filter/sort logic for /products used to live inline inside an
// async Server Component that calls getStoreData() (Supabase) directly, so
// it could only be exercised by rendering the whole page against a real (or
// heavily mocked) database — nobody had written that harness, hence zero
// tests existed for filtering, sorting, or the interaction between them.
// Extracted here as plain, dependency-free functions so they can be (and now
// are, see filterAndSortProducts.test.ts) unit tested directly.

export interface ProductFilters {
  categoryId?: number | string
  stateId?:    string
  inStockOnly?: boolean
  minPrice?:   number
  maxPrice?:   number
}

export function filterProducts(products: Product[], filters: ProductFilters): Product[] {
  let result = products
  if (filters.categoryId != null && filters.categoryId !== '') {
    result = result.filter(p => String(p.category_id) === String(filters.categoryId))
  }
  if (filters.stateId) {
    result = result.filter(p => String(p.state_id) === String(filters.stateId))
  }
  if (filters.inStockOnly) {
    // BUG FIX: was `(p.available_stock ?? 0) > 0` — the raw top-level
    // product field. ProductCard displays stock from the *base variant*
    // when the product has variants (see getEffectiveStock), so a product
    // could pass this filter while its own card still rendered "Out of
    // Stock", or fail this filter while its card showed available stock.
    // Now uses the exact same effective-stock resolution as the card.
    result = result.filter(p => getEffectiveStock(p) > 0)
  }
  if (filters.minPrice != null) {
    result = result.filter(p => getEffectivePrice(p) >= filters.minPrice!)
  }
  if (filters.maxPrice != null) {
    result = result.filter(p => getEffectivePrice(p) <= filters.maxPrice!)
  }
  return result
}

export type ProductSort = 'newest' | 'price_asc' | 'price_desc' | 'popular' | (string & {})

export function sortProducts(products: Product[], sort: ProductSort): Product[] {
  const result = [...products]
  switch (sort) {
    case 'price_asc':
      result.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b))
      break
    case 'price_desc':
      result.sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a))
      break
    case 'popular':
      // Bestsellers first; within each bucket, rank by real review_count
      // (genuine popularity signal), then newest as a final deterministic
      // tiebreaker. Previously a pure boolean split with no secondary order.
      result.sort((a, b) => {
        const bucket = (b.badges_bestseller ? 1 : 0) - (a.badges_bestseller ? 1 : 0)
        if (bucket !== 0) return bucket
        const reviews = (b.review_count ?? 0) - (a.review_count ?? 0)
        if (reviews !== 0) return reviews
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      })
      break
    case 'newest':
    default:
      result.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
  }
  return result
}

export function filterAndSortProducts(
  products: Product[],
  filters: ProductFilters,
  sort: ProductSort,
): Product[] {
  return sortProducts(filterProducts(products, filters), sort)
}

export function paginateProducts<T>(items: T[], page: number, pageSize: number): { pageItems: T[]; totalPages: number; totalCount: number } {
  const totalCount = items.length
  const totalPages = Math.ceil(totalCount / pageSize)
  const offset = (page - 1) * pageSize
  return { pageItems: items.slice(offset, offset + pageSize), totalPages, totalCount }
}

/**
 * buildPaginationList — turns (currentPage, totalPages) into the compact
 * "1 … 4 5 6 … 12" sequence a pagination bar should render, instead of every
 * page number. Always keeps the first page, the last page, and a small
 * window around the current page; collapses everything else into a single
 * 'ellipsis' marker (never two ellipses back to back).
 */
export type PaginationItem = number | 'ellipsis'

export function buildPaginationList(current: number, total: number, windowSize = 1): PaginationItem[] {
  if (total <= 0) return []
  if (total <= 5 + windowSize * 2) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const pages = new Set<number>([1, total])
  for (let i = current - windowSize; i <= current + windowSize; i++) {
    if (i >= 1 && i <= total) pages.add(i)
  }

  const sorted = Array.from(pages).sort((a, b) => a - b)
  const result: PaginationItem[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('ellipsis')
    result.push(sorted[i])
  }
  return result
}
