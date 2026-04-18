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
      .limit(8)
    return (data as unknown as Product[]) || []
  } catch { return [] }
}

export default async function BestSellers() {
  const products = await fetchBestSellers()
  if (!products.length) return null

  return (
    <section className="py-12 sm:py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Section header — matches old site exactly */}
        <div className="text-center mb-9">
          <div className="inline-block text-xs font-bold uppercase tracking-widest text-forest-600 bg-forest-50 border border-forest-100 px-3 py-1 rounded-full mb-3">
            Bestsellers
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-stone-900 mb-2">
            Our Finest Offerings
          </h2>
          <p className="text-stone-500 text-sm max-w-md mx-auto">
            Curated from Himalayan states — the products our customers love most.
          </p>
        </div>

        {/* Desktop grid */}
        <div className="hidden sm:grid sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5 mb-8">
          {products.map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 4} />
          ))}
        </div>

        {/* Mobile horizontal scroll */}
        <div className="sm:hidden flex gap-3 overflow-x-auto no-scrollbar pb-2 mb-6">
          {products.map((p, i) => (
            <div key={p.id} className="w-44 shrink-0">
              <ProductCard product={p} priority={i < 2} />
            </div>
          ))}
        </div>

        <div className="text-center">
          <Link
            href="/products"
            className="inline-flex items-center gap-2 border-2 border-forest-700 text-forest-700 hover:bg-forest-700 hover:text-white font-bold px-8 py-3 rounded-xl text-sm transition-all"
          >
            View All Products
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  )
}
