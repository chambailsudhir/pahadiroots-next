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
  const [hov, setHov]   = useState<string | null>(null)

  const cats = categories.filter(c => c.is_active).slice(0, 12)
  const sts  = states.slice(0, 10)

  /* Shared link style — exact copy from pahadiroots-main/index.html */
  const lnk = (id: string): React.CSSProperties => ({
    display:        'flex',
    alignItems:     'center',
    width:          '100%',
    padding:        '7px 10px',
    borderRadius:   '8px',
    fontSize:       '13.5px',
    fontWeight:     500,
    lineHeight:     1,
    fontFamily:     'inherit',
    color:          hov === id ? '#1a3a1e' : 'var(--tx2, #4a4a4a)',
    background:     hov === id ? 'rgba(26,58,30,.08)' : 'transparent',
    textDecoration: 'none',
    cursor:         'pointer',
    whiteSpace:     'nowrap',
    letterSpacing:  '.1px',
    transition:     'background .15s, color .15s',
    border:         'none',
    margin:         0,
    boxSizing:      'border-box',
  })

  const hdg: React.CSSProperties = {
    fontSize: '9px', fontWeight: 800, letterSpacing: '2.4px',
    textTransform: 'uppercase', color: '#a89f92',
    marginBottom: '14px', lineHeight: 1, display: 'block',
  }

  const ul: React.CSSProperties = {
    listStyle: 'none', padding: 0, margin: 0,
    display: 'flex', flexDirection: 'column', gap: '1px',
  }

  const li: React.CSSProperties = {
    margin: 0, padding: 0, display: 'block', lineHeight: 1,
  }

  return (
    <div style={{ position: 'relative' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* Trigger */}
      <button
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          fontSize: 14, fontWeight: 700, color: 'var(--tx2)',
          padding: '6px 14px', borderRadius: 20,
          background: 'none', border: 'none', cursor: 'pointer',
          letterSpacing: '.3px', transition: 'all .2s', lineHeight: 1,
          fontFamily: 'inherit',
        }}
      >
        Shop
        <svg style={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'rotate(0)' }}
          width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Panel */}
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: '50%', transform: 'translateX(-50%)', zIndex: 50, width: 880 }}>
          <div style={{
            background: '#fff', borderRadius: '0 0 20px 20px',
            boxShadow: '0 20px 60px rgba(0,0,0,.14), 0 4px 16px rgba(0,0,0,.06)',
            overflow: 'hidden', display: 'flex', alignItems: 'stretch',
            lineHeight: 1,  /* ← reset body's line-height:1.5 here */
          }}>

            {/* Col 1 — All Collections */}
            <div style={{ flex: 1, padding: '22px 22px 18px', background: '#fff' }}>
              <span style={hdg}>ALL COLLECTIONS</span>
              <ul style={ul}>
                {cats.map(cat => (
                  <li key={cat.id} style={li}>
                    <Link href={`/collections/${cat.slug}`}
                      style={lnk(`c${cat.id}`)}
                      onMouseEnter={() => setHov(`c${cat.id}`)}
                      onMouseLeave={() => setHov(null)}
                      onClick={() => setOpen(false)}>
                      {cat.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href="/products" onClick={() => setOpen(false)}
                style={{ display:'inline-flex', alignItems:'center', gap:5, marginTop:14, paddingTop:12, fontSize:13, fontWeight:600, color:'#1a3a1e', textDecoration:'none', borderTop:'1px solid #edeae2', lineHeight:1, letterSpacing:'.1px' }}>
                View All Products →
              </Link>
            </div>

            {/* Col 2 — Shop by Region */}
            <div style={{ flex: 1.5, padding: '22px 22px 18px', background: '#fff', borderLeft: '1px solid #f0ede6', borderRight: '1px solid #f0ede6' }}>
              <span style={hdg}>SHOP BY REGION</span>
              <ul style={{ ...ul, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 4px', flexDirection: undefined }}>
                {sts.map(s => (
                  <li key={s.id} style={li}>
                    <Link href={`/regions/${s.slug}`}
                      style={lnk(`s${s.id}`)}
                      onMouseEnter={() => setHov(`s${s.id}`)}
                      onMouseLeave={() => setHov(null)}
                      onClick={() => setOpen(false)}>
                      {s.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href="/regions" onClick={() => setOpen(false)}
                style={{ display:'inline-flex', alignItems:'center', gap:5, marginTop:14, paddingTop:12, fontSize:13, fontWeight:600, color:'#1a3a1e', textDecoration:'none', borderTop:'1px solid #edeae2', lineHeight:1, letterSpacing:'.1px' }}>
                View All Regions →
              </Link>
            </div>

            {/* Col 3 — Curated Picks */}
            <div style={{ flex: 1, padding: '22px 22px 18px', background: '#f7f4ee' }}>
              <span style={hdg}>CURATED PICKS</span>
              <ul style={ul}>
                {CURATED.map(l => (
                  <li key={l.href} style={li}>
                    <Link href={l.href}
                      style={{ ...lnk(`r${l.href}`), fontWeight: 600 }}
                      onMouseEnter={() => setHov(`r${l.href}`)}
                      onMouseLeave={() => setHov(null)}
                      onClick={() => setOpen(false)}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
