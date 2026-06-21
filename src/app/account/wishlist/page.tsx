'use client'
// ─────────────────────────────────────────────────────────────
// /account/wishlist
// Fixed:
//  ✅ Supabase client → /api/wishlist route (cookie auth)
//  ✅ Removed mounted anti-pattern
//  ✅ Proper loading / error / empty states
//  ✅ Migrated from Tailwind to account.module.css
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useUserStore }  from '@/store/userStore'
import ProductCard       from '@/components/product/ProductCard'
import { ProductGridSkeleton } from '@/components/ui/Skeleton'
import type { Product }  from '@/types'
import styles from '../styles/account.module.css'

export default function WishlistPage() {
  const wishlist           = useUserStore(s => s.wishlist)
  const removeFromWishlist = useUserStore(s => s.removeFromWishlist)

  const [products, setProducts] = useState<Product[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  // Stable string key derived from wishlist — also resolves two pre-existing
  // exhaustive-deps warnings: using `wishlist.join(',')` directly in the
  // effect's dependency array was both a "complex expression" (should be a
  // plain identifier) and meant `wishlist` itself wasn't listed even though
  // it's read inside the effect body.
  const wishlistKey = wishlist.join(',')

  // BUG FIX (React 19 / react-hooks/set-state-in-effect lint rule): the
  // empty-wishlist reset (setProducts([])) was the early-return branch of
  // the fetch effect below, calling setState synchronously in the body.
  // This is a true value-transition case (reacting to the wishlist becoming
  // empty), so it's pulled out using React's documented "adjusting state
  // during render" pattern. Sentinel `null` default makes this also fire on
  // the very first render in case the wishlist starts empty.
  const [prevWishlistKey, setPrevWishlistKey] = useState<string | null>(null)
  if (prevWishlistKey !== wishlistKey) {
    setPrevWishlistKey(wishlistKey)
    if (wishlist.length === 0) setProducts([])
  }

  useEffect(() => {
    if (wishlist.length === 0) return
    const ctrl = new AbortController()
    // Standard "reset state before initiating an async fetch" pattern —
    // React's own documented idiom for effect-based data fetching (see
    // https://react.dev/reference/react/useEffect#fetching-data-with-effects).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError('')
    fetch(`/api/wishlist?ids=${wishlistKey}`, { signal: ctrl.signal })
      .then(async r => {
        if (!r.ok) throw new Error('Failed to load wishlist')
        const data = await r.json()
        if (!ctrl.signal.aborted) setProducts(data.products ?? [])
      })
      .catch(e => { if (!ctrl.signal.aborted) setError(e?.message || 'Failed to load') })
      .finally(()=> { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [wishlistKey, wishlist.length])

  return (
    <div className={styles.wlRoot}>
      <div className={styles.wlHeader}>
        <h1 className={styles.wlTitle}>
          Wishlist
          {wishlist.length > 0 && (
            <span className={styles.wlCount}>({wishlist.length})</span>
          )}
        </h1>
        {wishlist.length > 0 && (
          <button
            type="button"
            onClick={() => wishlist.forEach(id => removeFromWishlist(id))}
            className={styles.wlClearBtn}
          >
            Clear all
          </button>
        )}
      </div>

      {wishlist.length === 0 ? (
        <div className={styles.wlEmpty}>
          <div className={styles.wlEmptyIcon}>❤️</div>
          <p className={styles.wlEmptyMsg}>Your wishlist is empty</p>
          <Link href="/products" className={styles.wlEmptyLink}>
            Browse Products →
          </Link>
        </div>
      ) : loading ? (
        <ProductGridSkeleton count={4} />
      ) : error ? (
        <div className={styles.wlError}>{error}</div>
      ) : products.length > 0 ? (
        <div className={styles.wlGrid}>
          {products.map(p => (
            <ProductCard key={p.id} product={p} showWishlist />
          ))}
        </div>
      ) : null}
    </div>
  )
}
