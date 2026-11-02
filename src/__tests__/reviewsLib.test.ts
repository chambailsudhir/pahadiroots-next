import { describe, it, expect } from 'vitest'
import { cleanReviewComment, reviewerDisplayName, isVerifiedReview } from '@/lib/reviews'
import { withVerifiedFlag } from '@/lib/reviewVerified'

describe('reviewerDisplayName', () => {
  it('first name + last initial', () => {
    expect(reviewerDisplayName('Priya', 'sharma')).toBe('Priya S.')
    expect(reviewerDisplayName('Priya Kumari', 'Sharma')).toBe('Priya S.')
    expect(reviewerDisplayName('Asha', null)).toBe('Asha')
    expect(reviewerDisplayName('<b>Asha</b>', '<i>Rao</i>')).toBe('Asha R.')
    expect(reviewerDisplayName(null, 'Rao')).toBe('Customer')
  })
})

describe('cleanReviewComment', () => {
  it('strips tags, trims, caps at 1000, empty -> null', () => {
    expect(cleanReviewComment('  <b>hi</b> ')).toBe('hi')
    expect(cleanReviewComment('x'.repeat(1500))).toHaveLength(1000)
    expect(cleanReviewComment('<br>')).toBeNull()
    expect(cleanReviewComment(undefined)).toBeNull()
  })
})

describe('isVerifiedReview', () => {
  it('only a literal true counts; absent / truthy strings do not', () => {
    expect(isVerifiedReview({ is_verified_purchase: true })).toBe(true)
    for (const v of [{}, { is_verified_purchase: false }, { is_verified_purchase: 'true' }, { is_verified_purchase: 1 }, null, undefined]) {
      expect(isVerifiedReview(v)).toBe(false)
    }
  })
})

describe('withVerifiedFlag', () => {
  const client = (result: unknown) => ({ from: () => ({ select: () => ({ in: async () => result }) }) }) as never
  const rows = [{ id: 'a' }, { id: 'b' }]
  it('marks only verified rows', async () => {
    const out = await withVerifiedFlag(client({ data: [{ id: 'a', is_verified_purchase: true }, { id: 'b', is_verified_purchase: false }], error: null }), rows)
    expect(out).toEqual([{ id: 'a', is_verified_purchase: true }, { id: 'b' }])
  })
  it('returns the rows untouched when the column does not exist yet (error) or the call throws', async () => {
    expect(await withVerifiedFlag(client({ data: null, error: { message: 'column does not exist' } }), rows)).toEqual(rows)
    const boom = { from: () => { throw new Error('x') } } as never
    expect(await withVerifiedFlag(boom, rows)).toEqual(rows)
  })
})
