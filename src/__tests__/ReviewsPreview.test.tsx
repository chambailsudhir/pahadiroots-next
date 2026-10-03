// @vitest-environment jsdom
/**
 * ReviewsPreview.test.tsx
 *
 * Component-level coverage for the P1 audit fix: ReviewsPreview.tsx used
 * to render 3 hardcoded testimonials labeled "Verified Buyer" — never
 * tied to a real purchase or review record. Zero test coverage existed
 * for this component before this file.
 *
 * Covered here:
 *   1. Renders real reviews returned by the (mocked) `reviews` table —
 *      queries with status='approved', ordered by created_at desc, limit 3.
 *   2. Renders nothing (returns null) when there are zero real approved
 *      reviews — this is the actual fix: no fallback to fabricated content.
 *   3. Renders nothing on a DB error — fails safe, doesn't crash the page.
 *   4. Filters out reviews with no text content (blank review_text/comment).
 *   5. Star rating reflects the review's own real `rating` field — not a
 *      fixed value.
 */

import { describe, it, expect, vi } from 'vitest'

// getLatestReviews() is wrapped in unstable_cache — pass straight through in tests.
vi.mock('next/cache', () => ({ unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }))
import { render, screen } from '@testing-library/react'

const { mockFrom, mockSelect, mockEq, mockOrder, mockLimit } = vi.hoisted(() => {
  const mockLimit  = vi.fn()
  const mockOrder  = vi.fn(() => ({ limit: mockLimit }))
  const mockEq     = vi.fn(() => ({ order: mockOrder }))
  const mockSelect = vi.fn(() => ({ eq: mockEq }))
  const mockFrom   = vi.fn(() => ({ select: mockSelect }))
  return { mockFrom, mockSelect, mockEq, mockOrder, mockLimit }
})

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom },
}))

import ReviewsPreview from '@/components/homepage/ReviewsPreview'

function review(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1', customer_name: 'Priya S.', location: 'Delhi', rating: 4,
    review_text: 'Lovely honey, will buy again.', comment: null,
    ...overrides,
  }
}

describe('ReviewsPreview', () => {
  it('does not crash when a review has a NULL customer_name (falls back to "Customer")', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [review({ customer_name: null, location: null })],
      error: null,
    })
    const el = await ReviewsPreview()
    render(el as React.ReactElement)
    expect(screen.getAllByText('Customer').length).toBeGreaterThan(0)
  })

  it('renders real reviews from the reviews table', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [review(), review({ id: 'r2', customer_name: 'Amit K.', rating: 5 })],
      error: null,
    })

    const el = await ReviewsPreview()
    render(el as React.ReactElement)

    expect(screen.getByText('Priya S.')).toBeTruthy()
    expect(screen.getByText('Amit K.')).toBeTruthy()
    expect(mockEq).toHaveBeenCalledWith('status', 'approved')
    expect(mockLimit).toHaveBeenCalledWith(3)
  })

  it('renders nothing when there are zero real approved reviews — no fake fallback', async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null })

    const el = await ReviewsPreview()
    // This is the actual bug fix: the old component would still render 3
    // hardcoded "Verified Buyer" testimonials here. The new one renders
    // nothing rather than filling the gap with fabricated content.
    expect(el).toBeNull()
  })

  it('renders nothing on a DB error rather than crashing the page', async () => {
    mockLimit.mockResolvedValueOnce({ data: null, error: new Error('db down') })

    const el = await ReviewsPreview()
    expect(el).toBeNull()
  })

  it('filters out reviews with no real text content', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [
        review({ id: 'r1', customer_name: 'Empty Review', review_text: '', comment: null }),
        review({ id: 'r2', customer_name: 'Real Review', review_text: 'Great product' }),
      ],
      error: null,
    })

    const el = await ReviewsPreview()
    render(el as React.ReactElement)

    expect(screen.queryByText('Empty Review')).toBeNull()
    expect(screen.getByText('Real Review')).toBeTruthy()
  })

  it("shows each review's own real rating, not a fixed value", async () => {
    mockLimit.mockResolvedValueOnce({
      data: [review({ rating: 2 })],
      error: null,
    })

    const el = await ReviewsPreview()
    render(el as React.ReactElement)

    expect(screen.getByLabelText('Rated 2 out of 5')).toBeTruthy()
  })
})
