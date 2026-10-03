// @vitest-environment jsdom
/**
 * BestSellersClient.test.tsx
 *
 * Component-level coverage for BestSellersClient.tsx — previously only
 * the underlying sort/emoji *logic* was tested via normalizeProduct.test.ts
 * and categoryEmoji.test.ts, never the rendered component itself.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))
vi.mock('@/components/product/ProductCard', () => ({
  default: ({ product }: { product: { id: number; name: string } }) =>
    React.createElement('div', { 'data-testid': 'product-card' }, product.name),
}))

import BestSellersClient from '@/components/homepage/BestSellersClient'

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, name: 'Product', slug: 'product', price: 100, mrp: 100,
    available_stock: 5, badges: [], category_id: 1, product_variants: [],
    ...overrides,
  } as never
}

describe('BestSellersClient', () => {
  it('shows "No products found" rather than an empty page when there is nothing to show', () => {
    render(<BestSellersClient initialProducts={[]} categories={[]} />)
    expect(screen.getByText('No products found')).toBeTruthy()
  })

  it('renders up to 6 products (3 columns x 2 rows), capping a larger catalog', () => {
    const products = Array.from({ length: 12 }, (_, i) => product({ id: i, name: `Product ${i}` }))
    render(<BestSellersClient initialProducts={products} categories={[]} />)
    expect(screen.getAllByTestId('product-card').length).toBe(6)
  })

  it('filters to a category when its chip is clicked', () => {
    const products = [
      product({ id: 1, name: 'Honey Product', category_id: 1 }),
      product({ id: 2, name: 'Ghee Product', category_id: 2 }),
    ]
    render(<BestSellersClient initialProducts={products} categories={[
      { id: 1, name: 'Honey', slug: 'honey' },
      { id: 2, name: 'Ghee', slug: 'ghee' },
    ]} />)

    fireEvent.click(screen.getByText(/Honey$/))

    expect(screen.getByText('Honey Product')).toBeTruthy()
    expect(screen.queryByText('Ghee Product')).toBeNull()
  })

  it('does not render a filter chip for a category that has no products in the list', () => {
    render(<BestSellersClient initialProducts={[product({ id: 1, name: 'Honey Product', category_id: 1 })]} categories={[
      { id: 1, name: 'Honey', slug: 'honey' },
      { id: 2, name: 'EmptyCat', slug: 'empty' },
    ]} />)
    expect(screen.getByText(/Honey$/)).toBeTruthy()
    expect(screen.queryByText(/EmptyCat/)).toBeNull()
  })

  it('category chip shows a real emoji, never duplicated category-name text (P2 fix)', () => {
    render(<BestSellersClient initialProducts={[product()]} categories={[
      { id: 1, name: 'Wild Honey', slug: 'honey' },
    ]} />)
    // This is the actual bug: catEmoji() used to return the string
    // "Honey" instead of an emoji, so the button read "Honey Wild Honey".
    const btn = screen.getByText(/Wild Honey/)
    expect(btn.textContent).toBe('🍯 Wild Honey')
  })

  it('"Price: Low to High" sorts using the effective (variant-aware) price, not the raw field (P2 fix)', () => {
    const products = [
      // Raw top-level price says this is more expensive...
      product({ id: 1, name: 'Has Variants', price: 999, product_variants: [
        { id: 1, price: 150, original_price: 200, variant_value: '250g', available_stock: 5, is_active: true },
      ] }),
      product({ id: 2, name: 'No Variants', price: 300 }),
    ]
    render(<BestSellersClient initialProducts={products} categories={[]} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'price_asc' } })

    const cards = screen.getAllByTestId('product-card')
    // ...but its EFFECTIVE price (150, from the variant) is actually
    // lower than 'No Variants' (300) — so it must sort first. Sorting by
    // the raw field would have put 'No Variants' first instead.
    expect(cards[0].textContent).toBe('Has Variants')
    expect(cards[1].textContent).toBe('No Variants')
  })

  it('sorts by name A-Z', () => {
    const products = [
      product({ id: 1, name: 'Zebra Honey' }),
      product({ id: 2, name: 'Apple Ghee' }),
    ]
    render(<BestSellersClient initialProducts={products} categories={[]} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'name' } })

    const cards = screen.getAllByTestId('product-card')
    expect(cards[0].textContent).toBe('Apple Ghee')
    expect(cards[1].textContent).toBe('Zebra Honey')
  })

  it('"Show All Products" links to /products', () => {
    render(<BestSellersClient initialProducts={[product()]} categories={[]} />)
    const link = screen.getByText(/Show All Products/).closest('a')
    expect(link?.getAttribute('href')).toBe('/products')
  })
})

describe('BestSellersClient — 3 columns x 2 rows layout', () => {
  it('shows exactly 6 cards and keeps the "Show All Products" link for the rest', () => {
    const products = Array.from({ length: 10 }, (_, i) => product({ id: i, name: `P${i}` }))
    const { container } = render(<BestSellersClient initialProducts={products} categories={[]} />)
    expect(container.querySelectorAll('[data-testid="product-card"]').length).toBe(6)
    expect(screen.getByText(/Show All Products/).closest('a')?.getAttribute('href')).toBe('/products')
  })
})
