// @vitest-environment jsdom
/**
 * FeaturedBanner.test.tsx
 *
 * Component-level coverage for FeaturedBanner.tsx — previously zero test
 * coverage, including for the P2 audit fix (raw CSS backgroundImage
 * replaced with next/image so the category image is actually optimized).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('next/image', () => ({
  default: ({ fill, ...props }: Record<string, unknown>) => React.createElement('img', { ...props, alt: props.alt as string, 'data-testid': 'next-image' }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

const { mockFrom, mockSelect, mockEq, mockSingle } = vi.hoisted(() => {
  const mockSingle = vi.fn()
  const mockEq     = vi.fn(() => ({ single: mockSingle }))
  const mockSelect = vi.fn(() => ({ eq: mockEq }))
  const mockFrom   = vi.fn(() => ({ select: mockSelect }))
  return { mockFrom, mockSelect, mockEq, mockSingle }
})
vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom },
}))

import FeaturedBanner from '@/components/homepage/FeaturedBanner'

describe('FeaturedBanner', () => {
  it('renders the category image via next/image, not a raw CSS background', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 1, name: 'Wild Honey', slug: 'wild-honey', description: 'Pure and raw.', image_url: '/honey.jpg' },
      error: null,
    })

    const el = await FeaturedBanner({ slug: 'wild-honey' })
    render(el as React.ReactElement)

    // This is the actual fix: a next/image element exists (optimized,
    // resized, compressed) instead of an unoptimized full-resolution
    // image loaded via a plain CSS backgroundImage string.
    const img = screen.getByTestId('next-image')
    expect(img.getAttribute('src')).toBe('/honey.jpg')
  })

  it('renders category name, description, and links to the collection', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 1, name: 'Wild Honey', slug: 'wild-honey', description: 'Pure and raw.', image_url: '/honey.jpg' },
      error: null,
    })

    const el = await FeaturedBanner({ slug: 'wild-honey' })
    render(el as React.ReactElement)

    expect(screen.getByText('Wild Honey')).toBeTruthy()
    expect(screen.getByText('Pure and raw.')).toBeTruthy()
    expect(screen.getByText('Wild Honey').closest('a')?.getAttribute('href')).toBe('/collections/wild-honey')
  })

  it('renders without a description when none is set', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 1, name: 'Wild Honey', slug: 'wild-honey', description: null, image_url: '/honey.jpg' },
      error: null,
    })

    const el = await FeaturedBanner({ slug: 'wild-honey' })
    render(el as React.ReactElement)
    expect(screen.getByText('Wild Honey')).toBeTruthy()
  })

  it('renders nothing when the category is not found', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null })

    const el = await FeaturedBanner({ slug: 'nonexistent' })
    expect(el).toBeNull()
  })

  it('renders nothing (fails safe) on a DB error', async () => {
    mockSingle.mockRejectedValueOnce(new Error('db down'))

    const el = await FeaturedBanner({ slug: 'wild-honey' })
    expect(el).toBeNull()
  })
})
