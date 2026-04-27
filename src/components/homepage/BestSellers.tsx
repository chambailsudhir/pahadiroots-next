'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import ProductCard from '@/components/product/ProductCard'
import { PRODUCT_SELECT, normalizeProducts } from '@/lib/normalizeProduct'
import type { Product, Category } from '@/types'

const FILTERS = [
  { key: 'all',     label: '🌿 All'     },
  { key: 'honey',   label: '🍯 Honey'   },
  { key: 'ghee',    label: '🥛 Ghee'    },
  { key: 'spices',  label: '🌿 Spices'  },
  { key: 'tea',     label: '🍵 Tea'     },
  { key: 'saffron', label: '🌸 Saffron' },
  { key: 'oils',    label: '🫚 Oils'    },
]

const SORTS = [
  { val: 'default',    label: 'Sort: Featured'       },
  { val: 'price_asc',  label: 'Price: Low → High'   },
  { val: 'price_desc', label: 'Price: High → Low'   },
  { val: 'discount',   label: 'Best Discount'        },
  { val: 'name',       label: 'Name A–Z'             },
]

async function fetchProducts(): Promise<Product[]> {
  try {
    // Use store-data API (SERVICE KEY) — same as old pahadiroots.com
    // This bypasses RLS and returns product_images for correct image_url
    const res = await fetch('/api/v1/store-data')
    if (!res.ok) throw new Error('store-data failed')
    const sd = await res.json()
    const { applyProductImages } = await import('@/lib/normalizeProduct')
    const withImgs = applyProductImages(sd.products ?? [], sd.product_images ?? [])
    const all = normalizeProducts(withImgs)
    const bs = all.filter(p => p.badges_bestseller)
    return bs.length > 0 ? bs : all
  } catch { return [] }
}

export default function BestSellers() {
  const [products, setProducts] = useState<Product[]>([])
  const [activeFilter, setActiveFilter] = useState('all')
  const [sort, setSort] = useState('default')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    fetchProducts().then(setProducts)
  }, [])

  if (!mounted) return null

  let filtered = [...products]

  // Filter by category keyword
  if (activeFilter !== 'all') {
    filtered = filtered.filter(p => {
      const name = (p.name + ' ' + (p.categories?.name || '')).toLowerCase()
      return name.includes(activeFilter)
    })
  }

  // Sort
  if (sort === 'price_asc')  filtered.sort((a, b) => a.price - b.price)
  if (sort === 'price_desc') filtered.sort((a, b) => b.price - a.price)
  if (sort === 'name')       filtered.sort((a, b) => a.name.localeCompare(b.name))
  if (sort === 'discount')   filtered.sort((a, b) => {
    const da = a.mrp ? Math.round((a.mrp - a.price) / a.mrp * 100) : 0
    const db = b.mrp ? Math.round((b.mrp - b.price) / b.mrp * 100) : 0
    return db - da
  })

  return (
    <section className="sec" style={{ background: '#fff', padding: '36px 40px 48px' }}>
      {/* Header */}
      <div className="ct">
        <div className="chip">Bestsellers</div>
        <h2 className="sh2">Our Finest Offerings</h2>
        <p className="ssub">Curated from 10 Himalayan states — the products our customers love most.</p>
      </div>

      {/* Filter bar */}
      <div className="filter-wrap">
        <div className="filter-bar">
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`filter-btn${activeFilter === f.key ? ' active' : ''}`}
              onClick={() => setActiveFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          className="filter-sort"
          value={sort}
          onChange={e => setSort(e.target.value)}
          style={{ border: '1.5px solid var(--bd)', borderRadius: 20, padding: '7px 14px', fontSize: '12.5px', fontWeight: 700, color: 'var(--tx2)', background: '#fff', fontFamily: 'Lato, sans-serif', cursor: 'pointer' }}
        >
          {SORTS.map(s => <option key={s.val} value={s.val}>{s.label}</option>)}
        </select>
      </div>

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="pgrid">
          {filtered.map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 4} />
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--tx3)', fontFamily: '"Playfair Display", Georgia, serif', fontStyle: 'italic' }}>
          No products found for this filter 🏔️
        </div>
      )}

      {/* View All */}
      <div style={{ textAlign: 'center', marginTop: 36 }}>
        <Link href="/products" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          border: '2px solid var(--g)', color: 'var(--g)',
          fontWeight: 800, padding: '12px 36px', borderRadius: 50,
          fontSize: 14, letterSpacing: '.3px', textDecoration: 'none',
          transition: 'all .2s',
        }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLElement
            el.style.background = 'var(--g)'; el.style.color = '#fff'
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLElement
            el.style.background = 'transparent'; el.style.color = 'var(--g)'
          }}
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
