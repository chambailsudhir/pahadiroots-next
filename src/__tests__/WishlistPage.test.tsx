// @vitest-environment jsdom
/**
 * WishlistPage.test.tsx
 *
 * Covers src/app/wishlist/page.tsx — previously untested (listed as a
 * known coverage gap in the audit session summary).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useUserStore } from '@/store/userStore'

const { mockFrom, mockSelect, mockIn, mockEq1, mockEq2 } = vi.hoisted(() => {
  const mockEq2   = vi.fn()
  const mockEq1   = vi.fn(() => ({ eq: mockEq2 }))
  const mockIn    = vi.fn(() => ({ eq: mockEq1 }))
  const mockSelect = vi.fn(() => ({ in: mockIn }))
  const mockFrom  = vi.fn(() => ({ select: mockSelect }))
  return { mockFrom, mockSelect, mockIn, mockEq1, mockEq2 }
})

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom },
}))

// ProductCard has its own large dependency surface (analytics, images,
// variant selection) unrelated to what this page is responsible for —
// stubbed to a minimal, inspectable component, same approach used for
// Header/Footer in the layout tests.
vi.mock('@/components/product/ProductCard', () => ({
  default: ({ product }: any) => <div data-testid="product-card">{product.name}</div>,
}))

import WishlistPublicPage from '@/app/wishlist/page'

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, name: 'Wild Multiflora Honey', slug: 'wild-multiflora-honey', emoji: '🍯',
    price: 499, mrp: 599, available_stock: 10, gst_rate: 5, image_url: null,
    unit_label: '500g', badges: [], category_id: 1, is_deleted: false, status: 'active',
    categories: null, product_variants: [],
    ...overrides,
  }
}

beforeEach(() => {
  useUserStore.setState({ wishlist: [] } as any)
  mockFrom.mockClear()
  mockSelect.mockClear()
  mockIn.mockClear()
  mockEq1.mockClear()
  mockEq2.mockReset()
  mockEq2.mockResolvedValue({ data: [] })
})

describe('Wishlist page — empty state', () => {
  it('shows the empty-wishlist message and a Browse Products link, without querying the DB at all', () => {
    useUserStore.setState({ wishlist: [] } as any)
    render(<WishlistPublicPage />)

    expect(screen.getByText('Your wishlist is empty')).toBeTruthy()
    expect(screen.getByText('Browse Products').closest('a')?.getAttribute('href')).toBe('/products')
    // SWR key is `null` when wishlist is empty — no fetch should ever fire.
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('does not show the "Clear all" button when the wishlist is empty', () => {
    useUserStore.setState({ wishlist: [] } as any)
    render(<WishlistPublicPage />)
    expect(screen.queryByText('Clear all')).toBeNull()
  })
})

describe('Wishlist page — populated wishlist', () => {
  it('queries products filtered by the wishlist IDs, is_deleted=false, status=active, and renders them', async () => {
    useUserStore.setState({ wishlist: [1, 2] } as any)
    mockEq2.mockResolvedValue({ data: [product({ id: 1, name: 'Wild Multiflora Honey' }), product({ id: 2, name: 'Sea Buckthorn Concentrate' })] })

    render(<WishlistPublicPage />)

    await waitFor(() => expect(screen.getAllByTestId('product-card')).toHaveLength(2))
    expect(screen.getByText('Wild Multiflora Honey')).toBeTruthy()
    expect(screen.getByText('Sea Buckthorn Concentrate')).toBeTruthy()

    expect(mockFrom).toHaveBeenCalledWith('products')
    expect(mockIn).toHaveBeenCalledWith('id', [1, 2])
    expect(mockEq1).toHaveBeenCalledWith('is_deleted', false)
    expect(mockEq2).toHaveBeenCalledWith('status', 'active')
  })

  it('shows the saved-count label, pluralized correctly', async () => {
    useUserStore.setState({ wishlist: [1, 2, 3] } as any)
    mockEq2.mockResolvedValue({ data: [product({ id: 1 }), product({ id: 2 }), product({ id: 3 })] })

    render(<WishlistPublicPage />)
    await waitFor(() => expect(screen.getByText('3 saved products')).toBeTruthy())
  })

  it('shows the singular label for exactly one saved product', async () => {
    useUserStore.setState({ wishlist: [1] } as any)
    mockEq2.mockResolvedValue({ data: [product({ id: 1 })] })

    render(<WishlistPublicPage />)
    await waitFor(() => expect(screen.getByText('1 saved product')).toBeTruthy())
  })

  it('"Clear all" removes every item from the wishlist store', async () => {
    useUserStore.setState({ wishlist: [1, 2] } as any)
    mockEq2.mockResolvedValue({ data: [product({ id: 1 }), product({ id: 2 })] })

    render(<WishlistPublicPage />)
    await waitFor(() => expect(screen.getAllByTestId('product-card')).toHaveLength(2))

    fireEvent.click(screen.getByText('Clear all'))
    expect(useUserStore.getState().wishlist).toEqual([])
  })
})
