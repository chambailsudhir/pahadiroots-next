import { supabase } from '@/lib/supabase'
import { normalizeProducts } from '@/lib/normalizeProduct'
import ProductCard from './ProductCard'
import type { Product } from '@/types'

interface Props { categoryId: string | number; excludeId: string | number }

export default async function RelatedProducts({ categoryId, excludeId }: Props) {
  let products: Product[] = []
  try {
    const { data } = await supabase
      .from('products')
      .select(`
        id, name, slug, emoji, price, mrp, available_stock, gst_rate,
        image_url, unit_label, badges, category_id,
        is_deleted, status,
        categories:categories(id, name, slug),
        product_variants(id, price, mrp, variant_value, available_stock, is_active)
      `)
      .eq('category_id', categoryId)
      .eq('is_deleted', false)
      .eq('is_active', true)
      .neq('id', excludeId)
      .limit(4)
    products = normalizeProducts(data ?? [])
  } catch { return null }

  if (!products.length) return null

  return (
    <section className="border-t border-stone-100 pt-10">
      <h2 className="text-xl font-bold text-stone-900 mb-6">You Might Also Like</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
        {products.map(p => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  )
}
