// ═══════════════════════════════════════════════════════════════
// /api/v1/cart-reviews — the customer reviews shown on the cart page
//
// Nov 2026: the cart used to show three hard-coded testimonials ("Priya M., Delhi", "Rahul S., Mumbai", "Anita K., Bangalore") that were
// not tied to any real review — a deceptive-content risk under India's consumer-protection rules. This returns REAL reviews only: the
// same source and filter the home page uses (status = 'approved', newest first, text present; see lib/homepageData). When there are
// none the list is empty and the cart simply shows no reviews box — never a placeholder.
//
// Not cherry-picked: the latest approved reviews are returned whatever their rating, each with its own real star rating.
// Privacy: only "First L." is exposed, never the full name.
// ═══════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server'
import { getLatestReviews } from '@/lib/homepageData'
import { logger } from '@/lib/logger'

export interface CartReviewDto { name: string; location: string; text: string; rating: number }

/** "Priya Sharma" → "Priya S."; a single name stays as is; blank → ''. */
export function publicReviewerName(raw: string | null | undefined): string {
  const parts = String(raw ?? '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
  if (parts.length === 0) return ''
  const first = parts[0].slice(0, 30)
  return parts.length === 1 ? first : `${first} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`
}

export async function GET() {
  const headers = { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' }
  try {
    const rows = await getLatestReviews()
    const reviews: CartReviewDto[] = rows
      .map(r => ({
        name:     publicReviewerName(r.customer_name),
        location: String(r.location ?? '').trim().slice(0, 40),
        text:     String(r.review_text || r.comment || '').trim().slice(0, 280),
        // A review without a real rating is left out rather than shown with an invented score; a rating above 5 is capped.
        rating:   Math.min(5, Math.round(Number(r.rating) || 0)),
      }))
      .filter(r => r.name && r.text && r.rating >= 1)
    return NextResponse.json({ reviews }, { headers })
  } catch (err) {
    // A failed read shows no reviews box — never a made-up one.
    logger.error('cart-reviews failed', { action: 'cart_reviews.get', error: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ reviews: [] }, { status: 200 })
  }
}
