'use client'

import Link from 'next/link'
import { useState, useEffect, useMemo } from 'react'
import ProductCard from '@/components/product/ProductCard'
import type { Product } from '@/types'
import { emojiForCategory } from '@/lib/categoryEmoji'
import { getEffectivePrice, getEffectiveMrp } from '@/lib/normalizeProduct'

const SORTS = [
  { val: 'default',    label: 'Sort: Featured'     },
  { val: 'price_asc',  label: 'Price: Low to High'  },
  { val: 'price_desc', label: 'Price: High to Low'  },
  { val: 'discount',   label: 'Best Discount'       },
  { val: 'name',       label: 'Name A-Z'            },
]

interface Cat { id: number; name: string; slug: string; emoji?: string | null }

function shuffleProducts(products: Product[]): Product[] {
  const copy = [...products]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}


interface Props {
  initialProducts: Product[]
  categories:      Cat[]
}

// PERF FIX: this used to be the whole BestSellers component — a client component
// that fetched /api/v1/store-data itself in a useEffect on mount. That meant the
// "Our Finest Offerings" section rendered "No products found" on first paint and
// stayed empty until: JS bundle loads → hydrates → fetch fires → 8 parallel
// Supabase queries resolve → full catalog JSON parsed client-side → normalized →
// shuffled. Every other homepage section (NewArrivals, ExploreByRegion) instead
// reads data directly in an async Server Component, so it's already in the HTML
// on first paint with no extra round trip.
//
// Fix: BestSellers.tsx (server component) now does that same server-side fetch
// via getStoreData(), and passes the ready-to-render product list down as props.
// This client component only owns the parts that truly need to run in the
// browser — the shuffle-on-visit, the category filter buttons, and the sort
// dropdown — none of which require a network request.
export default function BestSellersClient({ initialProducts, categories }: Props) {
  const [activeCat, setActiveCat] = useState<string>('all')
  const [sort,      setSort]      = useState('default')

  // BUG FIX (lint: react-hooks/set-state-in-effect): the previous version
  // called `setAllProducts(prev => shuffleProducts(prev))` directly inside a
  // mount effect, computing AND storing derived data as a side effect. That
  // combination (compute + store in its own state slot) is what the rule is
  // actually trying to catch, and it caused an extra render right after
  // mount. It's fixed by separating the two: the effect below only flips a
  // boolean, and the shuffle itself is computed via useMemo, keyed off that
  // boolean, so it runs at most once instead of being recomputed or
  // re-stored on every render.
  //
  // The boolean flip itself still trips the same lint rule — same genuinely
  // necessary exception as ClientOnly.tsx: whether we're past hydration
  // cannot be known during any render phase (only the effect phase), so
  // there's no render-time equivalent. Reshuffling has to wait until after
  // mount because the server always renders `initialProducts` in its
  // original order — the client's first render must match that exactly, and
  // Math.random() can only run safely once hydration has completed.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true)
  }, [])

  const allProducts = useMemo(
    () => (hydrated ? shuffleProducts(initialProducts) : initialProducts),
    [hydrated, initialProducts],
  )

  // BUG FIX (audit): a chip was rendered for EVERY active category, even ones
  // with no bestseller products — click it and you got an empty grid with no
  // explanation. Large storefronts only offer a filter that returns results
  // (a dead filter reads as "broken"). Chips are now limited to categories
  // that actually have at least one product in this list.
  const chipCategories = useMemo(() => {
    const withProducts = new Set(initialProducts.map((p: any) => String(p.category_id)))
    return categories.filter(c => withProducts.has(String(c.id)))
  }, [categories, initialProducts])

  let filtered = [...allProducts]
  if (activeCat !== 'all') {
    const cat = categories.find(c => c.slug === activeCat)
    if (cat) filtered = filtered.filter((p: any) => String(p.category_id) === String(cat.id))
  }

  switch (sort) {
    // BUG FIX (P2): these used to compare a.price/b.price/a.mrp/b.mrp
    // directly — the raw top-level product row. ProductCard (and
    // getEffectivePrice/getEffectiveMrp's own doc-comments) render the
    // lowest active *variant's* price/mrp when variants exist, which can
    // differ from the top-level fields. For any product with variants,
    // "Price: Low to High" and "Best Discount" could sort into an order
    // that visibly disagreed with the prices/discounts shown on the very
    // cards being sorted.
    case 'price_asc':  filtered.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b)); break
    case 'price_desc': filtered.sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a)); break
    case 'discount':   filtered.sort((a, b) => {
      const am = getEffectiveMrp(a); const ap = getEffectivePrice(a)
      const bm = getEffectiveMrp(b); const bp = getEffectivePrice(b)
      const da = am > ap ? ((am - ap) / am) : 0
      const db_ = bm > bp ? ((bm - bp) / bm) : 0
      return db_ - da
    }); break
    case 'name':       filtered.sort((a, b) => a.name.localeCompare(b.name)); break
    default:
      filtered.sort((a, b) => (b.badges_bestseller ? 1 : 0) - (a.badges_bestseller ? 1 : 0))
  }

  const shown = filtered.slice(0, 6)

  return (
    <section className="sec" id="products" style={{ background: 'var(--pm-cream, #f5f0e8)', padding: '36px 40px 48px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 0 }}>
        <div className="ct rv" style={{ marginBottom: 0, textAlign: 'left' }}>
          <div className="chip">Bestsellers</div>
          <h2 className="sh2">Our Finest Offerings</h2>
          <p className="ssub">A fresh edit of six Himalayan favorites, reshuffled every visit.</p>
        </div>
        <Link
          href="/products"
          className="show-all-btn"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'var(--g)', color: '#fff',
            fontFamily: "var(--font-lato), 'Lato', sans-serif", fontSize: 13, fontWeight: 800, letterSpacing: '.5px',
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

        {chipCategories.map(cat => (
          <button
            key={cat.id}
            className={`filter-btn${activeCat === cat.slug ? ' active' : ''}`}
            onClick={() => setActiveCat(cat.slug)}
          >
            {cat.emoji || emojiForCategory(cat)} {cat.name}
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
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--tx3, #7a7a7a)' }}>
          No products found
        </div>
      ) : (
        <div className="pgrid bsGrid">
          {shown.map((p, i) => <ProductCard key={p.id} product={p} priority={i < 3} />)}
        </div>
      )}
    </section>
  )
}
