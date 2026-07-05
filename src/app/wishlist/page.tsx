'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { useUserStore } from '@/store/userStore'
import { supabase } from '@/lib/supabase'
import { PRODUCT_SELECT, normalizeProducts } from '@/lib/normalizeProduct'
import ProductCard from '@/components/product/ProductCard'
import { ProductGridSkeleton } from '@/components/ui/Skeleton'
import type { Product } from '@/types'

export default function WishlistPublicPage() {
  const wishlist           = useUserStore(s => s.wishlist)
  const removeFromWishlist = useUserStore(s => s.removeFromWishlist)

  const { data: products, isLoading } = useSWR<Product[]>(
    wishlist.length > 0 ? `wishlist-pub-${wishlist.join(',')}` : null,
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
    .eq('status', 'active')
      return normalizeProducts(data ?? [])
    }
  )

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">My Wishlist</h1>
          {wishlist.length > 0 && (
            <p className="text-stone-400 text-sm mt-0.5">{wishlist.length} saved product{wishlist.length > 1 ? 's' : ''}</p>
          )}
        </div>
        {wishlist.length > 0 && (
          <button onClick={() => wishlist.forEach(id => removeFromWishlist(id))} className="text-xs text-stone-400 hover:text-red-500 transition-colors">
            Clear all
          </button>
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
      ) : isLoading ? (
        <ProductGridSkeleton count={4} />
      ) : (
        <div className="grid grid-cols-2 sm:[grid-template-columns:repeat(auto-fit,minmax(240px,1fr))] gap-4 sm:gap-6">
          {(products || []).map(p => <ProductCard key={p.id} product={p} showWishlist />)}
        </div>
      )}
    </div>
  )
}
