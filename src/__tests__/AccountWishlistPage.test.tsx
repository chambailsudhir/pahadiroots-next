// @vitest-environment jsdom
/**
 * AccountWishlistPage.test.tsx — /account/wishlist
 * Filters the shared server-normalized catalogue by the saved ids; surfaces a
 * load failure with a customer-friendly message (never a raw DB error).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useUserStore } from '@/store/userStore'

const { mockUseSearchCatalog } = vi.hoisted(() => ({ mockUseSearchCatalog: vi.fn() }))
vi.mock('@/hooks/useSearchCatalog', () => ({ useSearchCatalog: mockUseSearchCatalog }))
vi.mock('@/components/product/ProductCard', () => ({
  default: ({ product }: any) => <div data-testid="product-card">{product.name}</div>,
}))

import AccountWishlistPage from '@/app/account/wishlist/page'

const prod = (id: number, name: string) => ({ id, name, slug: `p${id}`, price: 100, state_id: 'HP' })

beforeEach(() => {
  useUserStore.setState({ wishlist: [] } as any)
  mockUseSearchCatalog.mockReset()
  mockUseSearchCatalog.mockReturnValue({ data: undefined, isLoading: false, error: undefined })
})

describe('Account wishlist page', () => {
  it('empty wishlist: shows the empty state and keeps the catalogue fetch disabled', () => {
    render(<AccountWishlistPage />)
    expect(screen.getByText('Your wishlist is empty')).toBeTruthy()
    expect(mockUseSearchCatalog).toHaveBeenCalledWith(false)
  })

  it('renders only saved products, matching string ids to numeric product ids', async () => {
    useUserStore.setState({ wishlist: ['1', '2'] } as any)
    mockUseSearchCatalog.mockReturnValue({
      data: [prod(1, 'Honey'), prod(2, 'Ghee'), prod(3, 'Unsaved')], isLoading: false, error: undefined,
    })
    render(<AccountWishlistPage />)
    await waitFor(() => expect(screen.getAllByTestId('product-card')).toHaveLength(2))
    expect(screen.queryByText('Unsaved')).toBeNull()
    expect(mockUseSearchCatalog).toHaveBeenCalledWith(true)
  })

  it('shows a friendly error (not a raw DB message) when the catalogue fails', () => {
    useUserStore.setState({ wishlist: ['1'] } as any)
    mockUseSearchCatalog.mockReturnValue({ data: undefined, isLoading: false, error: new Error('PGRST301 JWT expired') })
    render(<AccountWishlistPage />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain("couldn't load your wishlist")
    expect(alert.textContent).not.toContain('PGRST')
  })

  it('shows no cards and no error while loading', () => {
    useUserStore.setState({ wishlist: ['1'] } as any)
    mockUseSearchCatalog.mockReturnValue({ data: undefined, isLoading: true, error: undefined })
    render(<AccountWishlistPage />)
    expect(screen.queryAllByTestId('product-card')).toHaveLength(0)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})


describe('Account wishlist — every saved product has since been removed (Oct 2026 audit)', () => {
  it('shows an explanation instead of a blank page', () => {
    useUserStore.setState({ wishlist: [101, 102] } as any)
    mockUseSearchCatalog.mockReturnValue({
      data: [{ id: 1, name: 'Some Other Product', slug: 'x', price: 10, mrp: 12, available_stock: 1, gst_rate: 5, image_url: null, badges: [], category_id: 1, state_id: 'HP' }],
      isLoading: false, error: undefined,
    })
    render(<AccountWishlistPage />)

    expect(screen.getByText('Your saved items are no longer available')).toBeTruthy()
    expect(screen.getByText(/Browse Products/).closest('a')?.getAttribute('href')).toBe('/products')
  })
})
