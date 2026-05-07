'use client'

import Link from 'next/link'
import { catSlug } from '@/lib/utils'
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
            {/* ── All Collections ── */}
            <div className="mm-col mm-col-border">
              <div className="mm-col-head">All Collections</div>
              <ul className="mm-list">
                {categories.filter(c => c.is_active).map(cat => (
                  <li key={cat.id}>
                    <Link href={`/collections/${catSlug(cat)}`} className="mm-link" onClick={() => setOpen(false)}>
                      {cat.name}
                    </Link>
                  </li>
                ))}
                <li className="mm-view-all">
                  <Link href="/products" className="mm-view-link" onClick={() => setOpen(false)}>
                    View All Products →
                  </Link>
                </li>
              </ul>
            </div>

            {/* ── Shop by Region ── */}
            <div className="mm-col mm-col-border">
              <div className="mm-col-head">Shop by Region</div>
              <ul className="mm-list mm-list-2col">
                {states.slice(0, 12).map(s => (
                  <li key={s.id}>
                    <Link href={`/regions/${s.slug}`} className="mm-link" onClick={() => setOpen(false)}>
                      {s.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mm-view-all" style={{ marginTop: '12px' }}>
                <Link href="/regions" className="mm-view-link" onClick={() => setOpen(false)}>
                  View All Regions →
                </Link>
              </div>
            </div>

            {/* ── Curated Picks ── */}
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
          background: none;
          border: none;
          cursor: pointer;
          font-family: inherit;
          font-size: 12px;
          font-weight: 600;
          color: rgba(255,255,255,.82);
          letter-spacing: .2px;
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 0 14px;
          height: 62px;
          transition: color .2s;
        }

        .mm-trigger:hover {
          color: #c8920a;
        }

        .mm-panel-wrap {
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          width: 650px;
          padding-top: 6px;
          z-index: 9999;
        }

        .mm-panel {
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 16px 40px rgba(0,0,0,.12);
          border: 1px solid rgba(0,0,0,.05);
          display: grid;
          grid-template-columns: 1fr 1fr 0.9fr;
          overflow: hidden;
        }

        .mm-col {
          padding: 14px 14px;
        }

        .mm-col-border {
          border-right: 1px solid #f0ece4;
        }

        .mm-col-cream {
          background: linear-gradient(160deg,#fdf9f2,#f5ede0);
        }

        .mm-col-head {
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #9a9080;
          margin-bottom: 6px;
          padding-bottom: 5px;
          border-bottom: 1px solid #f0ece4;
        }

        .mm-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        .mm-list-2col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          column-gap: 8px;
          row-gap: 0;
        }

        .mm-link {
          display: block;
          padding: 2px 4px;
          font-size: 12px;
          font-weight: 500;
          line-height: 1.2;
          color: #2a2a2a;
          text-decoration: none;
          border-radius: 6px;
          transition: all .15s ease;
        }

        .mm-link:hover {
          color: #1a3a1e;
          background: #f0f7f0;
          padding-left: 10px;
        }

        .mm-view-all {
          margin-top: 6px;
          padding-top: 6px;
          border-top: 1px solid #f0ece4;
        }

        .mm-view-link {
          font-size: 12.5px;
          font-weight: 700;
          color: #1a3a1e;
          text-decoration: none;
          transition: color .15s;
        }

        .mm-view-link:hover {
          color: #c8920a;
        }

        @media(max-width:900px){
          .mm-panel-wrap {
            display: none;
          }
        }
      `}</style>
    </li>
  )
}
