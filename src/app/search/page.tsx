'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'
import useSWR from 'swr'
import { supabase } from '@/lib/supabase'
import { normalizeProducts, toCardProductData } from '@/lib/normalizeProduct'
import ProductCard from '@/components/product/ProductCard'
import { ProductGridSkeleton } from '@/components/ui/Skeleton'
import { trackSearch } from '@/lib/analytics/track'
import type { Product } from '@/types'

function SearchContent() {
  const searchParams = useSearchParams()
  const q = searchParams.get('q')?.trim() || ''

  const { data: results, isLoading } = useSWR<Product[]>(
    q ? `search-full-${q}` : null,
    async () => {
      // BUG FIX: `tags` is a Postgres ARRAY column (see src/types/index.ts's
      // stale `tags: string | null` typing — the code here was written as if
      // it were plain text). PostgREST's `ilike` operator isn't valid on an
      // array column, so `tags.ilike.%${q}%` made the whole `.or(...)` filter
      // invalid. Supabase returned that as an error with `data: null`, and
      // this call threw the error away (`data ?? []`), so EVERY search —
      // any term, not just "Honey" — silently came back as "0 results"
      // instead of surfacing the failure. Matching by name alone is what
      // actually works today (no product currently has tags populated —
      // confirmed live: 0 of 17 rows have a non-empty tags array); tag
      // search can be reintroduced later via an RPC that does
      // `EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ILIKE ...)`, which is
      // the correct way to substring-match inside an array column.
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, name, slug, emoji, price, selling_price, mrp, available_stock, gst_rate,
          image_url, unit_label, badges,
          category_id, is_deleted, status,
          categories:categories(id, name, slug),
          product_variants(id, price, original_price, variant_value, available_stock, is_active)
        `)
        .eq('is_deleted', false)
        .eq('status', 'active')
        .ilike('name', `%${q}%`)
        .limit(48)
      if (error) {
        console.error('[search] product search query failed', error)
      }
      const normalized = normalizeProducts(data ?? [])
      trackSearch(q, normalized.length)
      return normalized
    }
  )

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
          {isLoading ? 'Searching…' : `${results?.length || 0} results for "${q}"`}
        </h1>
      </div>

      {isLoading ? (
        <ProductGridSkeleton count={8} />
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
