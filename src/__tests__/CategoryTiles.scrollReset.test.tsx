// @vitest-environment jsdom
/**
 * CategoryTiles.scrollReset.test.tsx
 *
 * Covers a fix found in a fresh re-audit: the category carousel's
 * "seamless infinite loop" boundary reset only ran inside goNext()'s
 * animation-completion callback, meaning it only fired when a user
 * clicked the arrow buttons. Since the track is a plain native-scrollable
 * div, a user swiping/dragging it directly (very plausible on mobile)
 * could scroll straight into the cloned duplicate set and hit a hard
 * stop instead of looping — this test drives that path directly via a
 * 'scroll' event rather than a click.
 */

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
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
  return { id: 1, name: 'Cat', slug: 'cat', is_active: true, image_url: null, ...overrides } as Category
}

describe('CategoryTiles — scroll-driven infinite-loop reset', () => {
  it('snaps scrollLeft back by one full set-width after a manual scroll crosses the clone boundary', () => {
    vi.useFakeTimers()

    // 7 categories: the loop (and its clones) only exists when more categories
    // than the 6 visible desktop tiles are present — see CategoryTiles.tsx.
    const categories = Array.from({ length: 7 }, (_, i) => cat({ id: i + 1, slug: `c-${i + 1}`, name: `Cat ${i + 1}` }))
    const { container } = render(<CategoryTiles categories={categories} />)
    const track = container.querySelector('.cgrid-track') as HTMLDivElement
    expect(track).toBeTruthy()

    // jsdom returns 0 for getBoundingClientRect by default — mock a
    // realistic cell width so the boundary math has something to work with.
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ width: 900 } as DOMRect)
    const cellWidth = 900 / 6 // getVisible() defaults to 6 at desktop widths in jsdom
    const setWidth = categories.length * cellWidth

    // Simulate a manual drag past the clone boundary (further than a
    // single arrow-click step would ever move it).
    Object.defineProperty(track, 'scrollLeft', { value: setWidth + 40, writable: true })
    track.dispatchEvent(new Event('scroll'))

    // Debounced — nothing should happen until scrolling settles.
    expect(track.scrollLeft).toBe(setWidth + 40)

    vi.advanceTimersByTime(150)

    // Snapped back by exactly one set-width, preserving the 40px the
    // user had actually scrolled into the clone set — not reset to 0
    // regardless of drag distance.
    expect(track.scrollLeft).toBeCloseTo(40, 0)

    vi.useRealTimers()
  })
})
