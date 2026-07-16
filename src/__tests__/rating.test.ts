/**
 * rating.test.ts
 *
 * Covers the P1 audit fix: ProductCard.tsx used to hardcode "★★★★★"
 * regardless of any real data. Correction made while implementing the fix:
 * `Product` has no aggregate rating field at all (only `Review.rating`
 * exists per-review), so ProductCard's fix was to remove the fake stars
 * entirely rather than fabricate a per-product value. starsFor() is still
 * used for real per-review ratings in ReviewsPreview.tsx.
 */

import { describe, it, expect } from 'vitest'
import { starsFor } from '@/lib/rating'

describe('starsFor', () => {
  it('renders a perfect rating as 5 filled stars', () => {
    expect(starsFor(5)).toBe('★★★★★')
  })

  it('renders a partial rating with the correct filled/empty split', () => {
    expect(starsFor(3)).toBe('★★★☆☆')
    expect(starsFor(1)).toBe('★☆☆☆☆')
  })

  it('rounds non-integer ratings to the nearest star', () => {
    expect(starsFor(3.6)).toBe('★★★★☆') // rounds up to 4
    expect(starsFor(3.4)).toBe('★★★☆☆') // rounds down to 3
  })

  it('clamps out-of-range values instead of throwing or rendering garbage', () => {
    expect(starsFor(7)).toBe('★★★★★')
    expect(starsFor(-2)).toBe('☆☆☆☆☆')
  })

  it('treats missing/null/undefined ratings as 0 stars, not 5', () => {
    // This is the actual bug: the old code showed 5 stars unconditionally.
    expect(starsFor(null)).toBe('☆☆☆☆☆')
    expect(starsFor(undefined)).toBe('☆☆☆☆☆')
  })
})
