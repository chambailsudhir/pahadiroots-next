// @vitest-environment jsdom
/**
 * ProductListingClient.test.tsx — PERF FIX F-3 (listing pages were fully dynamic).
 *
 * /products and /new-arrivals no longer read `searchParams` on the server: the
 * Server Component renders the default view from the ISR cache and this client
 * component applies ?sort= / ?category= / ?state= / ?instock= / ?page= /
 * ?minPrice= / ?maxPrice= in the browser, fetching the full catalogue from
 * /api/v1/search-catalog only when a non-default view needs it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'

let params = new URLSearchParams('')
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace, push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => React.createElement('a', { href, ...rest }, children),
}))
vi.mock('@/components/product/ProductCard', () => ({
  default: ({ product }: { product: { id: number; name: string } }) =>
    React.createElement('div', { 'data-testid': 'product-card' }, product.name),
}))

import ProductListingClient, { LISTING_PAGE_SIZE } from '@/components/product/ProductListingClient'
import { CATALOG_ENDPOINT } from '@/components/product/useBrowseListing'

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, name: 'Product', slug: 'product', price: 100, mrp: 120, available_stock: 5,
    badges: [], category_id: 1, state_id: 'uk', product_variants: [], created_at: daysAgo(1),
    ...overrides,
  } as never
}

const CATS = [{ id: 1, slug: 'honey', name: 'Honey' }, { id: 2, slug: 'ghee', name: 'Ghee' }]
const SORTS = [
  { value: 'newest', label: 'Newest First', icon: '🆕' },
  { value: 'price_asc', label: 'Price: Low → High', icon: '↑' },
]

const catalog = [
  product({ id: 1, name: 'Honey A', category_id: 1, price: 300, created_at: daysAgo(1) }),
  product({ id: 2, name: 'Ghee B', category_id: 2, price: 100, created_at: daysAgo(2), available_stock: 0 }),
  product({ id: 3, name: 'Honey C', category_id: 1, price: 200, created_at: daysAgo(400), state_id: 'hp' }),
]

function stubCatalog(products: unknown[] = catalog, ok = true) {
  const f = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: () => Promise.resolve({ products }) })
  vi.stubGlobal('fetch', f)
  return f
}

function renderProducts(initial = catalog.slice(0, 2), total = 3, extra: Record<string, unknown> = {}) {
  return render(
    <ProductListingClient
      variant="products" basePath="/products"
      initialProducts={initial} totalCount={total}
      allCategories={CATS} sidebarCategories={CATS}
      states={[{ id: 'uk', name: 'Uttarakhand' }, { id: 'hp', name: 'Himachal' }]}
      sortOptions={SORTS}
      {...extra}
    />,
  )
}

beforeEach(() => { params = new URLSearchParams(''); replace.mockReset() })
afterEach(() => vi.unstubAllGlobals())

describe('ProductListingClient — default view (what the ISR-cached HTML contains)', () => {
  it('renders the server-shipped first page and never fetches the catalogue', () => {
    const f = stubCatalog()
    renderProducts()
    expect(screen.getAllByTestId('product-card').map(c => c.textContent)).toEqual(['Honey A', 'Ghee B'])
    expect(f).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('All Products')
  })

  it('uses the server total (not the shipped slice) for the count and pagination', () => {
    stubCatalog()
    renderProducts(catalog.slice(0, 2), LISTING_PAGE_SIZE + 1)
    expect(screen.getByText(/of 25 products/)).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeTruthy()
    expect(screen.getByText('2').closest('a')?.getAttribute('href')).toBe('/products?page=2')
  })
})

describe('ProductListingClient — query string applied in the browser', () => {
  it('?category= fetches the full catalogue once and filters it (title, breadcrumb, chip, count)', async () => {
    params = new URLSearchParams('category=honey')
    const f = stubCatalog()
    renderProducts()
    await waitFor(() => expect(screen.getAllByTestId('product-card').map(c => c.textContent)).toEqual(['Honey A', 'Honey C']))
    expect(f).toHaveBeenCalledTimes(1)
    expect(f).toHaveBeenCalledWith(CATALOG_ENDPOINT)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Honey')
    expect(screen.getByText('Honey ×').closest('a')?.getAttribute('href')).toBe('/products')
    expect(screen.getByText(/2 natural Himalayan products in Honey/)).toBeTruthy()
  })

  it('?sort=price_asc sorts by effective price across the whole catalogue', async () => {
    params = new URLSearchParams('sort=price_asc')
    stubCatalog()
    renderProducts()
    await waitFor(() => expect(screen.getAllByTestId('product-card').map(c => c.textContent)).toEqual(['Ghee B', 'Honey C', 'Honey A']))
    // Sidebar links carry the current sort along, as the server-rendered sidebar did.
    expect(screen.getByText('Ghee').closest('a')?.getAttribute('href')).toBe('/products?sort=price_asc&category=ghee')
  })

  it('?instock=true, ?state= and ?minPrice/?maxPrice narrow the list with the shared helpers', async () => {
    params = new URLSearchParams('instock=true&state=hp')
    stubCatalog()
    renderProducts()
    await waitFor(() => expect(screen.getAllByTestId('product-card').map(c => c.textContent)).toEqual(['Honey C']))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Himachal Products')
    expect(screen.getByText('In Stock ×')).toBeTruthy()
  })

  it('shows a loading skeleton (not a wrong "no products" state) while the catalogue is in flight', () => {
    params = new URLSearchParams('category=ghee')
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderProducts()
    expect(screen.getByTestId('listing-loading')).toBeTruthy()
    expect(screen.queryByText('No products found')).toBeNull()
  })

  it('an unknown ?category= shows the honest empty state instead of the whole catalogue', async () => {
    params = new URLSearchParams('category=nope')
    stubCatalog()
    renderProducts()
    await waitFor(() => expect(screen.getByText('No products found')).toBeTruthy())
    expect(screen.queryAllByTestId('product-card')).toHaveLength(0)
  })

  it('a page past the last one is replaced by the last real page (Issue 6.3, now client-side)', async () => {
    params = new URLSearchParams('page=99')
    stubCatalog()
    renderProducts()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/products', { scroll: false }))
  })

  it('does not redirect on the default view when the server reported more pages than it shipped', () => {
    stubCatalog()
    renderProducts(catalog.slice(0, 1), 100)
    expect(replace).not.toHaveBeenCalled()
  })

  it('offers a way back when the catalogue fetch fails', async () => {
    params = new URLSearchParams('sort=price_asc')
    stubCatalog([], false)
    renderProducts()
    await waitFor(() => expect(screen.getByText(/Couldn.t load these products/)).toBeTruthy())
    expect(screen.getByText('All Products', { selector: 'a' }).getAttribute('href')).toBe('/products')
  })
})

describe('ProductListingClient — new-arrivals variant', () => {
  function renderNew(extra: Record<string, unknown> = {}) {
    return render(
      <ProductListingClient
        variant="new-arrivals" basePath="/new-arrivals"
        initialProducts={catalog.slice(0, 2)} totalCount={2}
        allCategories={CATS} sidebarCategories={CATS} sortOptions={SORTS} justAddedCount={2}
        {...extra}
      />,
    )
  }

  it('keeps the base collection to new arrivals when a filter forces the catalogue fetch', async () => {
    params = new URLSearchParams('instock=true')
    stubCatalog()
    renderNew({ totalCount: 3 })
    // Honey C is 400 days old: not a new arrival even though it is in stock.
    await waitFor(() => expect(screen.getAllByTestId('product-card').map(c => c.textContent)).toEqual(['Honey A']))
    expect(screen.getByText(/1 new Himalayan product •/)).toBeTruthy()
  })

  it('builds its links on /new-arrivals and shows the hero copy', () => {
    stubCatalog()
    renderNew()
    expect(screen.getByText('🆕 Just In')).toBeTruthy()
    expect(screen.getByText(/2 added this week/)).toBeTruthy()
    expect(screen.getByText('Honey', { selector: 'aside a' }).getAttribute('href')).toBe('/new-arrivals?category=honey')
  })
})
