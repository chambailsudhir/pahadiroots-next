'use client'
// ─────────────────────────────────────────────────────────────
// /account/wishlist
// Fixed:
//  ✅ Supabase client → /api/wishlist route (cookie auth)
//  ✅ Removed mounted anti-pattern
//  ✅ Proper loading / error / empty states
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useUserStore }  from '@/store/userStore'
import ProductCard       from '@/components/product/ProductCard'
import { ProductGridSkeleton } from '@/components/ui/Skeleton'
import type { Product }  from '@/types'

export default function WishlistPage() {
  const wishlist           = useUserStore(s => s.wishlist)
  const removeFromWishlist = useUserStore(s => s.removeFromWishlist)

  const [products, setProducts] = useState<Product[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    if (wishlist.length === 0) { setProducts([]); return }
    const ctrl = new AbortController()
    setLoading(true)
    setError('')
    fetch(`/api/wishlist?ids=${wishlist.join(',')}`, { signal: ctrl.signal })
      .then(async r => {
        if (!r.ok) throw new Error('Failed to load wishlist')
        const data = await r.json()
        if (!ctrl.signal.aborted) setProducts(data.products ?? [])
      })
      .catch(e => { if (!ctrl.signal.aborted) setError(e?.message || 'Failed to load') })
      .finally(()=> { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [wishlist.join(',')])

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold text-stone-900">
          Wishlist
          {wishlist.length > 0 && (
            <span className="ml-2 text-sm font-normal text-stone-400">({wishlist.length})</span>
          )}
        </h1>
        {wishlist.length > 0 && (
          <button
            onClick={() => wishlist.forEach(id => removeFromWishlist(id))}
            className="text-xs text-stone-400 hover:text-red-500 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {wishlist.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-stone-200 rounded-2xl">
          <div className="text-4xl mb-3">❤️</div>
          <p className="text-stone-400 text-sm mb-3">Your wishlist is empty</p>
          <Link href="/products" className="text-green-700 text-sm font-semibold hover:underline">
            Browse Products →
          </Link>
        </div>
      ) : loading ? (
        <ProductGridSkeleton count={4} />
      ) : error ? (
        <div className="text-center py-8 text-red-500 text-sm">{error}</div>
      ) : products.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {products.map(p => (
            <ProductCard key={p.id} product={p} showWishlist />
          ))}
        </div>
      ) : null}
    </div>
  )
}
