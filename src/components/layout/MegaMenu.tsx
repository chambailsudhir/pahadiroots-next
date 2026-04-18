'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { Category, State } from '@/types'

interface Props {
  categories: Category[]
  states:     State[]
}

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
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        className="flex items-center gap-1 text-sm font-medium text-stone-700 hover:text-forest-700 transition-colors py-1"
        aria-expanded={open}
      >
        Shop
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-0 pt-3 z-50 w-[760px]">
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-100 overflow-hidden">
            <div className="grid grid-cols-3 gap-0">

              {/* All Collections */}
              <div className="p-6 border-r border-stone-100">
                <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-3">
                  All Collections
                </div>
                <ul className="space-y-1.5">
                  {categories.filter(c => c.is_active).map(cat => (
                    <li key={cat.id}>
                      <Link
                        href={`/collections/${cat.slug}`}
                        className="text-sm text-stone-600 hover:text-forest-700 hover:translate-x-0.5 transition-all inline-block"
                        onClick={() => setOpen(false)}
                      >
                        {cat.name}
                      </Link>
                    </li>
                  ))}
                  <li className="pt-1">
                    <Link
                      href="/products"
                      className="text-sm font-semibold text-forest-700 hover:text-forest-900"
                      onClick={() => setOpen(false)}
                    >
                      View All Products →
                    </Link>
                  </li>
                </ul>
              </div>

              {/* Shop by Region */}
              <div className="p-6 border-r border-stone-100">
                <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-3">
                  Shop by Region
                </div>
                <ul className="space-y-1.5">
                  {states.slice(0, 10).map(state => (
                    <li key={state.id}>
                      <Link
                        href={`/regions/${state.slug}`}
                        className="text-sm text-stone-600 hover:text-forest-700 hover:translate-x-0.5 transition-all inline-block"
                        onClick={() => setOpen(false)}
                      >
                        {state.name}
                      </Link>
                    </li>
                  ))}
                  <li className="pt-1">
                    <Link
                      href="/regions"
                      className="text-sm font-semibold text-forest-700 hover:text-forest-900"
                      onClick={() => setOpen(false)}
                    >
                      All Regions →
                    </Link>
                  </li>
                </ul>
              </div>

              {/* Curated + Featured banner */}
              <div className="p-6">
                <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-3">
                  Curated For You
                </div>
                <ul className="space-y-1.5 mb-5">
                  {CURATED.map(item => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="text-sm text-stone-600 hover:text-forest-700 hover:translate-x-0.5 transition-all inline-block"
                        onClick={() => setOpen(false)}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>

                {/* Mini banner */}
                <div className="rounded-xl bg-forest-50 border border-forest-100 p-4">
                  <div className="text-xs font-bold text-forest-800 mb-1">
                    🏔️ Direct from Mountains
                  </div>
                  <p className="text-[11px] text-forest-700 leading-relaxed">
                    Every product sourced directly from mountain farming communities across the Himalayas.
                  </p>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  )
}
