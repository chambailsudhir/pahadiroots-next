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
}

export function buildProductsUrl(
  current: ProductsUrlState,
  overrides: Partial<{ sort: string | undefined; category: string | undefined; state: string | undefined; instock: string | undefined; page: string | undefined }>,
): string {
  const p = new URLSearchParams()
  const merged: Record<string, string | undefined> = {
    sort:     current.sort,
    category: current.category || undefined,
    state:    current.state    || undefined,
    instock:  current.instock ? 'true' : undefined,
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
  return `/products${q ? '?' + q : ''}`
}
