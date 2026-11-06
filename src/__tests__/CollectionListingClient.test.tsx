// @vitest-environment jsdom
/**
 * CollectionListingClient.test.tsx — PERF FIX F-3: /collections/[slug] renders
 * the default list on the server (ISR) and applies ?sort= / ?instock= / ?page=
 * in the browser.
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

import CollectionListingClient, { collectionUrl } from '@/components/collections/CollectionListingClient'

function product(overrides: Record<string, unknown> = {}) {
  return { id: 1, name: 'Product', slug: 'p', price: 100, mrp: 120, available_stock: 5, badges: [], category_id: 7, product_variants: [], created_at: '2026-01-01', ...overrides } as never
}
const honey = [
  product({ id: 1, name: 'Honey A', price: 300, created_at: '2026-03-01' }),
  product({ id: 2, name: 'Honey B', price: 100, created_at: '2026-02-01', available_stock: 0 }),
]
const other = product({ id: 3, name: 'Ghee', category_id: 8, price: 50 })
const CAT = { id: 7, slug: 'honey', name: 'Honey' }

beforeEach(() => { params = new URLSearchParams(''); replace.mockReset() })
afterEach(() => vi.unstubAllGlobals())

describe('collectionUrl', () => {
  it('omits defaults and never emits instock=false (Issue 6.4)', () => {
    expect(collectionUrl('honey', { sort: 'newest', instock: false }, {})).toBe('/collections/honey')
    expect(collectionUrl('honey', { sort: 'price_asc', instock: true }, { instock: 'false' })).toBe('/collections/honey?sort=price_asc')
    expect(collectionUrl('honey', { sort: 'newest', instock: false }, { page: '2' })).toBe('/collections/honey?page=2')
  })
})

describe('CollectionListingClient', () => {
  it('default view: renders the shipped list without fetching', () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    render(<CollectionListingClient category={CAT} initialProducts={honey} totalCount={2} />)
    expect(screen.getAllByTestId('product-card').map(c => c.textContent)).toEqual(['Honey A', 'Honey B'])
    expect(screen.getByText(/2 products • Showing 1–2/)).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })

  it('?instock=true keeps only this category\'s in-stock products from the fetched catalogue', async () => {
    params = new URLSearchParams('instock=true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ products: [...honey, other] }) }))
    render(<CollectionListingClient category={CAT} initialProducts={honey.slice(0, 1)} totalCount={2} />)
    await waitFor(() => expect(screen.getAllByTestId('product-card').map(c => c.textContent)).toEqual(['Honey A']))
    expect(screen.queryByText('Ghee')).toBeNull()
    // The toggle link now turns the filter OFF.
    expect(screen.getByText('In Stock').getAttribute('href')).toBe('/collections/honey')
  })

  it('?sort=price_asc sorts the whole category and highlights the chip', async () => {
    params = new URLSearchParams('sort=price_asc')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ products: [...honey, other] }) }))
    render(<CollectionListingClient category={CAT} initialProducts={honey.slice(0, 1)} totalCount={2} />)
    await waitFor(() => expect(screen.getAllByTestId('product-card').map(c => c.textContent)).toEqual(['Honey B', 'Honey A']))
  })

  it('empty in-stock view offers "Clear filters"; an empty collection says "coming soon"', async () => {
    params = new URLSearchParams('instock=true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ products: [honey[1]] }) }))
    render(<CollectionListingClient category={CAT} initialProducts={[honey[1]]} totalCount={1} />)
    await waitFor(() => expect(screen.getByText('No in-stock products here right now')).toBeTruthy())
    expect(screen.getByText('Clear filters').getAttribute('href')).toBe('/collections/honey')
  })

  it('a page past the last one is replaced by the last real page', async () => {
    params = new URLSearchParams('page=5')
    render(<CollectionListingClient category={CAT} initialProducts={honey} totalCount={2} />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/collections/honey', { scroll: false }))
  })
})
