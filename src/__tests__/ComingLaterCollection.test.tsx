// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('@/components/product/ProductCard', () => ({
  default: ({ product }: { product: { name: string } }) => <div data-testid="card">{product.name}</div>,
}))

import ComingLaterCollection from '@/components/collections/ComingLaterCollection'

afterEach(cleanup)

describe('ComingLaterCollection', () => {
  it('explains the range is not available and links to the shop', () => {
    render(<ComingLaterCollection categoryName="Himalayan Tea" products={[]} />)
    expect(screen.getByRole('heading', { name: "Himalayan Tea isn't available yet" })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Shop all products' }).getAttribute('href')).toBe('/products')
    expect(screen.queryByText(/0 Products/i)).toBeNull()
  })

  it('pre-fills a WhatsApp question with the category name', () => {
    render(<ComingLaterCollection categoryName="Shilajit" whatsappNumber="919899984895" products={[]} />)
    const href = screen.getByRole('link', { name: 'Ask about Shilajit on WhatsApp' }).getAttribute('href')!
    expect(href.startsWith('https://wa.me/919899984895?text=')).toBe(true)
    expect(decodeURIComponent(href)).toContain('Shilajit')
  })

  it('hides the WhatsApp link when no number is configured', () => {
    render(<ComingLaterCollection categoryName="Shilajit" products={[]} />)
    expect(screen.queryByText(/on WhatsApp/)).toBeNull()
  })

  it('lists the products available now', () => {
    render(<ComingLaterCollection categoryName="Himalayan Tea" products={[{ id: 1, name: 'Buransh Juice' }, { id: 2, name: 'Cow Ghee' }] as any} />)
    expect(screen.getByRole('heading', { name: 'Available now' })).toBeTruthy()
    expect(screen.getAllByTestId('card')).toHaveLength(2)
  })
})
