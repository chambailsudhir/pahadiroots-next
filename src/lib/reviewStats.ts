// lib/reviewStats.ts — star average + review count for a product.
//
// BUG FIX (Oct 2026 audit): the PDP computed these from the 10 review rows it displays, so the
// count could never exceed 10 and the average ignored every older review (page text and the
// Product JSON-LD aggregateRating). The aggregate must come from ALL approved ratings; the
// visible rows are only a fallback if that query failed.

export interface ReviewStats { avg: number; count: number }
type RatingRow = { rating: number | null | undefined }

export function computeReviewStats(
  allRatings: ReadonlyArray<RatingRow> | null | undefined,
  visibleRows: ReadonlyArray<RatingRow> | null | undefined,
): ReviewStats | null {
  const rows = allRatings && allRatings.length > 0 ? allRatings : (visibleRows ?? [])
  if (rows.length === 0) return null
  const sum = rows.reduce((acc, r) => acc + (r.rating || 0), 0)
  return { avg: sum / rows.length, count: rows.length }
}
