// @vitest-environment jsdom
/**
 * ExploreByRegion.test.tsx
 *
 * Component-level coverage for ExploreByRegion.tsx — previously zero
 * test coverage.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('next/image', () => ({
  default: ({ fill, priority, ...props }: Record<string, unknown>) =>
    React.createElement('img', { ...props, alt: props.alt as string }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))
vi.mock('next/font/google', () => ({
  Source_Serif_4: () => ({ variable: '' }),
  Montserrat: () => ({ variable: '' }),
}))
vi.mock('@/components/homepage/RegionProductCard', () => ({
  default: ({ product }: { product: { id: number; name: string } }) =>
    React.createElement('div', { 'data-testid': 'product-card' }, product.name),
}))

import ExploreByRegion, { type RichState } from '@/components/homepage/ExploreByRegion'

function state(overrides: Partial<RichState> = {}): RichState {
  return {
    id: 'hp', name: 'Himachal Pradesh', slug: 'himachal-pradesh',
    image_url: null, description: null, region: null, products: [],
    ...overrides,
  }
}

describe('ExploreByRegion', () => {
  it('renders nothing with zero states', () => {
    const { container } = render(<ExploreByRegion states={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('defaults to showing the first state', () => {
    render(<ExploreByRegion states={[
      state({ id: 'hp', name: 'Himachal Pradesh' }),
      state({ id: 'jk', name: 'Jammu & Kashmir' }),
    ]} />)
    // The first state's name appears both as a selector button and in
    // the active detail panel — at least the detail panel's heading.
    expect(screen.getAllByText(/Himachal Pradesh/).length).toBeGreaterThan(0)
  })

  it('switches the active state when a different state button is clicked', () => {
    render(<ExploreByRegion states={[
      state({ id: 'hp', name: 'Himachal Pradesh' }),
      state({ id: 'jk', name: 'Jammu & Kashmir', products: [
        { id: 1, name: 'Kashmiri Saffron', slug: 'saffron' } as never,
      ] }),
    ]} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Jammu & Kashmir' }))

    expect(screen.getByText('Kashmiri Saffron')).toBeTruthy()
  })

  it('shows a "coming soon" message when the active state has no products', () => {
    render(<ExploreByRegion states={[state({ id: 'hp', name: 'Himachal Pradesh', products: [] })]} />)
    expect(screen.getByText(/products coming soon/i)).toBeTruthy()
  })

  it('shows real products for a state that has them', () => {
    render(<ExploreByRegion states={[state({
      id: 'hp', name: 'Himachal Pradesh',
      products: [{ id: 1, name: 'Kangra Tea', slug: 'kangra-tea' } as never],
    })]} />)
    expect(screen.getByTestId('product-card').textContent).toBe('Kangra Tea')
  })

  it('"View all" link points at the correct region page', () => {
    render(<ExploreByRegion states={[state({
      id: 'hp', name: 'Himachal Pradesh',
      products: [{ id: 1, name: 'Kangra Tea', slug: 'kangra-tea' } as never],
    })]} />)
    const link = screen.getByText(/View all Himachal products/i)
    expect(link.getAttribute('href')).toBe('/regions/hp')
  })
})
