// ═══════════════════════════════════════════════════════════════
// lib/homepageData.ts
// Cached read helpers for homepage sections that used to query Supabase
// directly on every single request (the homepage is force-dynamic, so
// "direct query in a Server Component" meant one DB round trip per visitor
// per section).
//
// Pattern used by large storefronts: shared, tag-invalidated server cache for
// anything that is identical for every visitor. The page itself stays dynamic
// (so it always reflects the latest cached data), but the database is hit at
// most once per TTL no matter how many people load the homepage.
//
// Errors are deliberately NOT swallowed here: unstable_cache never stores a
// thrown result, so a failed fetch is retried on the next request instead of
// freezing an empty list for the whole TTL. Callers keep their own
// fail-safe try/catch (the section simply hides).
// ═══════════════════════════════════════════════════════════════

import { unstable_cache } from 'next/cache'
import { supabase } from './supabase'

export interface HomepageReview {
  id:            string
  customer_name: string | null
  location:      string | null
  rating:        number
  review_text:   string | null
  comment:       string | null
}

/** Latest approved reviews that actually contain text — 5-minute shared cache,
 *  tag 'reviews' (call revalidateTag('reviews') when a review is moderated). */
export const getLatestReviews = unstable_cache(
  async (): Promise<HomepageReview[]> => {
    const { data, error } = await supabase
      .from('reviews')
      .select('id, customer_name, location, rating, review_text, comment')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(3)
    if (error) throw error
    return ((data ?? []) as HomepageReview[]).filter(r => (r.review_text || r.comment || '').trim().length > 0)
  },
  ['home-latest-reviews'],
  { revalidate: 300, tags: ['reviews'] },
)
