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

  it('bug #19 — empty-state text meets WCAG AA (4.5:1) on the section background', async () => {
    const { default: ExploreByRegion } = await import('@/components/homepage/ExploreByRegion')
    const { container } = render(React.createElement(ExploreByRegion, { states: STATES as any }))
    expect(container.innerHTML).toContain('Products coming soon')

    // The empty state now sits on the cream section background (styles live
    // in a CSS module, so read the rule itself and compute the real ratio).
    const fs = await import('node:fs')
    const path = await import('node:path')
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/homepage/ExploreByRegion.module.css'), 'utf8')
    const fg = /\.empty\s*\{[^}]*?color:\s*(#[0-9a-f]{3,6})/i.exec(css)?.[1]
    const bg = /--cream:\s*(#[0-9a-f]{6})/i.exec(css)?.[1]
    expect(fg).toBeTruthy()
    expect(bg).toBeTruthy()

    const lum = (hex: string) => {
      const h = hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex
      const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
        .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const [hi, lo] = [lum(fg!), lum(bg!)].sort((x, y) => y - x)
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5)
  })

  it('wires the "Explore by Region / Discover the Himalayas" heading to /regions', async () => {
    const { default: ExploreByRegion } = await import('@/components/homepage/ExploreByRegion')
    render(React.createElement(ExploreByRegion, { states: STATES as any }))

    const viewAllLink = screen.getByRole('link', { name: /view all regions/i })
    expect(viewAllLink.getAttribute('href')).toBe('/regions')
  })
})

describe('ExploreByRegion — keyboard, artwork and next-region panel', () => {
  it('arrow keys / Home / End move the selection between region tabs', async () => {
    const { default: ExploreByRegion } = await import('@/components/homepage/ExploreByRegion')
    render(React.createElement(ExploreByRegion, { states: STATES as any }))
    const tablist = screen.getByRole('tablist')
    const tabs = screen.getAllByRole('tab')

    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(tabs[1].getAttribute('tabindex')).toBe('0')
    expect(tabs[0].getAttribute('tabindex')).toBe('-1')

    fireEvent.keyDown(tablist, { key: 'ArrowRight' }) // wraps
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(tablist, { key: 'End' })
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tablist, { key: 'Home' })
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
  })

  it('next-region panel shows the next state, its pills and position counter', async () => {
    const { default: ExploreByRegion } = await import('@/components/homepage/ExploreByRegion')
    const states = [
      { id: 'hp', name: 'Himachal Pradesh', slug: 'hp', image_url: null, description: null, region: null, products: [] },
      { id: 'jk', name: 'Jammu & Kashmir', slug: 'jk', image_url: null, description: null, region: null, products: [] },
    ]
    const { container } = render(React.createElement(ExploreByRegion, { states: states as any }))
    expect(container.textContent).toContain('Paradise on Earth')
    expect(container.textContent).toContain('Kashmiri Kesar')
    expect(container.textContent).toContain('02 / 02')
  })

  it('"Explore <next region>" switches to that region and scrolls the widget back into view', async () => {
    const { default: ExploreByRegion } = await import('@/components/homepage/ExploreByRegion')
    const scrollSpy = vi.fn()
    ;(window.HTMLElement.prototype as any).scrollIntoView = scrollSpy
    const states = [
      { id: 'hp', name: 'Himachal Pradesh', slug: 'hp', image_url: null, description: null, region: null, products: [] },
      { id: 'jk', name: 'Jammu & Kashmir', slug: 'jk', image_url: null, description: null, region: null, products: [] },
    ]
    render(React.createElement(ExploreByRegion, { states: states as any }))
    fireEvent.click(screen.getByRole('button', { name: /explore jammu & kashmir/i }))

    expect(screen.getByRole('tab', { name: 'Jammu & Kashmir' }).getAttribute('aria-selected')).toBe('true')
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('artwork is never stretched: no scaleY distortion on the mountain engraving', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/homepage/ExploreByRegion.module.css'), 'utf8')
    expect(css).not.toMatch(/scaleY/)
    // Flavours-of-<region> mountains are anchored to the bottom of the column.
    expect(css).toMatch(/\.productMountains\s*\{[^}]*bottom:\s*\d+px/)
  })
})
