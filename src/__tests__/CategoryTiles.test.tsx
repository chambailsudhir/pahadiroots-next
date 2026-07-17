// @vitest-environment jsdom
/**
 * CategoryTiles.test.tsx
 *
 * Component-level coverage for CategoryTiles.tsx — previously zero test
 * coverage. The carousel-math bug fix (stale VISIBLE after a
 * cross-breakpoint resize) and the autoplay/reduced-motion fix are
 * effect-internal behavior that's hard to assert directly in jsdom
 * (getBoundingClientRect returns 0 in jsdom, so pixel-width math can't
 * be meaningfully observed) — this file covers what's actually
 * observable: correct filtering, correct emoji (the P2 fix — shared
 * emojiForCategory instead of the old per-component broken version),
 * correct links, and that inactive categories never render.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('next/image', () => ({
  default: ({ fill, priority, ...props }: Record<string, unknown>) =>
    React.createElement('img', { ...props, alt: props.alt as string }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

window.matchMedia = window.matchMedia || vi.fn().mockImplementation((query: string) => ({
  matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
}))

import CategoryTiles from '@/components/homepage/CategoryTiles'
import type { Category } from '@/types'

function cat(overrides: Partial<Category> = {}): Category {
  return {
    id: 1, name: 'Wild Honey', slug: 'wild-honey', is_active: true, image_url: null,
    ...overrides,
  } as Category
}

describe('CategoryTiles', () => {
  it('renders only active categories', () => {
    render(<CategoryTiles categories={[
      cat({ id: 1, name: 'Active Cat', is_active: true }),
      cat({ id: 2, name: 'Inactive Cat', is_active: false }),
    ]} />)

    expect(screen.getAllByText('Active Cat').length).toBeGreaterThan(0)
    expect(screen.queryByText('Inactive Cat')).toBeNull()
  })

  it('links each tile to its collection page', () => {
    render(<CategoryTiles categories={[cat({ slug: 'kashmiri-saffron', name: 'Kashmiri Saffron' })]} />)
    const links = screen.getAllByText('Kashmiri Saffron').map(el => el.closest('a'))
    expect(links[0]?.getAttribute('href')).toBe('/collections/kashmiri-saffron')
  })

  it('shows a real emoji for a recognized category name, not duplicated text (P2 fix)', () => {
    render(<CategoryTiles categories={[cat({ name: 'Wild Honey', slug: 'honey' })]} />)
    // This is the actual bug this component's fix guarded against: the
    // shared emojiForCategory() must return an emoji character, never a
    // second copy of the category name.
    expect(screen.getAllByText('🍯').length).toBeGreaterThan(0)
  })

  it('renders nothing at all with zero categories (not an empty carousel shell)', () => {
    const { container } = render(<CategoryTiles categories={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('doubles a single category as an aria-hidden clone for the infinite-loop effect', () => {
    render(<CategoryTiles categories={[cat({ name: 'Only One' })]} />)
    // The component always renders [...active, ...active] for the
    // seamless-loop carousel effect — the second copy is marked
    // aria-hidden so it's invisible to assistive tech and the real
    // count as far as the user is concerned is still 1.
    const instances = screen.getAllByText('Only One')
    expect(instances.length).toBe(2)
    const hiddenCount = instances.filter(el => el.closest('[aria-hidden="true"]')).length
    expect(hiddenCount).toBe(1)
  })
})
