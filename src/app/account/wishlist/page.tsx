'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { useUserStore } from '@/store/userStore'
import { supabase } from '@/lib/supabase'
import { PRODUCT_SELECT, normalizeProducts } from '@/lib/normalizeProduct'
import ProductCard from '@/components/product/ProductCard'
import { ProductGridSkeleton } from '@/components/ui/Skeleton'
import type { Product } from '@/types'

export default function WishlistPage() {
  const wishlist          = useUserStore(s => s.wishlist)
  const removeFromWishlist = useUserStore(s => s.removeFromWishlist)

  const { data: products, isLoading } = useSWR<Product[]>(
    wishlist.length > 0 ? `wishlist-products-${wishlist.join(',')}` : null,
    async () => {
      const { data } = await supabase
        .from('products')
        .select(`
          id, name, slug, emoji, price, mrp, available_stock, gst_rate,
          image_url, unit_label, badges, category_id,
          is_deleted, status,
          categories:categories(id, name, slug),
          product_variants(id, price, mrp, variant_value, available_stock, is_active)
        `)
        .in('id', wishlist)
        .eq('is_deleted', false)
      return normalizeProducts(data ?? [])
    }
  )

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
          <Link href="/products" className="text-forest-700 text-sm font-semibold hover:underline">
            Browse Products →
          </Link>
        </div>
      ) : isLoading ? (
        <ProductGridSkeleton count={4} />
      ) : products && products.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {products.map(p => (
            <ProductCard key={p.id} product={p} showWishlist />
          ))}
        </div>
      ) : null}
    </div>
  )
}
