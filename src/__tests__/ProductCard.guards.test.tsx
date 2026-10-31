// @vitest-environment jsdom
// Audit C-4: a product with no usable price must not render "₹NaN"; "Only N left" only for genuine low stock.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import type { Product } from '@/types'

vi.mock('next/image', () => ({ default: (p: Record<string, unknown>) => React.createElement('img', { ...p, alt: p.alt as string }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children?: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))
vi.mock('@/components/product/QuickViewModal', () => ({ default: () => null }))

import ProductCard from '@/components/product/ProductCard'

const base = { id: 1, name: 'Honey', slug: 'honey', price: 400, mrp: 500, selling_price: 400, available_stock: 10, image_url: null, badges: [], product_variants: [] }
const p = (o: Record<string, unknown>) => ({ ...base, ...o }) as unknown as Product

describe('ProductCard guards (C-4)', () => {
  it('renders nothing when no price source is usable', () => {
    const { container } = render(<ProductCard product={p({ price: null, selling_price: null, mrp: null })} />)
    expect(container.innerHTML).toBe('')
  })
  it('never prints NaN', () => {
    const { container } = render(<ProductCard product={p({ mrp: undefined })} />)
    expect(container.textContent).not.toMatch(/NaN/)
  })
  it('says "In Stock" for 6-20 units (no false urgency)', () => {
    render(<ProductCard product={p({ available_stock: 12 })} />)
    expect(screen.getByText('In Stock')).toBeTruthy()
    expect(screen.queryByText(/Only \d+ left/)).toBeNull()
  })
  it('says "Only N left" at 5 or fewer', () => {
    render(<ProductCard product={p({ available_stock: 3 })} />)
    expect(screen.getByText('Only 3 left')).toBeTruthy()
  })
})
