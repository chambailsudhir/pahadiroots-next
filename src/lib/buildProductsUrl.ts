// ── Shared /products filter-URL builder ──────────────────────────────────
// Pure function, no server/client dependency, so it can be imported by both
// the server-rendered desktop sidebar (app/products/page.tsx) and the client
// MobileFilterBar drawer without duplicating the query-string logic in two
// places that could drift out of sync.

export interface ProductsUrlState {
  sort:     string
  category: string
  state:    string
  instock:  boolean
  minPrice?: string
  maxPrice?: string
}

export function buildProductsUrl(
  current: ProductsUrlState,
  overrides: Partial<{ sort: string | undefined; category: string | undefined; state: string | undefined; instock: string | undefined; page: string | undefined; minPrice: string | undefined; maxPrice: string | undefined }>,
  // BUG FIX (reuse for /new-arrivals): this builder was hardcoded to always
  // emit `/products?...`, which meant the shared filter UI (sidebar,
  // MobileFilterBar, PriceRangeFilter) could only ever link back to
  // /products — impossible to reuse on any other listing page (e.g. a
  // dedicated /new-arrivals collection) without forking all three files.
  // basePath defaults to '/products' so every existing call site keeps
  // working unchanged.
  basePath: string = '/products',
): string {
  const p = new URLSearchParams()
  const merged: Record<string, string | undefined> = {
    sort:     current.sort,
    category: current.category || undefined,
    state:    current.state    || undefined,
    instock:  current.instock ? 'true' : undefined,
    minPrice: current.minPrice || undefined,
    maxPrice: current.maxPrice || undefined,
    page:     '1',
    ...overrides,
  }
  // BUG FIX (URL hygiene): every generated link used to always stamp
  // `?sort=newest&page=1` even for the plain "All Products" link with no
  // active filters at all — functionally harmless (those are the defaults)
  // but noisy, and it meant every crawled URL disagreed with the clean
  // canonical this page now sets in generateMetadata(). Default/no-op
  // values are omitted here so the actual href matches the canonical.
  if (merged.sort === 'newest') merged.sort = undefined
  if (merged.page === '1')      merged.page = undefined

  Object.entries(merged).forEach(([k, v]) => { if (v) p.set(k, v) })
  const q = p.toString()
  return `${basePath}${q ? '?' + q : ''}`
}
