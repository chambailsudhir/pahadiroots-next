import { supabase } from '@/lib/supabase'
import { normalizeProducts } from '@/lib/normalizeProduct'
import type { Product } from '@/types'
import RelatedCard from './RelatedCard'

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
      .eq('status', 'active')
      .neq('id', excludeId)
      .limit(4)
    products = normalizeProducts(data ?? [])
  } catch { return null }

  if (!products.length) return null

  return (
    <section>
      <h2 className="section-title">You May Also Like</h2>
      <p className="section-sub">Handpicked from the same Himalayan region</p>
      <div className="related-grid">
        {products.map(p => <RelatedCard key={p.id} product={p} />)}
      </div>
      <style>{`
        .section-title{font-family:'Playfair Display',serif;font-size:22px;font-weight:900;color:var(--g,#1a3a1e);margin-bottom:4px}
        .section-sub{font-size:13px;color:var(--tx3,#7a7a7a);margin-bottom:20px}
        .related-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
        @media(max-width:880px){.related-grid{grid-template-columns:repeat(2,1fr)}}
      `}</style>
    </section>
  )
}
