// BUG FIX (MEDIUM – ReviewsSection client-side SWR): previously this component
// was a 'use client' component that fetched reviews via SWR after hydration,
// causing a visible layout shift (skeleton flash → content pop-in). The fix:
//   1. fetchProductData (server) now fetches full review rows alongside rating
//      aggregates in a single Supabase query.
//   2. This component becomes a pure Server Component that renders from the
//      pre-fetched `reviews` prop — no SWR, no skeleton, no layout shift.
//      Reviews are part of the initial SSR HTML.
//   3. The Stars sub-component gains aria-hidden on individual SVGs and a
//      wrapping aria-label for screen readers (LOW bug fix – inaccessible stars).

import type { Review } from '@/types'
import { formatDate } from '@/lib/utils'

// ─── Stars ───────────────────────────────────────────────────────────────────

function Stars({ n, label }: { n: number; label?: string }) {
  return (
    // BUG FIX (LOW – ReviewsSection SVG stars not accessible): previously star
    // SVGs had no aria-hidden or accessible text. Screen readers announced them
    // as blank interactive elements. Now the wrapper carries the accessible label
    // and each SVG is aria-hidden so it is skipped by assistive technology.
    <div
      className="flex gap-0.5"
      role="img"
      aria-label={label ?? `${n} out of 5 stars`}
    >
      {[1,2,3,4,5].map(i => (
        <svg
          key={i}
          aria-hidden="true"
          className={`w-3.5 h-3.5 ${i <= n ? 'text-earth-400' : 'text-stone-200'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
        </svg>
      ))}
    </div>
  )
}

// ─── ReviewsSection ──────────────────────────────────────────────────────────

interface Props {
  /** Pre-fetched approved reviews from fetchProductData (server-side). */
  reviews: Review[]
}

export default function ReviewsSection({ reviews }: Props) {
  if (!reviews.length) return null

  const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length

  return (
    <section className="border-t border-stone-100 pt-10 mb-12">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-xl font-bold text-stone-900">Customer Reviews</h2>
        <div className="flex items-center gap-2">
          <Stars n={Math.round(avg)} label={`${avg.toFixed(1)} out of 5 stars`} />
          <span className="text-sm font-semibold text-stone-700">
            {avg.toFixed(1)} ({reviews.length})
          </span>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl">
        {reviews.map(r => (
          <div key={r.id} className="bg-stone-50 rounded-xl p-4 border border-stone-100">
            <div className="flex items-center justify-between mb-2">
              <Stars n={r.rating} label={`${r.rating} out of 5 stars`} />
              <span className="text-[11px] text-stone-400">{formatDate(r.created_at)}</span>
            </div>
            {r.review_text && (
              <p className="text-sm text-stone-600 leading-relaxed mb-3 line-clamp-3">&quot;{r.review_text}&quot;</p>
            )}
            <div className="text-xs font-semibold text-stone-700">
              {r.customer_name}{r.location ? ` · ${r.location}` : ''}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
