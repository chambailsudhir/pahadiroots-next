// @vitest-environment jsdom
// Owner request (Nov 2026): the discount is shown once, next to the price ("20% off"), and no longer as a tag on the photo.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import type { Product } from '@/types'

vi.mock('next/image', () => ({ default: (p: Record<string, unknown>) => React.createElement('img', { ...p, alt: p.alt as string }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children?: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))
vi.mock('@/components/product/QuickViewModal', () => ({ default: () => null }))

import ProductCard from '@/components/product/ProductCard'

afterEach(cleanup)
const base = { id: 1, name: 'Honey', slug: 'honey', price: 400, mrp: 500, selling_price: 400, available_stock: 10, image_url: null, badges: [], product_variants: [] }
const p = (o: Record<string, unknown> = {}) => ({ ...base, ...o }) as unknown as Product
const note = (c: HTMLElement) => c.querySelector('.prow .psave')?.textContent ?? null

describe('ProductCard discount next to the price', () => {
  it('shows "N% off" in the price row', () => {
    const { container } = render(<ProductCard product={p()} />)
    expect(note(container)).toBe('20% off')
  })
  it('is the only discount on the card (no "-N%" tag on the photo)', () => {
    const { container } = render(<ProductCard product={p()} />)
    expect(container.querySelector('.pdisc-ribbon')).toBeNull()
    expect(container.textContent).not.toContain('-20%')
  })
  it('is hidden when there is no real discount', () => {
    const { container } = render(<ProductCard product={p({ mrp: 400 })} />)
    expect(note(container)).toBeNull()
  })
  it('is hidden for tiny discounts under 5%', () => {
    const { container } = render(<ProductCard product={p({ price: 490, selling_price: 490, mrp: 500 })} />)
    expect(note(container)).toBeNull()
  })
  it('is hidden when out of stock', () => {
    const { container } = render(<ProductCard product={p({ available_stock: 0 })} />)
    expect(note(container)).toBeNull()
  })
})
