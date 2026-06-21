'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import ProductCard from '@/components/product/ProductCard'
import { normalizeProducts, applyProductImages } from '@/lib/normalizeProduct'
import type { Product } from '@/types'

const SORTS = [
  { val: 'default',    label: 'Sort: Featured'     },
  { val: 'price_asc',  label: 'Price: Low to High'  },
  { val: 'price_desc', label: 'Price: High to Low'  },
  { val: 'discount',   label: 'Best Discount'       },
  { val: 'name',       label: 'Name A-Z'            },
]

interface Cat { id: number; name: string; slug: string; emoji?: string }

function shuffleProducts(products: Product[]): Product[] {
  const copy = [...products]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function catEmoji(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('honey')) return 'Honey'
  if (n.includes('ghee')) return 'Ghee'
  if (n.includes('herb') || n.includes('spice')) return 'Spice'
  if (n.includes('tea')) return 'Tea'
  if (n.includes('rice') || n.includes('grain')) return 'Grain'
  if (n.includes('oil')) return 'Oil'
  if (n.includes('juice')) return 'Juice'
  if (n.includes('shilajit')) return 'Shilajit'
  if (n.includes('jam') || n.includes('preserve')) return 'Jam'
  if (n.includes('pulse') || n.includes('dal')) return 'Dal'
  if (n.includes('saffron')) return 'Saffron'
  return 'Pure'
}

export default function BestSellers() {
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [categories,  setCategories]  = useState<Cat[]>([])
  const [activeCat,   setActiveCat]   = useState<string>('all')
  const [sort,        setSort]        = useState('default')
  const [mounted,     setMounted]     = useState(false)

  useEffect(() => {
    setMounted(true)
    fetch('/api/v1/store-data')
      .then(r => r.json())
      .then(sd => {
        const withImgs = applyProductImages(sd.products ?? [], sd.product_images ?? [])
        const all = shuffleProducts(normalizeProducts(withImgs))
        setAllProducts(all)
        const cats: Cat[] = (sd.categories ?? []).filter((c: any) => c.is_active !== false)
        setCategories(cats)
      })
      .catch((err: unknown) => {
        // BUG FIX [ERROR HANDLING]: previously `.catch(() => {})` — completely
        // silent. If the store-data fetch fails on the homepage, products silently
        // never appear with zero trace. Added console.error for ops visibility.
        console.error('[BestSellers] store-data fetch failed:', err)
      })
  }, [])

  if (!mounted) return null

  let filtered = [...allProducts]
  if (activeCat !== 'all') {
    const cat = categories.find(c => c.slug === activeCat)
    if (cat) filtered = filtered.filter((p: any) => String(p.category_id) === String(cat.id))
  }

  switch (sort) {
    case 'price_asc':  filtered.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));  break
    case 'price_desc': filtered.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));  break
    case 'discount':   filtered.sort((a, b) => {
      const am = a.mrp ?? 0; const ap = a.price ?? 0
      const bm = b.mrp ?? 0; const bp = b.price ?? 0
      const da = am > ap ? ((am - ap) / am) : 0
      const db_ = bm > bp ? ((bm - bp) / bm) : 0
      return db_ - da
    }); break
    case 'name':       filtered.sort((a, b) => a.name.localeCompare(b.name)); break
    default:
      filtered.sort((a, b) => (b.badges_bestseller ? 1 : 0) - (a.badges_bestseller ? 1 : 0))
  }

  const shown = filtered.slice(0, 8)

  return (
    <section className="sec" id="products" style={{ background: '#f5f0e8', padding: '36px 40px 48px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 0 }}>
        <div className="ct rv" style={{ marginBottom: 0, textAlign: 'left' }}>
          <div className="chip">Bestsellers</div>
          <h2 className="sh2">Our Finest Offerings</h2>
          <p className="ssub">A fresh edit of eight Himalayan favorites, reshuffled every visit.</p>
        </div>
        <Link
          href="/products"
          className="show-all-btn"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'var(--g)', color: '#fff',
            fontFamily: "'Lato',sans-serif", fontSize: 13, fontWeight: 800, letterSpacing: '.5px',
            padding: '11px 22px', borderRadius: 24, textDecoration: 'none',
            transition: 'all .2s', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          Show All Products <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>{'>'}</span>
        </Link>
      </div>

      <div className="filter-bar" id="filterBar" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '20px 0 16px' }}>
        <button
          className={`filter-btn${activeCat === 'all' ? ' active' : ''}`}
          onClick={() => setActiveCat('all')}
        >All</button>

        {categories.map(cat => (
          <button
            key={cat.id}
            className={`filter-btn${activeCat === cat.slug ? ' active' : ''}`}
            onClick={() => setActiveCat(cat.slug)}
          >
            {cat.emoji || catEmoji(cat.name)} {cat.name}
          </button>
        ))}

        <select
          className="filter-sort"
          value={sort}
          onChange={e => setSort(e.target.value)}
          style={{ marginLeft: 'auto' }}
        >
          {SORTS.map(s => <option key={s.val} value={s.val}>{s.label}</option>)}
        </select>
      </div>

      {shown.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#7a7a7a' }}>
          No products found
        </div>
      ) : (
        <div className="pgrid">
          {shown.map((p, i) => <ProductCard key={p.id} product={p} priority={i < 4} />)}
        </div>
      )}
    </section>
  )
}
