'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useUserStore } from '@/store/userStore'
import { useSearchCatalog } from '@/hooks/useSearchCatalog'
import { toCardProductData } from '@/lib/normalizeProduct'
import ProductCard from '@/components/product/ProductCard'
import { ProductGridSkeleton } from '@/components/ui/Skeleton'

export default function WishlistPublicPage() {
  const wishlist           = useUserStore(s => s.wishlist)
  const removeFromWishlist = useUserStore(s => s.removeFromWishlist)
  const [confirmingClear, setConfirmingClear] = useState(false)   // destructive + synced to the account → confirm first

  // BUG FIX (same class as Issue 7, Oct 2026 audit — found in this pass): this
  // page queried `products` straight from the browser with the anon key and a
  // hand-written column list. That list had no `product_images` (cards used the
  // legacy products.image_url instead of the image Browse shows), no
  // `state_id` (so items added to the cart from here always got
  // isHimalayan:false), depended on anon RLS for product_variants, and a failed
  // query was swallowed into an empty page. It now filters the SAME
  // server-normalized catalogue Browse and Search render from, and surfaces a
  // load failure instead of showing an empty wishlist.
  const { data: catalog, isLoading, error } = useSearchCatalog(wishlist.length > 0)

  const products = useMemo(() => {
    if (!catalog) return undefined
    const saved = new Set(wishlist.map(String))
    return catalog.filter(p => saved.has(String(p.id)))
  }, [catalog, wishlist])

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">My Wishlist</h1>
          {wishlist.length > 0 && (
            <p className="text-stone-400 text-sm mt-0.5">{wishlist.length} saved product{wishlist.length > 1 ? 's' : ''}</p>
          )}
        </div>
        {wishlist.length > 0 && !confirmingClear && (
          <button type="button" onClick={() => setConfirmingClear(true)} className="text-xs text-stone-400 hover:text-red-500 transition-colors">
            Clear all
          </button>
        )}
        {wishlist.length > 0 && confirmingClear && (
          <div role="alertdialog" aria-labelledby="wl-clear-q" className="flex items-center gap-3 text-xs text-stone-600">
            <span id="wl-clear-q">Remove all {wishlist.length} saved item{wishlist.length === 1 ? '' : 's'}?</span>
            <button type="button" autoFocus onClick={() => { [...wishlist].forEach(id => removeFromWishlist(id)); setConfirmingClear(false) }} className="font-semibold text-red-600">
              Yes, remove all
            </button>
            <button type="button" onClick={() => setConfirmingClear(false)} className="text-stone-400 hover:text-stone-700">
              Cancel
            </button>
          </div>
        )}
      </div>

      {wishlist.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">❤️</div>
          <h2 className="text-lg font-semibold text-stone-700 mb-2">Your wishlist is empty</h2>
          <p className="text-stone-400 text-sm mb-5">Save products you love by clicking the heart icon</p>
          <Link href="/products" className="inline-flex items-center gap-2 bg-forest-700 hover:bg-forest-800 text-white font-bold px-6 py-3 rounded-xl text-sm transition-colors">
            Browse Products
          </Link>
        </div>
      ) : error ? (
        <div className="text-center py-20" role="alert">
          <h2 className="text-lg font-semibold text-stone-700 mb-2">We couldn&apos;t load your wishlist</h2>
          <p className="text-stone-400 text-sm">Please check your connection and try again in a moment.</p>
        </div>
      ) : isLoading || !products ? (
        <ProductGridSkeleton count={4} />
      ) : products.length === 0 ? (
        // BUG FIX (Oct 2026 audit): when every saved product has since been archived/removed, the
        // catalogue loaded fine but matched nothing, and the page showed a heading with a count
        // and then an empty grid. Say what happened.
        <div className="text-center py-20">
          <h2 className="text-lg font-semibold text-stone-700 mb-2">Your saved items are no longer available</h2>
          <p className="text-stone-400 text-sm mb-5">They may have been removed from our catalogue. Clear them above, or find something new.</p>
          <Link href="/products" className="inline-flex items-center gap-2 bg-forest-700 hover:bg-forest-800 text-white font-bold px-6 py-3 rounded-xl text-sm transition-colors">
            Browse Products
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(220px,300px))] sm:justify-center gap-4 sm:gap-6">
          {products.map(p => <ProductCard key={p.id} product={toCardProductData(p)} showWishlist />)}
        </div>
      )}
    </div>
  )
}
