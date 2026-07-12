import Link from 'next/link'
import ProductCard from '@/components/product/ProductCard'
import { getStoreData, getProductsWithImages } from '@/lib/storeData'
import { normalizeProducts, toCardProductData } from '@/lib/normalizeProduct'
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
      // BUG FIX (performance, same as /products and BestSellers): trims the
      // unused AI/description fields before these cross into the client
      // ProductCard component. Only 4 products here so the impact is small,
      // but the fix is one line and keeps every card-rendering surface
      // consistent.
      .map(toCardProductData)
  } catch { return null }

  if (!products.length) return null

  return (
    <section className="sec" style={{ background: '#fff', padding: '36px 40px 48px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div className="ct rv" style={{ marginBottom: 0, textAlign: 'left' }}>
          <div className="chip">Just In</div>
          <h2 className="sh2">New Arrivals</h2>
          <p className="ssub">The latest additions from our Himalayan producers.</p>
        </div>
        <Link
          href="/products?sort=newest"
          className="show-all-btn"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'var(--g)', color: '#fff',
            fontFamily: "'Lato',sans-serif", fontSize: 13, fontWeight: 800, letterSpacing: '.5px',
            padding: '11px 22px', borderRadius: 24, textDecoration: 'none',
            transition: 'all .2s', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          See All <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>{'>'}</span>
        </Link>
      </div>
      <div className="pgrid">
        {products.map((p, i) => <ProductCard key={p.id} product={p} priority={i < 4} />)}
      </div>
    </section>
  )
}
