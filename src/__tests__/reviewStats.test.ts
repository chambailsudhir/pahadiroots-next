import { describe, it, expect } from 'vitest'
import { computeReviewStats } from '@/lib/reviewStats'

const rows = (...r: number[]) => r.map(rating => ({ rating }))

describe('computeReviewStats', () => {
  it('counts and averages ALL approved ratings, not just the 10 shown (the audited bug)', () => {
    const all = rows(...Array(40).fill(5), ...Array(10).fill(1))        // 50 reviews
    const visible = rows(...Array(10).fill(1))                          // the 10 shown are the worst
    expect(computeReviewStats(all, visible)).toEqual({ avg: (40 * 5 + 10 * 1) / 50, count: 50 })
  })

  it('falls back to the visible rows only when the aggregate query returned nothing / failed', () => {
    expect(computeReviewStats(null, rows(4, 5))).toEqual({ avg: 4.5, count: 2 })
    expect(computeReviewStats([], rows(3))).toEqual({ avg: 3, count: 1 })
  })

  it('returns null when there are no reviews at all', () => {
    expect(computeReviewStats([], [])).toBeNull()
    expect(computeReviewStats(undefined, undefined)).toBeNull()
  })

  it('treats a missing rating as 0 rather than NaN', () => {
    expect(computeReviewStats([{ rating: null }, { rating: 4 }], [])).toEqual({ avg: 2, count: 2 })
  })
})
