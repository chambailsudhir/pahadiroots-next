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
import { supabase } from '@/lib/supabase'
import { normalizeProducts, toCardProductData } from '@/lib/normalizeProduct'
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

  // BUG FIX (CRITICAL — found while investigating image-loading complaints,
  // approved to fix without further check-in): this used to call
  // `fetch('/api/wishlist?ids=' + wishlistKey)` and read `data.products` from
  // the response. But /api/wishlist's GET handler completely ignores the
  // `ids` query param and its documented, actual contract is
  // `{ wishlist: string[] }` (just the saved product IDs, re-read from the
  // customer's own row) — never `{ products: [...] }`. That meant
  // `data.products` was always `undefined`, `setProducts(undefined ?? [])`
  // always set an empty array, and this page rendered nothing for every
  // single user, every time, regardless of how many items were actually
  // wishlisted. Fixed by querying Supabase directly for the product rows by
  // ID — the same working pattern already used by the sibling /wishlist
  // page (src/app/wishlist/page.tsx) — instead of a server route whose
  // actual job (per its own header comment) is wishlist-ID persistence, not
  // product-data lookup.
  useEffect(() => {
    if (wishlist.length === 0) return
    const ctrl = new AbortController()
    // Standard "reset state before initiating an async fetch" pattern —
    // React's own documented idiom for effect-based data fetching (see
    // https://react.dev/reference/react/useEffect#fetching-data-with-effects).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError('')
    async function load() {
      try {
        const { data, error: dbError } = await supabase
          .from('products')
          .select(`
            id, name, slug, emoji, price, selling_price, mrp, available_stock, gst_rate,
            image_url, unit_label, badges, category_id,
            is_deleted, status,
            categories:categories(id, name, slug),
            product_variants(id, price, original_price, variant_value, available_stock, is_active)
          `)
          .in('id', wishlistKey.split(','))
          .eq('is_deleted', false)
          .eq('status', 'active')
        if (ctrl.signal.aborted) return
        if (dbError) throw dbError
        setProducts(normalizeProducts(data ?? []))
      } catch (e: unknown) {
        if (!ctrl.signal.aborted) {
          setError(e instanceof Error ? e.message : 'Failed to load')
        }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }
    load()
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
            <ProductCard key={p.id} product={toCardProductData(p)} showWishlist />
          ))}
        </div>
      ) : null}
    </div>
  )
}
