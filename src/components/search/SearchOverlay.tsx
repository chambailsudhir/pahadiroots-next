'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { useUIStore } from '@/store/uiStore'
import { supabase } from '@/lib/supabase'
import { normalizeProducts, getEffectivePrice, getEffectiveStock } from '@/lib/normalizeProduct'
import { formatPrice } from '@/lib/utils'
import { searchProducts } from '@/lib/productSearch'
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
  const router       = useRouter()
  const inputRef    = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>([])

  // BUG FIX (React 19 / react-hooks/set-state-in-effect lint rule):
  // This component never actually unmounts — it stays mounted in the tree
  // and just returns `null` below when closed, so state persists across
  // opens. The old code called setRecent()/setQuery() synchronously inside
  // a useEffect reacting to `isOpen`, which the new React Compiler-readiness
  // lint flags (effect-triggered setState causes an extra render pass).
  //
  // Fixed using React's documented "adjusting state during render" pattern
  // (see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  // Note this must use useState — NOT useRef — for the previous-value
  // comparison: refs can't be safely read/written during render (React may
  // call a render function multiple times without committing in concurrent
  // mode, so ref mutations could leak across attempts). useState's setter
  // is what makes this pattern safe — React applies it within the same
  // render pass instead of scheduling a second one.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen)
    if (isOpen) {
      setRecent(getRecent())
      setQuery('')
    }
  }

  // BUG FIX (P2): results could previously only be reached by mouse or
  // Tab — a standard search-overlay affordance (arrow keys move a
  // highlight through results, Enter opens the highlighted one) was
  // missing entirely. -1 means nothing highlighted (Enter falls back to
  // the free-text "go to /search" behavior already in place).
  const [activeIndex, setActiveIndex] = useState(-1)
  const [prevQuery, setPrevQuery] = useState(query)
  if (prevQuery !== query) {
    setPrevQuery(query)
    setActiveIndex(-1)
  }

  // Focusing the input is a genuine external-system side effect (the DOM),
  // so this still correctly belongs in an effect.
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(t)
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

  // SEARCH FIX: this used to run `.ilike('name', '%query%')` in SQL — a literal
  // substring match — so "seab" found nothing for "Sea Buckthorn" (the space
  // breaks the substring), and any typo ("hunny") found nothing either. Now the
  // active catalog is fetched ONCE (cached by SWR, shared across keystrokes)
  // and ranked client-side by searchProducts() in lib/productSearch.ts, which
  // ignores spaces/punctuation, matches partial words and forgives small typos.
  // Typing no longer fires a network request per keystroke, either.
  const { data: catalog } = useSWR<Product[]>(
    isOpen ? 'search-overlay-catalog' : null,
    async () => {
      // Joins product_variants (same embed as the shared PRODUCT_SELECT in
      // normalizeProduct.ts, incl. original_price-not-mrp) so the price/stock
      // shown here matches ProductCard.
      const { data } = await supabase
        .from('products')
        .select('id, name, slug, emoji, price, mrp, image_url, available_stock, status, is_deleted, product_variants(id, price, original_price, variant_value, available_stock, is_active)')
        .eq('is_deleted', false)
        .eq('status', 'active')
        .limit(500)
      return normalizeProducts(data ?? [])
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  )

  const results = useMemo(
    () => (catalog && debouncedQ.trim().length >= 2 ? searchProducts(catalog, debouncedQ, 6) : undefined),
    [catalog, debouncedQ],
  )

  function handleSelect(q: string) {
    saveRecent(q)
    closeSearch()
  }

  if (!isOpen) return null

  return (
    // BUG FIX (P2): this behaves exactly like a modal (backdrop, focus
    // trapped visually, Escape closes it) but never declared itself as
    // one — screen reader users got no indication this was a dialog.
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Search products">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeSearch} />

      {/* Panel */}
      {/* BUG FIX (mobile): "mx-auto" and "mx-4" both applied at the base
          breakpoint (mx-4 had no prefix, sm:mx-auto only kicks in at sm+),
          so the two conflicting margin utilities raced on Tailwind's CSS
          source order rather than className order — on some builds this
          left the panel flush against the screen edges on mobile instead
          of the intended 16px breathing room. Removed the redundant base
          mx-auto so mx-4 always wins on mobile, sm:mx-auto takes over once
          max-w-xl actually has room to center. */}
      <div className="relative z-10 max-w-xl mt-16 mx-4 sm:mx-auto px-4">
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
                // total selectable rows = product results + the trailing
                // "See all results" row (only present when there are any
                // results at all)
                const rowCount = results && results.length > 0 ? results.length + 1 : 0

                if (e.key === 'ArrowDown' && rowCount > 0) {
                  e.preventDefault()
                  setActiveIndex(i => (i + 1) % rowCount)
                  return
                }
                if (e.key === 'ArrowUp' && rowCount > 0) {
                  e.preventDefault()
                  setActiveIndex(i => (i - 1 + rowCount) % rowCount)
                  return
                }
                if (e.key === 'Enter' && activeIndex >= 0 && results) {
                  e.preventDefault()
                  if (activeIndex < results.length) {
                    const p = results[activeIndex]
                    handleSelect(p.name)
                    router.push(`/products/${p.slug}`)
                  } else {
                    handleSelect(query)
                    router.push(`/search?q=${encodeURIComponent(query.trim())}`)
                  }
                  return
                }
                if (e.key === 'Enter' && query.trim()) {
                  saveRecent(query.trim())
                  closeSearch()
                  // BUG FIX (P2): this used window.location.href — a full
                  // page reload — while the "See all results" link right
                  // below uses <Link> for a fast client-side transition to
                  // the exact same destination. Pressing Enter (the more
                  // common way to submit a search) was the slower path.
                  router.push(`/search?q=${encodeURIComponent(query.trim())}`)
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
                No products found for &quot;{query}&quot;
              </div>
            )}

            {results && results.length > 0 && (
              <ul>
                {results.map((p, idx) => (
                  <li key={p.id}>
                    <Link
                      href={`/products/${p.slug}`}
                      onClick={() => handleSelect(p.name)}
                      className={`flex items-center gap-3 px-4 py-3 transition-colors ${idx === activeIndex ? 'bg-stone-100' : 'hover:bg-stone-50'}`}
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
                        <div className="text-xs text-stone-400">{formatPrice(getEffectivePrice(p))}</div>
                      </div>
                      {getEffectiveStock(p) === 0 && (
                        <span className="text-[10px] text-stone-400">Out of stock</span>
                      )}
                    </Link>
                  </li>
                ))}
                <li className="border-t border-stone-100">
                  <Link
                    href={`/search?q=${encodeURIComponent(query)}`}
                    onClick={() => handleSelect(query)}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold text-forest-700 transition-colors ${activeIndex === results.length ? 'bg-stone-100' : 'hover:bg-stone-50'}`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                    See all results for &quot;{query}&quot;
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
