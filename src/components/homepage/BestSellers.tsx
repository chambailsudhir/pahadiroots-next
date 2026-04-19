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
    <section className="sec" style={{ background: '#fff' }}>
      <div className="ct">
        <div className="chip">⭐ Our Bestsellers</div>
        <h2 className="sh2">Our Finest Offerings</h2>
        <p className="ssub">Curated from Himalayan states — the products our customers love most.</p>
      </div>

      {/* Desktop grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 24, maxWidth: 1300, margin: '0 auto 32px' }}>
        {products.map((p, i) => (
          <ProductCard key={p.id} product={p} priority={i < 4} />
        ))}
      </div>

      <div style={{ textAlign: 'center' }}>
        <Link href="/products" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          border: '2px solid var(--g)', color: 'var(--g)',
          fontWeight: 800, padding: '12px 32px', borderRadius: 28,
          fontSize: 14, transition: 'all .2s', letterSpacing: '.3px',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--g)'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--g)'; }}
        >
          View All Products
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </Link>
      </div>
    </section>
  )
}
