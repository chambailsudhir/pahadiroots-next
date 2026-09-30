// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))
vi.mock('next/image', () => ({ default: () => null }))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null }),
})

import CategoryTiles from '@/components/homepage/CategoryTiles'

describe('CategoryTiles', () => {
  it('has no "View All Products" button under Browse Collections (the Bestsellers section owns "Show All Products")', () => {
    const cats = [
      { id: 1, name: 'Honey', slug: 'honey', is_active: true },
      { id: 2, name: 'Ghee', slug: 'ghee', is_active: true },
    ] as never
    render(<CategoryTiles categories={cats} />)
    expect(screen.queryByText(/View All Products/)).toBeNull()
    expect(screen.getAllByText('Honey').length).toBeGreaterThan(0)
  })
})
