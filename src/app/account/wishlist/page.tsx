'use client'
// ─────────────────────────────────────────────────────────────
// /account/wishlist
// Shows the saved products from the SAME server-normalized catalogue that
// Browse, Search and /wishlist render from (useSearchCatalog), so a wishlist
// card has the same image, variants and state_id as everywhere else.
//
// History: this page once fetched /api/wishlist expecting products (that route
// only returns IDs, so the page was always empty), and was then switched to a
// browser-side anon query with a hand-written column list. That query had no
// product_images, no state_id (cart items got isHimalayan:false), depended on
// anon RLS for product_variants, and showed the raw DB error string to
// customers. Oct 2026 audit follow-up (same class as Issue 7).
// ─────────────────────────────────────────────────────────────
import { useMemo } from 'react'
import Link from 'next/link'
import { useUserStore }  from '@/store/userStore'
import { useSearchCatalog } from '@/hooks/useSearchCatalog'
import { toCardProductData } from '@/lib/normalizeProduct'
import ProductCard       from '@/components/product/ProductCard'
import { ProductGridSkeleton } from '@/components/ui/Skeleton'
import styles from '../styles/account.module.css'

export default function WishlistPage() {
  const wishlist           = useUserStore(s => s.wishlist)
  const removeFromWishlist = useUserStore(s => s.removeFromWishlist)

  const { data: catalog, isLoading, error } = useSearchCatalog(wishlist.length > 0)

  const products = useMemo(() => {
    if (!catalog) return undefined
    const saved = new Set(wishlist.map(String))
    return catalog.filter(p => saved.has(String(p.id)))
  }, [catalog, wishlist])

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
      ) : error ? (
        <div className={styles.wlError} role="alert">
          We couldn&apos;t load your wishlist right now. Please try again in a moment.
        </div>
      ) : isLoading || !products ? (
        <ProductGridSkeleton count={4} />
      ) : products.length > 0 ? (
        <div className={styles.wlGrid}>
          {products.map(p => (
            <ProductCard key={p.id} product={toCardProductData(p)} showWishlist />
          ))}
        </div>
      ) : (
        // BUG FIX (Oct 2026 audit): this branch used to render `null`, leaving a blank page under a
        // "(N)" count when every saved product had since been archived or removed.
        <div className={styles.wlEmpty}>
          <div className={styles.wlEmptyIcon}>❤️</div>
          <p className={styles.wlEmptyMsg}>Your saved items are no longer available</p>
          <Link href="/products" className={styles.wlEmptyLink}>
            Browse Products →
          </Link>
        </div>
      )}
    </div>
  )
}
