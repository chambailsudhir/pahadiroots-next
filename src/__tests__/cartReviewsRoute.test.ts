import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const getLatestReviews = vi.fn()
vi.mock('@/lib/homepageData', () => ({ getLatestReviews: (...a: unknown[]) => getLatestReviews(...a) }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { GET, publicReviewerName } from '@/app/api/v1/cart-reviews/route'

const row = (o: Record<string, unknown> = {}) => ({ id: 'r1', customer_name: 'Priya Sharma', location: 'Delhi', rating: 5, review_text: 'Lovely honey', comment: null, ...o })
beforeEach(() => { vi.clearAllMocks() })

describe('publicReviewerName — only "First L." is ever public', () => {
  it.each([
    ['Priya Sharma', 'Priya S.'], ['  priya   kumari  sharma ', 'priya S.'], ['Anita', 'Anita'], ['', ''], [null, ''], [undefined, ''],
  ])('%j → %j', (input, out) => { expect(publicReviewerName(input as string)).toBe(out) })
})

describe('GET /api/v1/cart-reviews', () => {
  it('returns real approved reviews with their own rating and a masked name', async () => {
    getLatestReviews.mockResolvedValue([row(), row({ customer_name: 'Rahul', location: null, rating: 3, review_text: null, comment: 'Okay, a bit pricey' })])
    const body = await (await GET()).json()
    expect(body.reviews).toEqual([
      { name: 'Priya S.', location: 'Delhi', text: 'Lovely honey', rating: 5 },
      { name: 'Rahul', location: '', text: 'Okay, a bit pricey', rating: 3 },   // a 3-star review is shown too: not cherry-picked
    ])
  })
  it('never exposes the full name or internal fields', async () => {
    getLatestReviews.mockResolvedValue([row()])
    const s = JSON.stringify(await (await GET()).json())
    expect(s).not.toContain('Sharma')
    expect(s).not.toContain('"id"')
  })
  it('drops reviews with no text or no name, and clamps ratings to 1–5', async () => {
    getLatestReviews.mockResolvedValue([row({ review_text: '  ', comment: null }), row({ customer_name: '' }), row({ rating: 9 }), row({ rating: 0 })])
    const body = await (await GET()).json()
    expect(body.reviews).toHaveLength(1)          // rating 0 is not a real rating → dropped; 9 → 5
    expect(body.reviews[0].rating).toBe(5)
  })
  it('no reviews → an empty list (the cart then shows no box), with a cache header', async () => {
    getLatestReviews.mockResolvedValue([])
    const res = await GET()
    expect((await res.json()).reviews).toEqual([])
    expect(res.headers.get('cache-control')).toContain('s-maxage=300')
  })
  it('a database failure → an empty list and status 200 (never a made-up review)', async () => {
    getLatestReviews.mockRejectedValue(new Error('db down'))
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).reviews).toEqual([])
  })
})
