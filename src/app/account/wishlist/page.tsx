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
