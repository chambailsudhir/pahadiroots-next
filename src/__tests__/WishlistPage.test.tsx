// @vitest-environment jsdom
/**
 * WishlistPage.test.tsx
 *
 * Covers src/app/wishlist/page.tsx. The page no longer queries Supabase from
 * the browser: it filters the server-normalized catalogue served by
 * /api/v1/search-catalog (via useSearchCatalog), so a wishlist card is
 * identical to the same product in Browse/Search (image, variants, state_id).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { useUserStore } from '@/store/userStore'

const { mockUseSearchCatalog } = vi.hoisted(() => ({ mockUseSearchCatalog: vi.fn() }))

vi.mock('@/hooks/useSearchCatalog', () => ({
  useSearchCatalog: mockUseSearchCatalog,
}))

// ProductCard has its own large dependency surface unrelated to what this page
// is responsible for — stubbed to a minimal, inspectable component.
vi.mock('@/components/product/ProductCard', () => ({
  default: ({ product }: any) => <div data-testid="product-card">{product.name}</div>,
}))

import WishlistPublicPage from '@/app/wishlist/page'

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, name: 'Wild Multiflora Honey', slug: 'wild-multiflora-honey', emoji: '🍯',
    price: 499, mrp: 599, available_stock: 10, gst_rate: 5, image_url: null,
    unit_label: '500g', badges: [], category_id: 1, state_id: 'HP',
    ...overrides,
  }
}

function catalog(data: unknown[]) {
  mockUseSearchCatalog.mockReturnValue({ data, isLoading: false, error: undefined })
}

beforeEach(() => {
  useUserStore.setState({ wishlist: [] } as any)
  mockUseSearchCatalog.mockReset()
  mockUseSearchCatalog.mockReturnValue({ data: undefined, isLoading: false, error: undefined })
})

describe('Wishlist page — empty state', () => {
  it('shows the empty-wishlist message and a Browse Products link, and does not enable the catalogue fetch', () => {
    render(<WishlistPublicPage />)

    expect(screen.getByText('Your wishlist is empty')).toBeTruthy()
    expect(screen.getByText('Browse Products').closest('a')?.getAttribute('href')).toBe('/products')
    expect(mockUseSearchCatalog).toHaveBeenCalledWith(false)
  })

  it('does not show the "Clear all" button when the wishlist is empty', () => {
    render(<WishlistPublicPage />)
    expect(screen.queryByText('Clear all')).toBeNull()
  })
})

describe('Wishlist page — populated wishlist', () => {
  it('enables the catalogue fetch and renders only the saved products', async () => {
    useUserStore.setState({ wishlist: [1, 2] } as any)
    catalog([
      product({ id: 1, name: 'Wild Multiflora Honey' }),
      product({ id: 2, name: 'Sea Buckthorn Concentrate' }),
      product({ id: 3, name: 'Not Saved Ghee' }),
    ])

    render(<WishlistPublicPage />)

    await waitFor(() => expect(screen.getAllByTestId('product-card')).toHaveLength(2))
    expect(screen.getByText('Wild Multiflora Honey')).toBeTruthy()
    expect(screen.getByText('Sea Buckthorn Concentrate')).toBeTruthy()
    expect(screen.queryByText('Not Saved Ghee')).toBeNull()
    expect(mockUseSearchCatalog).toHaveBeenCalledWith(true)
  })

  it('matches string wishlist ids (the store type) against numeric product ids', async () => {
    useUserStore.setState({ wishlist: ['1'] } as any)
    catalog([product({ id: 1 }), product({ id: 2, name: 'Other' })])

    render(<WishlistPublicPage />)
    await waitFor(() => expect(screen.getAllByTestId('product-card')).toHaveLength(1))
  })

  it('silently omits a saved product that is no longer in the active catalogue', async () => {
    useUserStore.setState({ wishlist: [1, 99] } as any)
    catalog([product({ id: 1 })])

    render(<WishlistPublicPage />)
    await waitFor(() => expect(screen.getAllByTestId('product-card')).toHaveLength(1))
  })

  it('shows the saved-count label, pluralized correctly', async () => {
    useUserStore.setState({ wishlist: [1, 2, 3] } as any)
    catalog([product({ id: 1 }), product({ id: 2 }), product({ id: 3 })])

    render(<WishlistPublicPage />)
    await waitFor(() => expect(screen.getByText('3 saved products')).toBeTruthy())
  })

  it('shows the singular label for exactly one saved product', async () => {
    useUserStore.setState({ wishlist: [1] } as any)
    catalog([product({ id: 1 })])

    render(<WishlistPublicPage />)
    await waitFor(() => expect(screen.getByText('1 saved product')).toBeTruthy())
  })

  it('"Clear all" removes every item from the wishlist store', async () => {
    useUserStore.setState({ wishlist: [1, 2] } as any)
    catalog([product({ id: 1 }), product({ id: 2 })])

    render(<WishlistPublicPage />)
    await waitFor(() => expect(screen.getAllByTestId('product-card')).toHaveLength(2))

    fireEvent.click(screen.getByText('Clear all'))
    expect(useUserStore.getState().wishlist).toEqual([])
  })
})

describe('Wishlist page — loading and failure', () => {
  it('shows a skeleton, not an empty list, while the catalogue is loading', () => {
    useUserStore.setState({ wishlist: [1] } as any)
    mockUseSearchCatalog.mockReturnValue({ data: undefined, isLoading: true, error: undefined })

    render(<WishlistPublicPage />)
    expect(screen.queryAllByTestId('product-card')).toHaveLength(0)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows an error message when the catalogue fails to load (was: silently empty)', () => {
    useUserStore.setState({ wishlist: [1] } as any)
    mockUseSearchCatalog.mockReturnValue({ data: undefined, isLoading: false, error: new Error('search-catalog 503') })

    render(<WishlistPublicPage />)
    expect(screen.getByRole('alert').textContent).toContain("couldn't load your wishlist")
    expect(screen.queryAllByTestId('product-card')).toHaveLength(0)
  })
})
