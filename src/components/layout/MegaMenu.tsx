'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { Category, State } from '@/types'

interface Props { categories: Category[]; states: State[] }

const CURATED = [
  { label: 'Best Sellers',    href: '/collections/best-sellers' },
  { label: 'New Arrivals',    href: '/collections/new-arrivals' },
  { label: 'Gift Sets',       href: '/collections/gift-sets' },
  { label: 'Pahadi Wellness', href: '/collections/wellness' },
  { label: 'Natural Honey',   href: '/collections/honey' },
  { label: 'Pure Spices',     href: '/collections/spices' },
]

export default function MegaMenu({ categories, states }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        className="flex items-center gap-1"
        aria-expanded={open}
        style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx2)', padding: '6px 14px', borderRadius: 20, background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '.3px', transition: 'all .2s' }}
      >
        Shop
        <svg className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 pt-3 z-50" style={{ width: 760 }}>
          <div className="mega-menu-panel">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
              {/* All Collections */}
              <div style={{ padding: '24px', borderRight: '1px solid var(--bd)' }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 3, color: 'var(--tx3)', textTransform: 'uppercase', marginBottom: 12 }}>All Collections</div>
                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {categories.filter(c => c.is_active).map(cat => (
                    <li key={cat.id}>
                      <Link href={`/collections/${cat.slug}`} onClick={() => setOpen(false)}
                        style={{ fontSize: 13, color: 'var(--tx2)', display: 'block', transition: 'color .15s, paddingLeft .15s' }}
                        onMouseEnter={e => { (e.target as HTMLElement).style.color = 'var(--g)'; (e.target as HTMLElement).style.paddingLeft = '4px'; }}
                        onMouseLeave={e => { (e.target as HTMLElement).style.color = 'var(--tx2)'; (e.target as HTMLElement).style.paddingLeft = '0'; }}>
                        {cat.name}
                      </Link>
                    </li>
                  ))}
                  <li style={{ paddingTop: 4, borderTop: '1px solid var(--bd)' }}>
                    <Link href="/products" onClick={() => setOpen(false)} style={{ fontSize: 13, fontWeight: 700, color: 'var(--g)' }}>
                      View All Products →
                    </Link>
                  </li>
                </ul>
              </div>

              {/* Shop by Region */}
              <div style={{ padding: '24px', borderRight: '1px solid var(--bd)' }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 3, color: 'var(--tx3)', textTransform: 'uppercase', marginBottom: 12 }}>Shop by Region</div>
                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {states.slice(0, 10).map(s => (
                    <li key={s.id}>
                      <Link href={`/regions/${s.slug}`} onClick={() => setOpen(false)}
                        style={{ fontSize: 13, color: 'var(--tx2)', display: 'flex', alignItems: 'center', gap: 6, transition: 'color .15s' }}
                        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--g)')}
                        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--tx2)')}>
                        <span>{s.flag_emoji || '🏔️'}</span>{s.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Curated */}
              <div style={{ padding: '24px', background: 'linear-gradient(135deg,#f9f5ee,#f2ead8)' }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 3, color: 'var(--tx3)', textTransform: 'uppercase', marginBottom: 12 }}>Curated Picks</div>
                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {CURATED.map(l => (
                    <li key={l.href}>
                      <Link href={l.href} onClick={() => setOpen(false)}
                        style={{ fontSize: 13, color: 'var(--tx2)', display: 'flex', alignItems: 'center', gap: 6, transition: 'color .15s' }}
                        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--g)')}
                        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--tx2)')}>
                        ✦ {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
