import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import ProductCard from '@/components/product/ProductCard'
import type { Product } from '@/types'

async function fetchBestSellers(): Promise<Product[]> {
  try {
    const { data } = await supabase
      .from('products')
      .select(`
        id, name, slug, emoji, price, mrp, selling, available_stock, gst_rate,
        image_url, unit_label, badges_bestseller, badges_new, badges_organic,
        category_id, is_deleted, status,
        categories:categories(id, name, slug),
        product_variants(id, price, mrp, size, available_stock, is_active)
      `)
      .eq('is_deleted', false)
      .eq('status', 'active')
      .eq('badges_bestseller', true)
      .gt('available_stock', 0)
      .limit(8)
    return (data as unknown as Product[]) || []
  } catch { return [] }
}

export default async function BestSellers() {
  const products = await fetchBestSellers()
  if (!products.length) return null

  return (
    <section className="py-12 sm:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-earth-600 mb-1">
              Customer Favourites
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold text-stone-900">
              Best Sellers
            </h2>
          </div>
          <Link
            href="/collections/best-sellers"
            className="text-sm font-semibold text-forest-700 hover:text-forest-900 flex items-center gap-1 transition-colors"
          >
            View All
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>

        {/* Horizontal scroll on mobile, grid on desktop */}
        <div className="hidden sm:grid sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
          {products.map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 4} />
          ))}
        </div>

        {/* Mobile scroll */}
        <div className="sm:hidden flex gap-3 overflow-x-auto no-scrollbar pb-2">
          {products.map((p, i) => (
            <div key={p.id} className="w-44 shrink-0">
              <ProductCard product={p} priority={i < 2} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
