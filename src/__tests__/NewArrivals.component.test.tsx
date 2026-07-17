// @vitest-environment jsdom
/**
 * NewArrivals.test.tsx
 *
 * Component-level coverage for NewArrivals.tsx — previously only the
 * underlying filterNewArrivals()/isNewArrival() library functions were
 * tested (newArrivals.test.ts), never the component itself.
 *
 * Covered here:
 *   1. Renders real new-arrival products, sorted newest-first.
 *   2. Falls back to the 4 most recent products overall when nothing
 *      currently qualifies as "new" (so the section never sits empty
 *      just because nothing shipped in the last N days).
 *   3. Renders nothing (returns null) when there are no products at all.
 *   4. Renders nothing on a data-fetch failure — fails safe.
 *   5. "See All" links to /new-arrivals (the fix: this used to point at
 *      a generic, unfiltered /products?sort=newest listing).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))
vi.mock('@/components/product/ProductCard', () => ({
  default: ({ product }: { product: { id: number; name: string } }) =>
    React.createElement('div', { 'data-testid': 'product-card' }, product.name),
}))

const mockGetStoreData         = vi.fn()
const mockGetProductsWithImages = vi.fn()
vi.mock('@/lib/storeData', () => ({
  getStoreData: () => mockGetStoreData(),
  getProductsWithImages: (sd: unknown) => mockGetProductsWithImages(sd),
}))

import NewArrivals from '@/components/homepage/NewArrivals'

const NEW_DAYS_AGO = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, name: 'Test Product', slug: 'test-product', price: 100, mrp: 120,
    available_stock: 5, badges: [], is_deleted: false, status: 'active',
    created_at: NEW_DAYS_AGO(1),
    ...overrides,
  }
}

describe('NewArrivals', () => {
  it('renders genuinely new products, sorted newest-first', async () => {
    mockGetStoreData.mockResolvedValue({})
    mockGetProductsWithImages.mockReturnValue([
      product({ id: 1, name: 'Older New Item', created_at: NEW_DAYS_AGO(5) }),
      product({ id: 2, name: 'Newest Item', created_at: NEW_DAYS_AGO(1) }),
    ])

    const el = await NewArrivals()
    render(el as React.ReactElement)

    const cards = screen.getAllByTestId('product-card')
    expect(cards[0].textContent).toBe('Newest Item')
    expect(cards[1].textContent).toBe('Older New Item')
  })

  it('falls back to the most recent products overall when nothing currently qualifies as new', async () => {
    mockGetStoreData.mockResolvedValue({})
    mockGetProductsWithImages.mockReturnValue([
      // created_at far enough in the past that filterNewArrivals excludes it
      product({ id: 1, name: 'Old Product', created_at: NEW_DAYS_AGO(400) }),
    ])

    const el = await NewArrivals()
    render(el as React.ReactElement)

    // This is the actual fix: the section still shows something (the
    // most recent products overall) rather than requiring genuinely new
    // stock to exist before rendering anything at all.
    expect(screen.getByText('Old Product')).toBeTruthy()
  })

  it('renders nothing when there are no products at all', async () => {
    mockGetStoreData.mockResolvedValue({})
    mockGetProductsWithImages.mockReturnValue([])

    const el = await NewArrivals()
    expect(el).toBeNull()
  })

  it('renders nothing (fails safe) when the data fetch throws', async () => {
    mockGetStoreData.mockRejectedValue(new Error('db down'))

    const el = await NewArrivals()
    expect(el).toBeNull()
  })

  it('"See All" links to /new-arrivals, not a generic unfiltered listing', async () => {
    mockGetStoreData.mockResolvedValue({})
    mockGetProductsWithImages.mockReturnValue([product()])

    const el = await NewArrivals()
    render(el as React.ReactElement)

    const link = screen.getByText('See All').closest('a')
    expect(link?.getAttribute('href')).toBe('/new-arrivals')
  })

  it('caps at 4 products even when more qualify', async () => {
    mockGetStoreData.mockResolvedValue({})
    mockGetProductsWithImages.mockReturnValue(
      [1, 2, 3, 4, 5, 6].map(id => product({ id, name: `Product ${id}` }))
    )

    const el = await NewArrivals()
    render(el as React.ReactElement)

    expect(screen.getAllByTestId('product-card').length).toBe(4)
  })
})
