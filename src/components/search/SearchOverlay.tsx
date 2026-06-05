'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import useSWR from 'swr'
import { useUIStore } from '@/store/uiStore'
import { supabase } from '@/lib/supabase'
import { normalizeProducts } from '@/lib/normalizeProduct'
import { formatPrice } from '@/lib/utils'
import type { Product } from '@/types'

const RECENT_KEY = 'pr-recent-searches'

function getRecent(): string[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}
function saveRecent(q: string) {
  const prev = getRecent().filter(s => s !== q)
  localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...prev].slice(0, 5)))
}

export default function SearchOverlay() {
  const isOpen      = useUIStore(s => s.isSearchOpen)
  const closeSearch = useUIStore(s => s.closeSearch)
  const inputRef    = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    if (isOpen) {
      setRecent(getRecent())
      setTimeout(() => inputRef.current?.focus(), 50)
      setQuery('')
    }
  }, [isOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeSearch()
    if (isOpen) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, closeSearch])

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  const debouncedQ = useDebounce(query, 250)

  const { data: results } = useSWR<Product[]>(
    debouncedQ.length >= 2 ? `search-${debouncedQ}` : null,
    async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, slug, emoji, price, mrp, image_url, available_stock, status, is_deleted')
        .eq('is_deleted', false)
    .eq('status', 'active')
                .ilike('name', `%${debouncedQ}%`)
        .limit(6)
      return normalizeProducts(data ?? [])
    }
  )

  function handleSelect(q: string) {
    saveRecent(q)
    closeSearch()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeSearch} />

      {/* Panel */}
      <div className="relative z-10 max-w-xl mx-auto mt-16 mx-4 sm:mx-auto px-4">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">

          {/* Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-100">
            <svg className="w-5 h-5 text-stone-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && query.trim()) {
                  saveRecent(query.trim())
                  closeSearch()
                  window.location.href = `/search?q=${encodeURIComponent(query.trim())}`
                }
              }}
              placeholder="Search for honey, spices, grains…"
              className="flex-1 text-sm text-stone-800 outline-none placeholder:text-stone-400 bg-transparent"
              autoComplete="off"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search" className="text-stone-300 hover:text-stone-500">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            <button onClick={closeSearch} aria-label="Close search" className="text-xs text-stone-400 hover:text-stone-600 px-2 py-1 border border-stone-200 rounded-lg">
              esc
            </button>
          </div>

          {/* Results */}
          <div className="max-h-80 overflow-y-auto">
            {query.length >= 2 && results?.length === 0 && (
              <div className="text-center py-8 text-sm text-stone-400">
                No products found for "{query}"
              </div>
            )}

            {results && results.length > 0 && (
              <ul>
                {results.map(p => (
                  <li key={p.id}>
                    <Link
                      href={`/products/${p.slug}`}
                      onClick={() => handleSelect(p.name)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50 transition-colors"
                    >
                      <div className="relative w-10 h-10 shrink-0 rounded-lg overflow-hidden bg-stone-100">
                        {p.image_url ? (
                          <Image src={p.image_url} alt={p.name} fill sizes="40px" className="object-cover" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-lg">{p.emoji || '🌿'}</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-stone-800 truncate">{p.name}</div>
                        <div className="text-xs text-stone-400">{formatPrice(p.price)}</div>
                      </div>
                      {p.available_stock === 0 && (
                        <span className="text-[10px] text-stone-400">Out of stock</span>
                      )}
                    </Link>
                  </li>
                ))}
                <li className="border-t border-stone-100">
                  <Link
                    href={`/search?q=${encodeURIComponent(query)}`}
                    onClick={() => handleSelect(query)}
                    className="flex items-center gap-2 px-4 py-3 text-sm font-semibold text-forest-700 hover:bg-stone-50 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                    See all results for "{query}"
                  </Link>
                </li>
              </ul>
            )}

            {/* Recent searches */}
            {query.length < 2 && recent.length > 0 && (
              <div className="p-4">
                <div className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">Recent</div>
                <div className="flex flex-wrap gap-2">
                  {recent.map(s => (
                    <button
                      key={s}
                      onClick={() => setQuery(s)}
                      className="text-sm text-stone-600 bg-stone-100 hover:bg-stone-200 px-3 py-1.5 rounded-full transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {query.length < 2 && recent.length === 0 && (
              <div className="p-6 text-center text-sm text-stone-400">
                Start typing to search for products
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}
