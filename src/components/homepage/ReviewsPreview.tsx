import { supabase } from '@/lib/supabase'
import { starsFor } from '@/lib/rating'

// BUG FIX (P1 — trust/legal): this component previously rendered 3
// hardcoded testimonials, each labeled "Verified Buyer", that were never
// tied to a real purchase or review record. Fabricated reviews labeled as
// verified is a real deceptive-advertising risk (India's Consumer
// Protection (E-Commerce) Rules; FTC-style fake-review norms elsewhere) —
// not just a cosmetic shortcut.
//
// Fix: query the SAME `reviews` table + `status = 'approved'` filter the
// PDP already uses (src/app/products/[slug]/page.tsx), across all
// products, newest-first. No fallback to placeholder content — if there
// aren't yet 3 approved reviews, the section simply doesn't render (same
// "return null when there's nothing honest to show" pattern already used
// by FeaturedBanner.tsx elsewhere on this page), rather than silently
// re-introducing fake content.
//
// Also fixes the star rating: the old version hardcoded ★★★★★ regardless
// of content: now renders the review's own real `rating` (1-5).
//
// FOUND IN A LATER RE-AUDIT: even after switching to real reviews, this
// still labeled every single one "Verified Buyer" — but nothing in the
// submission pipeline actually verifies a purchase. reviewSchema (lib/
// schemas/index.ts) accepts an optional order_id, but the submit_review
// handler in api/v1/actions/route.ts never reads or stores it, and the
// `reviews` table itself has no purchase-verification column at all. Any
// logged-in user can review any product regardless of whether they
// bought it. Removed the claim rather than keep asserting something the
// system can't actually back up — same category of issue as the
// original fake-testimonials bug, just one layer deeper. Building real
// purchase verification (storing order_id, checking it against a
// completed order containing that product) would be a good follow-up if
// wanted, but is a schema change + feature build, not a one-line fix.

interface HomepageReview {
  id:            string
  customer_name: string | null
  location:      string | null
  rating:        number
  review_text:   string | null
  comment:       string | null
}

function initialOf(name: string | null | undefined): string {
  // BUG FIX (audit): customer_name can be NULL in the reviews table; the old
  // `name.trim()` threw during render — outside the try/catch above — which
  // 500'd the ENTIRE homepage for as long as that review stayed in the
  // latest-3 window.
  const trimmed = (name ?? '').trim()
  return trimmed ? trimmed[0].toUpperCase() : '?'
}

export default async function ReviewsPreview() {
  let reviews: HomepageReview[] = []

  try {
    const { data, error } = await supabase
      .from('reviews')
      .select('id, customer_name, location, rating, review_text, comment')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(3)

    if (error) throw error
    reviews = (data ?? []).filter(r => (r.review_text || r.comment || '').trim().length > 0)
  } catch {
    // Non-fatal — homepage renders fine without this section, same
    // fail-safe pattern used by every other data-driven homepage section.
    return null
  }

  if (reviews.length === 0) return null

  return (
    <section className="rev-bg">
      <div className="ct">
        <div className="chip">💬 Community Love</div>
        <h2 className="sh2">What Our Customers Say</h2>
        <p className="ssub">Real people, real mountains, real taste.</p>
      </div>

      <div className="rgrid">
        {reviews.map((r) => {
          const text = (r.review_text || r.comment || '').trim()
          return (
            <div key={r.id} className="rcard">
              <div className="rq">&quot;</div>
              <div className="rstars" aria-label={`Rated ${r.rating} out of 5`}>{starsFor(r.rating)}</div>
              <p className="rtxt">&quot;{text}&quot;</p>
              <div className="rauth">
                <div className="rav">{initialOf(r.customer_name)}</div>
                <div>
                  <div className="ran">{r.customer_name?.trim() || 'Customer'}</div>
                  <div className="rloc">{r.location || 'Customer'}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
