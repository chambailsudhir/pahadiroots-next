// @vitest-environment jsdom
/**
 * exploreByRegion.test.ts
 *
 * Covers src/components/homepage/ExploreByRegion.tsx (the homepage "Explore
 * by Region" widget).
 *
 * Bugs covered:
 *   #18 the region selector behaves like a tab list (click a region, panel
 *       updates) but had zero ARIA semantics.
 *   #19 the dark-background "Products coming soon" empty-state text was
 *       rgba(255,255,255,.35) on #0d1f0e — ~3.2:1 contrast, fails WCAG AA.
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/image', () => ({
  default: (props: { alt: string; src: string }) =>
    React.createElement('img', { alt: props.alt, src: props.src }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))
vi.mock('@/components/product/ProductCard', () => ({
  default: ({ product }: { product: { name: string } }) =>
    React.createElement('div', null, product.name),
}))

const STATES = [
  { id: 'hp', name: 'Himachal Pradesh', slug: 'hp', image_url: null, description: null, region: null, products: [] },
  { id: 'uk', name: 'Uttarakhand',      slug: 'uk', image_url: null, description: null, region: null, products: [] },
]

describe('ExploreByRegion — region selector', () => {
  it('bug #18 — exposes the selector as a tablist with tab roles and aria-selected', async () => {
    const { default: ExploreByRegion } = await import('@/components/homepage/ExploreByRegion')
    render(React.createElement(ExploreByRegion, { states: STATES as any }))

    const tablist = screen.getByRole('tablist', { name: /explore by region/i })
    expect(tablist).toBeTruthy()

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)

    // First state is active by default (useState(states[0]?.id))
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[1].getAttribute('aria-selected')).toBe('false')

    // Clicking the second tab flips aria-selected — proves the ARIA state
    // actually tracks the real interactive state, not just static markup.
    fireEvent.click(tabs[1])
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(tabs[0].getAttribute('aria-selected')).toBe('false')
  })

  it('bug #18 — the active panel is linked to its tab via aria-controls/id and role=tabpanel', async () => {
    const { default: ExploreByRegion } = await import('@/components/homepage/ExploreByRegion')
    const { container } = render(React.createElement(ExploreByRegion, { states: STATES as any }))

    const tab = screen.getAllByRole('tab')[0]
    const controlsId = tab.getAttribute('aria-controls')
    expect(controlsId).toBeTruthy()

    const panel = container.querySelector(`#${controlsId}`)
    expect(panel).toBeTruthy()
    expect(panel?.getAttribute('role')).toBe('tabpanel')
  })

  it('bug #19 — empty-state text is not the low-contrast rgba(255,255,255,.35)', async () => {
    const { default: ExploreByRegion } = await import('@/components/homepage/ExploreByRegion')
    const { container } = render(React.createElement(ExploreByRegion, { states: STATES as any }))

    // Both states have zero products, so the empty-state branch renders.
    expect(container.innerHTML).toContain('Products coming soon')
    // jsdom keeps rgba() as-is (only hex gets converted to rgb()), so we can
    // match the literal alpha value directly here.
    expect(container.innerHTML).not.toContain('rgba(255, 255, 255, 0.35)')
    expect(container.innerHTML).toContain('rgba(255, 255, 255, 0.6)')
  })
})
