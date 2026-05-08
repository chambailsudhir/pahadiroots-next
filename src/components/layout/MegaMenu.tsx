'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
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
  const ref             = useRef<HTMLDivElement>(null)

  const cats = categories.filter(c => c.is_active).slice(0, 12)
  const sts  = states.slice(0, 10)

  // ── Close on outside click or Escape ──
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const HDG: React.CSSProperties = {
    display: 'block', fontSize: '9px', fontWeight: 800,
    letterSpacing: '2.4px', textTransform: 'uppercase',
    color: '#a89f92', marginBottom: '14px', lineHeight: '1', padding: 0,
    fontFamily: 'Lato, sans-serif',
  }

  const VIEW_ALL: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    marginTop: '14px', paddingTop: '12px',
    fontSize: '13px', fontWeight: 600, color: '#1a3a1e',
    textDecoration: 'none', borderTop: '1px solid #edeae2',
    lineHeight: '1', letterSpacing: '.1px', fontFamily: 'Lato, sans-serif',
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>

      {/* ── CLICK trigger (not hover) ── */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          fontSize: '14px', fontWeight: 700, color: 'var(--tx2)',
          padding: '6px 14px', borderRadius: '20px',
          background: open ? 'rgba(26,58,30,.06)' : 'none',
          border: 'none', cursor: 'pointer', letterSpacing: '.3px',
          transition: 'all .2s', lineHeight: '1', fontFamily: 'inherit',
        }}
      >
        Shop
        <svg width="12" height="12" fill="none" viewBox="0 0 24 24"
          stroke="currentColor" strokeWidth={2.5}
          style={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* ── Panel ── */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)',
          left: '50%', transform: 'translateX(-50%)',
          zIndex: 999, width: '880px',
          fontFamily: 'Lato, sans-serif', fontSize: '13.5px', lineHeight: '1',
        }}>
          <div style={{
            background: '#fff', borderRadius: '0 0 20px 20px',
            boxShadow: '0 20px 60px rgba(0,0,0,.14), 0 4px 16px rgba(0,0,0,.06)',
            overflow: 'hidden', display: 'flex', alignItems: 'stretch',
          }}>

            {/* Col 1 — All Collections */}
            <div style={{ flex: 1, padding: '22px 22px 18px', background: '#fff' }}>
              <span style={HDG}>ALL COLLECTIONS</span>
              {/* mega-ul / mega-li / mega-link classes defined in globals.css with !important */}
              <ul className="mega-ul" style={{ display: 'flex', flexDirection: 'column' }}>
                {cats.map(cat => (
                  <li key={cat.id} className="mega-li">
                    <Link href={`/collections/${cat.slug}`} className="mega-link" onClick={() => setOpen(false)}>
                      {cat.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href="/products" onClick={() => setOpen(false)} style={VIEW_ALL}>
                View All Products →
              </Link>
            </div>

            {/* Col 2 — Shop by Region */}
            <div style={{ flex: 1.5, padding: '22px 22px 18px', background: '#fff', borderLeft: '1px solid #f0ede6', borderRight: '1px solid #f0ede6' }}>
              <span style={HDG}>SHOP BY REGION</span>
              <ul className="mega-ul" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 4px' }}>
                {sts.map(s => (
                  <li key={s.id} className="mega-li">
                    <Link href={`/regions/${s.slug}`} className="mega-link" onClick={() => setOpen(false)}>
                      {s.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href="/regions" onClick={() => setOpen(false)} style={VIEW_ALL}>
                View All Regions →
              </Link>
            </div>

            {/* Col 3 — Curated Picks */}
            <div style={{ flex: 1, padding: '22px 22px 18px', background: '#f7f4ee' }}>
              <span style={HDG}>CURATED PICKS</span>
              <ul className="mega-ul" style={{ display: 'flex', flexDirection: 'column' }}>
                {CURATED.map(l => (
                  <li key={l.href} className="mega-li">
                    <Link href={l.href} className="mega-link" style={{ fontWeight: 600 }} onClick={() => setOpen(false)}>
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
