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

export default function MegaMenu({ categories, states }: Props) {
  const [open, setOpen]       = useState(false)
  const [megaTop, setMegaTop] = useState(64)
  const liRef                 = useRef<HTMLLIElement>(null)

  const visibleCategories = categories.filter(c => c.is_active).slice(0, 12)
  const visibleStates     = states.slice(0, 10)

  useEffect(() => {
    function updateTop() {
      const nav = document.querySelector('nav.old-nav') as HTMLElement | null
      if (nav) setMegaTop(nav.getBoundingClientRect().bottom)
    }
    updateTop()
    window.addEventListener('scroll', updateTop, { passive: true })
    window.addEventListener('resize', updateTop, { passive: true })
    return () => {
      window.removeEventListener('scroll', updateTop)
      window.removeEventListener('resize', updateTop)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    function onOut(e: MouseEvent) {
      if (liRef.current && !liRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('click', onOut)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('click', onOut)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <li ref={liRef} className={`mega-parent${open ? ' open' : ''}`}>
      <button className="mega-trigger" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        Shop <span className="arr">▾</span>
      </button>

      {open && <div className="mega-menu-backdrop" style={{ position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:500 }} onClick={() => setOpen(false)} />}

      <div className={`mega-menu${open ? ' open' : ''}`} style={{ top: megaTop }} role="menu">

        {/* Column 1 — All Collections */}
        <div className="mega-col" id="megaColCollections">
          <div className="mega-heading">ALL COLLECTIONS</div>
          <ul className="mega-list">
            {visibleCategories.map(cat => (
              <li key={cat.id}>
                <Link href={`/collections/${catSlug(cat)}`} className="mega-list-link" onClick={() => setOpen(false)}>
                  {cat.name}
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/products" className="mega-view-all" onClick={() => setOpen(false)}>
            View All Products →
          </Link>
        </div>

        {/* Column 2 — Shop by Region */}
        <div className="mega-col" id="megaColStates">
          <div className="mega-heading">SHOP BY REGION</div>
          <ul className="mega-list mega-list-2col">
            {visibleStates.map(s => (
              <li key={s.id}>
                <Link href={`/regions/${s.slug}`} className="mega-list-link" onClick={() => setOpen(false)}>
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/regions" className="mega-view-all" onClick={() => setOpen(false)}>
            View All Regions →
          </Link>
        </div>

        {/* Column 3 — Curated Picks */}
        <div className="mega-col" id="megaColCurated">
          <div className="mega-heading">CURATED PICKS</div>
          <ul className="mega-list">
            {CURATED.map(l => (
              <li key={l.href}>
                <Link href={l.href} className="mega-list-link mega-list-link-bold" onClick={() => setOpen(false)}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

      </div>
    </li>
  )
}
