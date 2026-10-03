import Link from 'next/link'
import ProductCard from '@/components/product/ProductCard'
import { getStoreData, getProductsWithImages } from '@/lib/storeData'
import { normalizeProducts, toCardProductData } from '@/lib/normalizeProduct'
import { logger } from '@/lib/logger'
import { filterNewArrivals } from '@/lib/newArrivals'
import type { Product } from '@/types'

export default async function NewArrivals() {
  let products: Product[] = []
  let isFallback = false
  try {
    const storeData = await getStoreData()
    const withImgs  = getProductsWithImages(storeData)
    const all       = normalizeProducts(withImgs)
    // BUG FIX: this used to just take the 4 most-recently-created products
    // regardless of age (so it never went empty, but also never actually
    // meant "new"), and "See All" pointed at /products?sort=newest — a
    // generic, unfiltered listing with no indication anything here was
    // actually recent. Now shares the same isNewArrival() definition (and
    // /new-arrivals destination) as the dedicated collection page, so the
    // homepage strip and "See All" always agree on what "new" means.
    const newArrivals = filterNewArrivals(all)
      .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    // HONESTY FIX (audit): when nothing qualifies as new we still show the
    // newest products (so the shelf isn't empty), but it must not be labelled
    // "Just In / New Arrivals" — big retailers (Nykaa, Myntra) switch the
    // label to something neutral instead, and "See All" can't point at
    // /new-arrivals because that page would be empty.
    isFallback = newArrivals.length === 0
    products = (newArrivals.length ? newArrivals : all.sort(
      (a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    )).slice(0, 4).map(toCardProductData) as Product[]
    // BUG FIX (audit): these 4 products went into a Client Component
    // (ProductCard) with every AI-content / long-description field still
    // attached — the exact payload bloat already fixed in BestSellers.tsx
    // and /regions via toCardProductData(). Stripped here too.
  } catch (err) {
    // BUG FIX (audit): bare `catch { return null }` — a failure here made the
    // section vanish with no trace anywhere (same observability gap that was
    // already fixed in BestSellers.tsx).
    logger.error('[NewArrivals] failed to load — section hidden', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }

  if (!products.length) return null

  return (
    <section className="sec" style={{ background: 'var(--pm-surface, #fff)', padding: '36px 40px 48px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div className="ct rv" style={{ marginBottom: 0, textAlign: 'left' }}>
          <div className="chip">{isFallback ? 'Fresh Picks' : 'Just In'}</div>
          <h2 className="sh2">{isFallback ? 'Latest Additions' : 'New Arrivals'}</h2>
          <p className="ssub">The latest additions from our Himalayan producers.</p>
        </div>
        <Link
          href={isFallback ? '/products?sort=newest' : '/new-arrivals'}
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
