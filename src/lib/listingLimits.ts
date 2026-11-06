// Page sizes shared by the listing pages (Server Components) and their client components.
// BUG FIX (Nov 2026 verification): these constants lived in 'use client' modules. A Server Component that imports a
// NON-component export from a 'use client' module gets a client reference, not the value, so
// `all.slice(0, LISTING_PAGE_SIZE)` became `slice(0, NaN)` = [] and /products, /new-arrivals, /collections/<slug> and
// /blog shipped with NO products or posts in their HTML. Keep plain values here (no 'use client').
// listingLimitsServerImports.test.ts fails if a server page imports a constant from a 'use client' module again.

/** Products per page on /products and /new-arrivals. */
export const LISTING_PAGE_SIZE = 24
/** Products per page on /collections/<slug>. */
export const COLLECTION_PAGE_SIZE = 24
/** How many stories one blog listing shows — the limit the server query used to apply per view. */
export const BLOG_LISTING_LIMIT = 30
