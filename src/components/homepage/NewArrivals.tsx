import Link from 'next/link'
import ProductCard from '@/components/product/ProductCard'
import { getStoreData, getProductsWithImages } from '@/lib/storeData'
import { normalizeProducts } from '@/lib/normalizeProduct'
import type { Product } from '@/types'

export default async function NewArrivals() {
  let products: Product[] = []
  try {
    const storeData = await getStoreData()
    const withImgs  = getProductsWithImages(storeData)
    const all       = normalizeProducts(withImgs)
    products = all
      .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, 4)
  } catch { return null }

  if (!products.length) return null

  return (
    <section className="py-12 sm:py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-7">
          <div>
            <div className="inline-block text-xs font-bold uppercase tracking-widest text-forest-600 bg-forest-50 border border-forest-100 px-3 py-1 rounded-full mb-2">
              Just In
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-stone-900">New Arrivals</h2>
          </div>
          <Link href="/products?sort=newest" className="text-sm font-semibold text-forest-700 hover:text-forest-900 flex items-center gap-1 transition-colors">
            See All
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-5">
          {products.map(p => <ProductCard key={p.id} product={p} />)}
        </div>
      </div>
    </section>
  )
}
