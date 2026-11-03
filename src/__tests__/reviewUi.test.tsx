// @vitest-environment jsdom
/** Review page (/account/orders/[id]/review), "Verified purchase" badge, and the order-page link. */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useParams: () => ({ id: '501' }) }))
vi.mock('next/image', () => ({ default: (p: Record<string, unknown>) => React.createElement('img', { alt: p.alt as string }) }))
vi.mock('@/lib/analytics/ga4', () => ({ ga4AccountAction: vi.fn() }))
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: vi.fn() }) }))
const getLatestReviews = vi.hoisted(() => vi.fn())
vi.mock('@/lib/homepageData', () => ({ getLatestReviews }))

const mockFetch = vi.fn()
global.fetch = mockFetch as never

import ReviewPage from '@/app/account/orders/[id]/review/page'
import OrderDetailPage from '@/app/account/orders/[id]/page'
import ReviewsSection from '@/components/product/ReviewsSection'
import ReviewsPreview from '@/components/homepage/ReviewsPreview'

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
const eligible = (items: unknown[], delivered = true) => ({ order_id: 501, order_number: 'ORD-501', delivered, items })
const item = (o = {}) => ({ product_id: 11, name: 'Wild Honey', image: null, already_reviewed: false, ...o })

beforeEach(() => { mockFetch.mockReset() })

describe('review page', () => {
  it('shows one form per item with an accessible keyboard-operable 5-radio group', async () => {
    mockFetch.mockResolvedValueOnce(json(200, eligible([item(), item({ product_id: 12, name: 'Ghee' })])))
    render(<ReviewPage />)
    expect(await screen.findByText('Wild Honey')).toBeTruthy()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/reviews/eligible?order_id=501')
    expect(screen.getAllByRole('radio')).toHaveLength(10)
    expect(screen.getAllByRole('group').length).toBeGreaterThanOrEqual(2)   // fieldsets
    expect(screen.getAllByRole('radio', { name: '1 star' })).toHaveLength(2)
    expect(screen.getAllByRole('radio', { name: '5 stars' })).toHaveLength(2)
  })

  it('requires a rating, counts characters, and posts the review (only ids, rating and text)', async () => {
    mockFetch.mockResolvedValueOnce(json(200, eligible([item()])))
    render(<ReviewPage />)
    await screen.findByText('Wild Honey')

    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/star rating/i)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText(/your review/i), { target: { value: 'Great taste' } })
    expect(screen.getByText('11/1000')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }))

    mockFetch.mockResolvedValueOnce(json(200, { success: true, message: 'Review submitted for approval' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/appear after moderation/i)

    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toBe('/api/v1/actions')
    expect(JSON.parse(init.body)).toEqual({ action: 'submit_review', product_id: 11, order_id: 501, rating: 4, comment: 'Great taste' })
  })

  it('textarea is capped at 1000 characters', async () => {
    mockFetch.mockResolvedValueOnce(json(200, eligible([item()])))
    render(<ReviewPage />)
    await screen.findByText('Wild Honey')
    expect((screen.getByLabelText(/your review/i) as HTMLTextAreaElement).maxLength).toBe(1000)
  })

  it('shows an inline error and keeps the form on a server error; sign-in action on 401', async () => {
    mockFetch.mockResolvedValueOnce(json(200, eligible([item()])))
    render(<ReviewPage />)
    await screen.findByText('Wild Honey')
    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }))
    mockFetch.mockResolvedValueOnce(json(503, { error: 'Could not save your review - please try again' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not save/i)
    expect(screen.getByRole('button', { name: 'Submit review' })).toBeTruthy()

    mockFetch.mockResolvedValueOnce(json(401, { error: 'x', code: 'auth_required' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy())
  })

  it('409 already_reviewed turns the item into the friendly already-reviewed state', async () => {
    mockFetch.mockResolvedValueOnce(json(200, eligible([item()])))
    render(<ReviewPage />)
    await screen.findByText('Wild Honey')
    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }))
    mockFetch.mockResolvedValueOnce(json(409, { error: 'x', code: 'already_reviewed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/already reviewed/i)
    expect(screen.queryByRole('button', { name: 'Submit review' })).toBeNull()
  })

  it('friendly states: not delivered, everything reviewed, signed out, not found', async () => {
    mockFetch.mockResolvedValueOnce(json(200, eligible([], false)))
    const a = render(<ReviewPage />)
    expect((await screen.findByText(/once it has been delivered/i))).toBeTruthy()
    a.unmount()

    mockFetch.mockResolvedValueOnce(json(200, eligible([item({ already_reviewed: true })])))
    const b = render(<ReviewPage />)
    expect((await screen.findByText(/already reviewed every product/i))).toBeTruthy()
    b.unmount()

    mockFetch.mockResolvedValueOnce(json(401, { error: 'x' }))
    const c = render(<ReviewPage />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/sign in/i)
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy()
    c.unmount()

    mockFetch.mockResolvedValueOnce(json(404, { error: 'Order not found' }))
    render(<ReviewPage />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not find/i)
  })
})

describe('Verified purchase badge', () => {
  const rev = (o = {}) => ({ id: 'r1', product_id: '11', customer_name: 'Priya S.', location: null, rating: 5, review_text: 'Nice', comment: null, status: 'approved', created_at: '2026-11-01T00:00:00Z', ...o })

  it('ReviewsSection: badge only when is_verified_purchase === true', () => {
    const { rerender } = render(<ReviewsSection reviews={[rev({ is_verified_purchase: true })] as never} />)
    expect(screen.getByTestId('verified-purchase').textContent).toMatch(/Verified purchase/)
    rerender(<ReviewsSection reviews={[rev()] as never} />)                                  // property absent (pre-migration)
    expect(screen.queryByTestId('verified-purchase')).toBeNull()
    rerender(<ReviewsSection reviews={[rev({ is_verified_purchase: false })] as never} />)
    expect(screen.queryByTestId('verified-purchase')).toBeNull()
  })

  it('ReviewsPreview: same rule', async () => {
    getLatestReviews.mockResolvedValue([
      { id: 'a', customer_name: 'Priya S.', location: null, rating: 5, review_text: 'Nice', comment: null, is_verified_purchase: true },
      { id: 'b', customer_name: 'Old Review', location: null, rating: 4, review_text: 'Fine', comment: null },
    ])
    render((await ReviewsPreview()) as React.ReactElement)
    expect(screen.getAllByTestId('verified-purchase')).toHaveLength(1)
  })
})

describe('order detail page link', () => {
  const order = (status: string) => ({
    id: '501', order_number: 'ORD-501', order_status: status, payment_method: 'cod', total_amount: 598, subtotal: 499,
    created_at: '2026-07-15T10:00:00.000Z', items: [{ name: 'Honey', qty: 1, price: 499, emoji: '🍯', image_url: null }],
    shipping_address: { name: 'Asha' }, _return: null,
  })

  it('shows "Rate & review" for a delivered order only', async () => {
    mockFetch.mockResolvedValue(json(200, { order: order('delivered') }))
    const a = render(<OrderDetailPage />)
    const link = await screen.findByRole('link', { name: /rate & review/i })
    expect(link.getAttribute('href')).toBe('/account/orders/501/review')
    a.unmount()

    mockFetch.mockResolvedValue(json(200, { order: order('shipped') }))
    render(<OrderDetailPage />)
    await screen.findByText('ORD-501')
    expect(screen.queryByRole('link', { name: /rate & review/i })).toBeNull()
  })
})
