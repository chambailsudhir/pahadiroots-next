'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense, useEffect, useMemo } from 'react'
import { useSearchCatalog } from '@/hooks/useSearchCatalog'
import { toCardProductData } from '@/lib/normalizeProduct'
import ProductCard from '@/components/product/ProductCard'
import { ProductGridSkeleton } from '@/components/ui/Skeleton'
import { trackSearch } from '@/lib/analytics/track'
import { searchProducts } from '@/lib/productSearch'

function SearchContent() {
  const searchParams = useSearchParams()
  const q = searchParams.get('q')?.trim() || ''

  // Catalogue comes from /api/v1/search-catalog (the same server-normalized
  // data Browse renders from — product_images, state_id, variants, no 500-row
  // cap), then is ranked client-side by searchProducts() (lib/productSearch.ts:
  // spaces ignored, partial words OK, small typos forgiven).
  const { data: catalog, isLoading, error } = useSearchCatalog(!!q)

  const results = useMemo(
    () => (catalog && q ? searchProducts(catalog, q, 48) : undefined),
    [catalog, q],
  )

  // Analytics: once per (query, result-count) after the catalog has loaded —
  // previously fired from inside the fetcher.
  const resultCount = results?.length
  useEffect(() => {
    if (q && resultCount !== undefined) trackSearch(q, resultCount)
  }, [q, resultCount])

  if (!q) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">🔍</div>
        <h2 className="text-lg font-semibold text-stone-700">Search for products</h2>
        <p className="text-stone-400 text-sm mt-1">Try &quot;honey&quot;, &quot;turmeric&quot;, &quot;ghee&quot;…</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-stone-900">
          {isLoading || (!results && !error) ? 'Searching…' : error ? 'Search unavailable' : `${results?.length || 0} results for "${q}"`}
        </h1>
      </div>

      {isLoading || (!results && !error) ? (
        <ProductGridSkeleton count={8} />
      ) : error ? (
        <div role="alert" className="text-center py-20">
          <div className="text-5xl mb-4">⚠️</div>
          <h3 className="text-lg font-semibold text-stone-700 mb-2">Search is unavailable right now</h3>
          <p className="text-stone-400 text-sm mb-5">Please try again in a moment.</p>
          <Link href="/products" className="text-forest-700 font-semibold text-sm hover:underline">
            Browse all products →
          </Link>
        </div>
      ) : results && results.length > 0 ? (
        <div className="grid grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(220px,300px))] sm:justify-center gap-4 sm:gap-6">
          {results.map((p, i) => (
            <ProductCard key={p.id} product={toCardProductData(p)} priority={i < 4} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">🌿</div>
          <h3 className="text-lg font-semibold text-stone-700 mb-2">No products found</h3>
          <p className="text-stone-400 text-sm mb-5">Try a different search term</p>
          <Link href="/products" className="text-forest-700 font-semibold text-sm hover:underline">
            Browse all products →
          </Link>
        </div>
      )}
    </div>
  )
}

export default function SearchPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Suspense fallback={<ProductGridSkeleton count={8} />}>
        <SearchContent />
      </Suspense>
    </div>
  )
}
