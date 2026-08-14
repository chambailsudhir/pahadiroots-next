import BestSellersClient from './BestSellersClient'
import { getStoreData, getProductsWithImages } from '@/lib/storeData'
import { normalizeProducts, toCardProductData } from '@/lib/normalizeProduct'
import { logger } from '@/lib/logger'
import type { Product } from '@/types'

interface Cat { id: number; name: string; slug: string; emoji?: string | null }

// PERF FIX: this section used to be a 'use client' component that fetched
// /api/v1/store-data itself in a useEffect — see BestSellersClient.tsx for the
// full explanation. Rendering it as an async Server Component (same pattern as
// NewArrivals.tsx and ExploreByRegion.tsx) means the product data is already
// baked into the server-rendered HTML on first paint, backed by the same
// 60s shared cache getStoreData() uses everywhere else. Only the interactive
// bits (filter, sort, shuffle) run client-side now, in BestSellersClient.
export default async function BestSellers() {
  let products:   Product[] = []
  let categories: Cat[]     = []

  try {
    const storeData = await getStoreData()
    const withImgs  = getProductsWithImages(storeData)
    // BUG FIX (performance, found while chasing "/products images load
    // slowly"): BestSellersClient needs the *entire* active catalog (not
    // just the 8 it displays) because its category filter buttons run
    // client-side and re-filter from what's already in the browser rather
    // than making a new request — so we can't just slice this to 8 here.
    // But every one of those products was being passed to a Client
    // Component with its full field set intact, including long_description,
    // short_description, tags, and five AI-generated content fields meant
    // for the PDP. That's the same bug fixed on /products via
    // toCardProductData — except worse here, since it was the WHOLE catalog
    // rather than one paginated page of 24.
    products   = normalizeProducts(withImgs).map(toCardProductData)
    categories = (storeData.categories ?? []).filter((c: any) => c.is_active !== false)
  } catch (err) {
    // BUG FIX (observability — the "Bestsellers section just disappeared
    // with no error anywhere" report): this used to be a bare `catch {
    // return null }`. That's a reasonable fail-safe so one broken section
    // can't 500 the entire homepage, but returning null with NO log line
    // meant a real failure here was completely invisible — nothing in
    // Vercel's function logs, nothing anywhere, just an empty gap on the
    // page with zero breadcrumbs for anyone to debug from. Now the section
    // still fails safe (homepage keeps rendering), but the actual error is
    // captured so it shows up in Vercel logs / any log drain instead of
    // vanishing.
    logger.error('[BestSellers] failed to load — section hidden', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    return null
  }

  if (!products.length) {
    // Same observability gap as above, for the "fetch succeeded but the
    // active catalog was empty" case — this can happen legitimately (e.g.
    // right after all products are deactivated), but should still leave a
    // trace instead of just silently omitting the section.
    logger.warn('[BestSellers] no active products found — section hidden')
    return null
  }

  return <BestSellersClient initialProducts={products} categories={categories} />
}
