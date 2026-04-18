import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import ProductCard from '@/components/product/ProductCard'
import type { Product } from '@/types'

export default async function NewArrivals() {
  let products: Product[] = []
  try {
    const { data } = await supabase
      .from('products')
      .select(`
        id, name, slug, emoji, price, mrp, selling, available_stock, gst_rate,
        image_url, unit_label, badges_bestseller, badges_new, badges_organic,
        category_id, is_deleted, status, created_at,
        categories:categories(id, name, slug),
        product_variants(id, price, mrp, size, available_stock, is_active)
      `)
      .eq('is_deleted', false)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(8)
    products = (data as Product[]) || []
  } catch { return null }

  if (!products.length) return null

  return (
    <section className="py-12 sm:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-forest-600 mb-1">Just In</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-stone-900">New Arrivals</h2>
          </div>
          <Link href="/products?sort=newest" className="text-sm font-semibold text-forest-700 hover:text-forest-900 flex items-center gap-1">
            View All
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
          {products.map(p => <ProductCard key={p.id} product={p} />)}
        </div>
      </div>
    </section>
  )
}
