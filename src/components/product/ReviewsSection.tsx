'use client'

import useSWR from 'swr'
import type { Review } from '@/types'
import { formatDate } from '@/lib/utils'
import { supabase } from '@/lib/supabase'

function Stars({ n }: { n: number }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(i => (
        <svg key={i} className={`w-3.5 h-3.5 ${i <= n ? 'text-earth-400' : 'text-stone-200'}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
        </svg>
      ))}
    </div>
  )
}

export default function ReviewsSection({ productId }: { productId: string | number }) {
  const { data: reviews, isLoading } = useSWR<Review[]>(
    `reviews-${productId}`,
    async () => {
      const { data } = await supabase
        .from('reviews')
        .select('id, customer_name, location, rating, review_text, is_active, product_id, created_at')
        .eq('product_id', productId)
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(10)
      return (data as unknown as Review[]) || []
    }
  )

  if (isLoading) return (
    <section className="border-t border-stone-100 pt-10 mb-12">
      <div className="h-5 w-36 skeleton rounded mb-4" />
      <div className="space-y-3">
        {[1,2,3].map(i => <div key={i} className="h-20 skeleton rounded-xl" />)}
      </div>
    </section>
  )

  if (!reviews?.length) return null

  const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length

  return (
    <section className="border-t border-stone-100 pt-10 mb-12">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-xl font-bold text-stone-900">Customer Reviews</h2>
        <div className="flex items-center gap-2">
          <Stars n={Math.round(avg)} />
          <span className="text-sm font-semibold text-stone-700">
            {avg.toFixed(1)} ({reviews.length})
          </span>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl">
        {reviews.map(r => (
          <div key={r.id} className="bg-stone-50 rounded-xl p-4 border border-stone-100">
            <div className="flex items-center justify-between mb-2">
              <Stars n={r.rating} />
              <span className="text-[11px] text-stone-400">{formatDate(r.created_at)}</span>
            </div>
            {r.review_text && (
              <p className="text-sm text-stone-600 leading-relaxed mb-3 line-clamp-3">"{r.review_text}"</p>
            )}
            <div className="text-xs font-semibold text-stone-700">{r.customer_name}{r.location ? ` · ${r.location}` : ''}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
