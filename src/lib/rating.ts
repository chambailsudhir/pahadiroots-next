// ─────────────────────────────────────────────────────────────────────────────
// lib/rating.ts
//
// BUG FIX (P1 — trust/legal, homepage audit): both ProductCard.tsx (line
// 260) and ReviewsPreview.tsx hardcoded "★★★★★" regardless of the real
// `rating` field that exists on Product and Review — every product and
// every review displayed as a perfect 5/5 no matter what the actual data
// said. Centralizing the star-string logic here means there's exactly one
// place this can go wrong, instead of two components quietly disagreeing
// (or both quietly faking it) the way they did before.
// ─────────────────────────────────────────────────────────────────────────────

/** Renders a 1-5 rating as a 5-character filled/empty star string. Clamps
 *  and rounds defensively — never trust upstream data to already be a
 *  clean integer in range. */
export function starsFor(rating: number | null | undefined): string {
  const n = Math.max(0, Math.min(5, Math.round(rating ?? 0)))
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}
