import BestSellersClient from './BestSellersClient'
import { getStoreData, getProductsWithImages } from '@/lib/storeData'
import { normalizeProducts } from '@/lib/normalizeProduct'
import type { Product } from '@/types'

interface Cat { id: number; name: string; slug: string; emoji?: string }

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
    products   = normalizeProducts(withImgs)
    categories = (storeData.categories ?? []).filter((c: any) => c.is_active !== false)
  } catch {
    return null
  }

  if (!products.length) return null

  return <BestSellersClient initialProducts={products} categories={categories} />
}
