'use client'

import Link from 'next/link'
import { useState } from 'react'
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
  const [open, setOpen] = useState(false)
  const visibleCategories = categories.filter(c => c.is_active).slice(0, 8)
  const visibleStates = states.slice(0, 10)

  return (
    <li
      style={{ listStyle: 'none', position: 'relative' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button className="mm-trigger" aria-expanded={open}>
        Shop
        <svg
          width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth={2.5}
          style={{ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="mm-panel-wrap">
          <div className="mm-panel">
            <div className="mm-col mm-col-border">
              <div className="mm-col-head">All Collections</div>
              <ul className="mm-list">
                {visibleCategories.map(cat => (
                  <li key={cat.id}>
                    <Link href={`/collections/${catSlug(cat)}`} className="mm-link" onClick={() => setOpen(false)}>
                      {cat.name}
                    </Link>
                  </li>
                ))}
                <li className="mm-view-all">
                  <Link href="/products" className="mm-view-link" onClick={() => setOpen(false)}>
                    View All Products ->
                  </Link>
                </li>
              </ul>
            </div>

            <div className="mm-col mm-col-border">
              <div className="mm-col-head">Shop by Region</div>
              <ul className="mm-list mm-list-2col">
                {visibleStates.map(s => (
                  <li key={s.id}>
                    <Link href={`/regions/${s.slug}`} className="mm-link" onClick={() => setOpen(false)}>
                      {s.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mm-view-all" style={{ marginTop: '22px' }}>
                <Link href="/regions" className="mm-view-link" onClick={() => setOpen(false)}>
                  View All Regions ->
                </Link>
              </div>
            </div>

            <div className="mm-col mm-col-cream">
              <div className="mm-col-head">Curated Picks</div>
              <ul className="mm-list">
                {CURATED.map(l => (
                  <li key={l.href}>
                    <Link href={l.href} className="mm-link" onClick={() => setOpen(false)}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .mm-trigger {
          background: transparent;
          border: 1.5px solid transparent;
          border-radius: 24px;
          color: #2a2a2a;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 5px;
          font-family: inherit;
          font-size: 14px;
          font-weight: 700;
          height: 42px;
          letter-spacing: 0;
          margin-top: 11px;
          padding: 0 16px;
          transition: color .2s, border-color .2s, background .2s, box-shadow .2s;
        }
        .mm-trigger:hover,
        .mm-trigger[aria-expanded="true"] {
          background: #fff;
          border-color: #1f1f1f;
          box-shadow: 0 1px 5px rgba(0,0,0,.08);
          color: #1a1a1a;
        }
        .mm-panel-wrap {
          position: fixed;
          top: 138px;
          left: 50%;
          transform: translateX(-50%);
          width: min(960px, calc(100vw - 96px));
          z-index: 9999;
        }
        .mm-panel {
          background: #fff;
          border: 1px solid rgba(0,0,0,.07);
          border-top: none;
          border-radius: 0 0 14px 14px;
          box-shadow: 0 18px 50px rgba(22,20,16,.14);
          display: grid;
          grid-template-columns: 1.05fr 1.45fr .95fr;
          min-height: 380px;
          overflow: hidden;
        }
        .mm-col { padding: 30px 28px; }
        .mm-col-border { border-right: 1px solid #f0ece4; }
        .mm-col-cream { background: #f5f0e7; }
        .mm-col-head {
          color: #b1a28d;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 4px;
          margin-bottom: 20px;
          text-transform: uppercase;
        }
        .mm-list {
          display: flex;
          flex-direction: column;
          gap: 9px;
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .mm-list-2col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px 34px;
        }
        .mm-link {
          border-radius: 9px;
          color: #2c241b;
          display: block;
          font-size: 15px;
          font-weight: 500;
          line-height: 1.35;
          padding: 3px 10px;
          text-decoration: none;
          transition: color .15s, background .15s, transform .15s;
        }
        .mm-link:hover {
          background: #f2f7ef;
          color: #1a3a1e;
          transform: translateX(3px);
        }
        .mm-view-all {
          border-top: none;
          margin-top: 22px;
          padding-top: 0;
        }
        .mm-view-link {
          align-items: center;
          background: #fff;
          border: 1px solid #eee7db;
          border-radius: 999px;
          color: #2c241b;
          display: inline-flex;
          font-size: 15px;
          font-weight: 800;
          min-width: 220px;
          padding: 11px 16px;
          text-decoration: none;
          transition: color .15s, border-color .15s, box-shadow .15s;
        }
        .mm-view-link:hover {
          border-color: #d8cbb8;
          box-shadow: 0 8px 24px rgba(0,0,0,.06);
          color: #1a3a1e;
        }
        @media(max-width:1100px){
          .mm-panel-wrap { width: min(900px, calc(100vw - 48px)); }
          .mm-col { padding: 26px 24px; }
        }
        @media(max-width:900px){ .mm-panel-wrap { display: none; } }
      `}</style>
    </li>
  )
}
