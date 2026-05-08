'use client'

import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import { catSlug } from '@/lib/utils'
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

// ── All styles as JS objects — zero CSS cascade conflicts ──
const S = {
  // The <li> that wraps everything in the nav
  li: {
    listStyle: 'none',
    position: 'static' as const,
    margin: 0,
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    height: '64px',
  },

  // "Shop ▾" button — identical to other nav links
  trigger: {
    background: 'none',
    border: 'none',
    outline: 'none',
    cursor: 'pointer',
    userSelect: 'none' as const,
    display: 'flex',
    alignItems: 'center',
    gap: '3px',
    color: '#2a2a2a',
    fontSize: '13.5px',
    fontWeight: 600,
    padding: '0 14px',
    height: '64px',
    margin: 0,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap' as const,
    letterSpacing: '0',
    transition: 'color .2s, background .2s',
    borderRadius: 0,
  },
  triggerHover: { color: '#1a3a1e', background: 'rgba(26,58,30,.04)' },

  arr: {
    fontSize: '10px',
    display: 'inline-block',
    marginLeft: '2px',
    lineHeight: 1,
    transition: 'transform .25s ease',
  },

  // Floating panel
  panel: {
    position: 'fixed' as const,
    left: '50%',
    width: 'min(960px, 92vw)',
    background: '#fff',
    borderRadius: '0 0 20px 20px',
    boxShadow: '0 20px 60px rgba(0,0,0,.14), 0 4px 16px rgba(0,0,0,.06)',
    zIndex: 501,
    display: 'flex',
    alignItems: 'stretch',
    overflow: 'hidden',
  },

  // Column wrappers
  col: {
    minWidth: 0,
    padding: '22px 22px 18px',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  colWhite:  { flex: 1,   background: '#fff' },
  colMiddle: { flex: 1.5, background: '#fff', borderLeft: '1px solid #f0ede6', borderRight: '1px solid #f0ede6' },
  colCream:  { flex: 1,   background: '#f7f4ee' },

  // "ALL COLLECTIONS" heading
  heading: {
    fontSize: '9px',
    fontWeight: 800,
    letterSpacing: '2.4px',
    textTransform: 'uppercase' as const,
    color: '#a89f92',
    marginBottom: '14px',
    padding: 0,
    lineHeight: 1,
    display: 'block',
  },

  // <ul>
  ul: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1px',
  },
  ulGrid: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1px 4px',
  },

  // <li> inside mega list
  item: {
    margin: 0,
    padding: 0,
    listStyle: 'none',
    display: 'block',
    lineHeight: 'normal',
  },

  // Each link/button row — exact old site: padding:7px 10px, font:13.5px → ~30px row
  link: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '7px 10px',
    borderRadius: '8px',
    fontSize: '13.5px',
    fontWeight: 500,
    color: '#2c2c2c',
    textDecoration: 'none',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'background .15s, color .15s',
    whiteSpace: 'nowrap' as const,
    letterSpacing: '.1px',
    fontFamily: 'inherit',
    lineHeight: 'normal',
    margin: 0,
    boxSizing: 'border-box' as const,
    border: 'none',
  },
  linkBold: { fontWeight: 600 },

  // "View All Products →"
  viewAll: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    marginTop: '14px',
    paddingTop: '12px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#1a3a1e',
    textDecoration: 'none',
    borderTop: '1px solid #edeae2',
    letterSpacing: '.1px',
    lineHeight: 1,
  },
}

export default function MegaMenu({ categories, states }: Props) {
  const [open, setOpen]         = useState(false)
  const [megaTop, setMegaTop]   = useState(64)
  const [hoveredIdx, setHov]    = useState<string | null>(null)
  const liRef                   = useRef<HTMLLIElement>(null)

  const visibleCats   = categories.filter(c => c.is_active).slice(0, 12)
  const visibleStates = states.slice(0, 10)

  // Snap panel exactly below sticky nav on scroll/resize
  useEffect(() => {
    function update() {
      const nav = document.querySelector('nav.old-nav') as HTMLElement | null
      if (nav) setMegaTop(nav.getBoundingClientRect().bottom)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update, { passive: true })
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [])

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    function onOut(e: MouseEvent) { if (liRef.current && !liRef.current.contains(e.target as Node)) setOpen(false) }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('click', onOut)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('click', onOut); document.removeEventListener('keydown', onEsc) }
  }, [open])

  const linkStyle = (id: string) => ({
    ...S.link,
    background: hoveredIdx === id ? 'rgba(26,58,30,.08)' : 'transparent',
    color: hoveredIdx === id ? '#1a3a1e' : '#2c2c2c',
  })

  const boldLinkStyle = (id: string) => ({
    ...S.link,
    ...S.linkBold,
    background: hoveredIdx === id ? 'rgba(26,58,30,.08)' : 'transparent',
    color: hoveredIdx === id ? '#1a3a1e' : '#2c2c2c',
  })

  return (
    <li ref={liRef} style={S.li}>

      {/* Trigger */}
      <button
        style={{ ...S.trigger, ...(open ? S.triggerHover : {}) }}
        onClick={() => setOpen(v => !v)}
        onMouseEnter={e => (e.currentTarget.style.color = '#1a3a1e', e.currentTarget.style.background = 'rgba(26,58,30,.04)')}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.color = '#2a2a2a'; e.currentTarget.style.background = 'none' } }}
      >
        Shop
        <span style={{ ...S.arr, transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
      </button>

      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 500 }}
        />
      )}

      {/* Panel */}
      {open && (
        <div style={{ ...S.panel, top: megaTop, transform: 'translateX(-50%)' }}>

          {/* Col 1 — Collections */}
          <div style={{ ...S.col, ...S.colWhite }}>
            <span style={S.heading}>ALL COLLECTIONS</span>
            <ul style={S.ul}>
              {visibleCats.map(cat => (
                <li key={cat.id} style={S.item}>
                  <Link
                    href={`/collections/${catSlug(cat)}`}
                    style={linkStyle(`cat-${cat.id}`)}
                    onMouseEnter={() => setHov(`cat-${cat.id}`)}
                    onMouseLeave={() => setHov(null)}
                    onClick={() => setOpen(false)}
                  >
                    {cat.name}
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/products"
              style={S.viewAll}
              onClick={() => setOpen(false)}
            >
              View All Products →
            </Link>
          </div>

          {/* Col 2 — Regions */}
          <div style={{ ...S.col, ...S.colMiddle }}>
            <span style={S.heading}>SHOP BY REGION</span>
            <ul style={S.ulGrid}>
              {visibleStates.map(s => (
                <li key={s.id} style={S.item}>
                  <Link
                    href={`/regions/${s.slug}`}
                    style={linkStyle(`st-${s.id}`)}
                    onMouseEnter={() => setHov(`st-${s.id}`)}
                    onMouseLeave={() => setHov(null)}
                    onClick={() => setOpen(false)}
                  >
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/regions"
              style={S.viewAll}
              onClick={() => setOpen(false)}
            >
              View All Regions →
            </Link>
          </div>

          {/* Col 3 — Curated */}
          <div style={{ ...S.col, ...S.colCream }}>
            <span style={S.heading}>CURATED PICKS</span>
            <ul style={S.ul}>
              {CURATED.map(l => (
                <li key={l.href} style={S.item}>
                  <Link
                    href={l.href}
                    style={boldLinkStyle(`cur-${l.href}`)}
                    onMouseEnter={() => setHov(`cur-${l.href}`)}
                    onMouseLeave={() => setHov(null)}
                    onClick={() => setOpen(false)}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

        </div>
      )}
    </li>
  )
}
