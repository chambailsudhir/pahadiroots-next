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

  // Keep mega panel snapped exactly below the sticky navbar
  useEffect(() => {
    function updateTop() {
      const nav = document.querySelector('nav.old-nav') as HTMLElement | null
      if (nav) {
        const rect = nav.getBoundingClientRect()
        setMegaTop(rect.bottom)
      }
    }
    updateTop()
    window.addEventListener('scroll', updateTop, { passive: true })
    window.addEventListener('resize', updateTop, { passive: true })
    return () => {
      window.removeEventListener('scroll', updateTop)
      window.removeEventListener('resize', updateTop)
    }
  }, [])

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (liRef.current && !liRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('click', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  return (
    <li ref={liRef} className={`mega-parent${open ? ' open' : ''}`}>
      <button
        className="mega-trigger"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        Shop <span className="arr">▾</span>
      </button>

      {/* Backdrop */}
      {open && <div className="mega-menu-backdrop" onClick={() => setOpen(false)} />}

      {/* Panel */}
      <div
        className={`mega-menu${open ? ' open' : ''}`}
        style={{ top: megaTop }}
        role="menu"
      >
        {/* Column 1 — Collections */}
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

        {/* Column 2 — Regions */}
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

        {/* Column 3 — Curated */}
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

      <style>{`
        /* ── Trigger — identical to .old-nav-links li a ── */
        .mega-parent {
          list-style: none;
          position: static;
        }
        .mega-trigger {
          background: none;
          border: none;
          cursor: pointer;
          user-select: none;
          display: flex;
          align-items: center;
          gap: 3px;
          color: #2a2a2a;
          font-size: 13.5px;
          font-weight: 600;
          padding: 0 14px;
          height: 64px;
          margin: 0;
          font-family: inherit;
          white-space: nowrap;
          letter-spacing: 0;
          transition: color .2s, background .2s;
          border-radius: 0;
        }
        .mega-trigger:hover,
        .mega-parent.open .mega-trigger {
          color: #1a3a1e;
          background: rgba(26,58,30,.04);
        }
        .mega-trigger .arr {
          font-size: 10px;
          transition: transform .25s ease;
          display: inline-block;
          margin-left: 2px;
          line-height: 1;
        }
        .mega-parent.open .mega-trigger .arr {
          transform: rotate(180deg);
        }

        /* ── Backdrop ── */
        .mega-menu-backdrop {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          z-index: 500;
          background: transparent;
          pointer-events: auto;
        }

        /* ── Panel ── */
        .mega-menu {
          position: fixed;
          left: 50%;
          transform: translateX(-50%) translateY(-10px);
          width: min(960px, 92vw);
          background: #fff;
          border-radius: 0 0 20px 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,.14), 0 4px 16px rgba(0,0,0,.06);
          z-index: 501;
          display: flex;
          gap: 0;
          align-items: stretch;
          overflow: hidden;
          visibility: hidden;
          opacity: 0;
          pointer-events: none;
          transition:
            opacity .22s cubic-bezier(.4,0,.2,1),
            transform .22s cubic-bezier(.4,0,.2,1),
            visibility 0s linear .22s;
        }
        .mega-menu.open {
          visibility: visible;
          opacity: 1;
          pointer-events: auto;
          transform: translateX(-50%) translateY(0);
          transition:
            opacity .22s cubic-bezier(.4,0,.2,1),
            transform .22s cubic-bezier(.4,0,.2,1),
            visibility 0s linear 0s;
        }

        /* ── Three columns ── */
        .mega-col {
          min-width: 0;
          padding: 24px 24px 20px;
          display: flex;
          flex-direction: column;
        }
        #megaColCollections { flex: 1;   background: #fff; }
        #megaColStates      { flex: 1.5; background: #fff; border-left: 1px solid #f0ede6; border-right: 1px solid #f0ede6; }
        #megaColCurated     { flex: 1;   background: #f7f4ee; }

        /* ── Column heading ── */
        .mega-heading {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 2.4px;
          text-transform: uppercase;
          color: #a89f92;
          margin-bottom: 18px;
          flex-shrink: 0;
        }

        /* ── List — aggressive reset to fight Tailwind base + browser UA ── */
        .mega-list {
          list-style: none !important;
          padding: 0 !important;
          margin: 0 !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 0 !important;
        }
        .mega-list li {
          margin: 0 !important;
          padding: 0 !important;
          list-style: none !important;
          line-height: 1 !important;
          display: block !important;
        }
        .mega-list-2col {
          display: grid !important;
          grid-template-columns: 1fr 1fr;
          gap: 0 4px;
        }

        /* ── List links ── */
        .mega-list-link {
          display: flex !important;
          align-items: center !important;
          width: 100% !important;
          padding: 7px 10px !important;
          border-radius: 8px !important;
          font-size: 13.5px !important;
          font-weight: 500 !important;
          color: #2c2c2c !important;
          text-decoration: none !important;
          background: none !important;
          cursor: pointer !important;
          text-align: left !important;
          transition: background .15s, color .15s !important;
          white-space: nowrap !important;
          letter-spacing: .1px !important;
          font-family: inherit !important;
          line-height: 1 !important;
          margin: 0 !important;
          box-sizing: border-box !important;
        }
        .mega-list-link:hover {
          background: rgba(26,58,30,.08) !important;
          color: #1a3a1e !important;
        }
        .mega-list-link-bold { font-weight: 600 !important; color: #2c2c2c !important; }
        .mega-list-link-bold:hover { color: #1a3a1e !important; }

        /* ── View All ── */
        .mega-view-all {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          margin-top: 18px;
          padding-top: 14px;
          font-size: 13px;
          font-weight: 600;
          color: #1a3a1e;
          text-decoration: none;
          transition: gap .15s;
          border-top: 1px solid #edeae2;
          letter-spacing: .1px;
        }
        .mega-view-all:hover { gap: 9px; }

        /* ── Dark mode ── */
        .dark .mega-menu          { background: #0f1f11; box-shadow: 0 20px 60px rgba(0,0,0,.4); }
        .dark #megaColCollections { background: #0f1f11; }
        .dark #megaColStates      { background: #0f1f11; border-color: #1e3a22; }
        .dark #megaColCurated     { background: #0a1a0c; }
        .dark .mega-list-link     { color: #d4e8d4; }
        .dark .mega-list-link:hover { background: rgba(255,255,255,.06); color: #7ec87e; }
        .dark .mega-heading       { color: #4a6b4a; }
        .dark .mega-view-all      { color: #7ec87e; border-color: #1e3a22; }
        .dark .mega-trigger       { color: #d4e8d4; }
        .dark .mega-trigger:hover,
        .dark .mega-parent.open .mega-trigger { color: #7ec87e; background: rgba(255,255,255,.04); }

        /* ── Mobile — hide desktop mega ── */
        @media (max-width: 900px) { .mega-menu { display: none !important; } }
      `}</style>
    </li>
  )
}
