// @vitest-environment jsdom
/**
 * regionsPage.test.ts
 *
 * Covers src/app/regions/page.tsx (the /regions listing page). This is an
 * async Server Component — a plain async function returning JSX — so it's
 * rendered the same way CartDrawer.itemMemo.test.ts renders components: call
 * the async function directly to get the element, then pass it to RTL's
 * render().
 *
 * Bugs covered:
 *   #1  case-mismatch state_id counting (products.state_id vs states.id)
 *   #8  hero "Products" stat previously used the FULL catalog length instead
 *       of the sum of region-tagged products
 *   #16 state name on each card was a <div>, not a semantic heading
 *   #17 region card <Link> had no aria-label
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// next/image / next/link — same pattern used across the existing suite
// (CartDrawer.itemMemo.test.ts, CartDrawer.test.ts, etc.)
vi.mock('next/image', () => ({
  default: (props: { alt: string; src: string; priority?: boolean }) =>
    React.createElement('img', { alt: props.alt, src: props.src, loading: props.priority ? 'eager' : 'lazy' }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...rest }, children),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('/regions listing page', () => {
  it('bug #1 — counts a product toward its state even when state_id casing differs ' +
     'from the state\'s own id (e.g. product.state_id "HP" vs states.id "hp")', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getStoreData: vi.fn(async () => ({
        states: [
          { id: 'hp', name: 'Himachal Pradesh' },
          { id: 'uk', name: 'Uttarakhand' },
        ],
        state_images: [],
      })),
      getNormalizedProducts: vi.fn(async () => ([
        { id: 1, name: 'Wild Honey', slug: 'wild-honey', state_id: 'HP' },  // mismatched case
        { id: 2, name: 'Apple ACV',  slug: 'apple-acv',  state_id: 'hp' },  // matching case
        { id: 3, name: 'Rajma',      slug: 'rajma',      state_id: 'uk' },
      ])),
    }))

    const { default: RegionsPage } = await import('@/app/regions/page')
    const element = await RegionsPage()
    render(element as React.ReactElement)

    // Both HP products must be counted under Himachal Pradesh despite the
    // casing difference — the pre-fix code would have shown 1, not 2.
    const hpLink = screen.getByRole('link', { name: /explore himachal pradesh products \(2 products\)/i })
    expect(hpLink).toBeTruthy()
  })

  it('bug #8 — hero "Products" stat is the sum of region-tagged products, not the full catalog length', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getStoreData: vi.fn(async () => ({
        states: [{ id: 'hp', name: 'Himachal Pradesh' }],
        state_images: [],
      })),
      getNormalizedProducts: vi.fn(async () => ([
        { id: 1, name: 'Wild Honey', slug: 'wild-honey', state_id: 'hp' },
        { id: 2, name: 'Gift Combo',  slug: 'gift-combo', state_id: null }, // NOT region-tagged
      ])),
    }))

    const { default: RegionsPage } = await import('@/app/regions/page')
    const element = await RegionsPage()
    const { container } = render(element as React.ReactElement)

    // Pre-fix: this would have read "2" (allProducts.length, including the
    // untagged gift combo). Post-fix: only the 1 region-tagged product counts.
    const statLabels = Array.from(container.querySelectorAll('div')).filter(
      d => d.textContent === 'Products'
    )
    expect(statLabels.length).toBeGreaterThan(0)
    const statValue = statLabels[0].previousElementSibling
    expect(statValue?.textContent).toBe('1')
  })

  it('bug #16 — each card\'s state name is a semantic heading, not a plain div', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getStoreData: vi.fn(async () => ({
        states: [{ id: 'hp', name: 'Himachal Pradesh' }],
        state_images: [],
      })),
      getNormalizedProducts: vi.fn(async () => ([])),
    }))

    const { default: RegionsPage } = await import('@/app/regions/page')
    const element = await RegionsPage()
    render(element as React.ReactElement)

    expect(screen.getByRole('heading', { level: 3, name: 'Himachal Pradesh' })).toBeTruthy()
  })

  it('bug #17 — each region card has a descriptive aria-label instead of relying ' +
     'on its jumbled inner content as the accessible name', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getStoreData: vi.fn(async () => ({
        states: [{ id: 'sk', name: 'Sikkim' }],
        state_images: [],
      })),
      getNormalizedProducts: vi.fn(async () => ([])),
    }))

    const { default: RegionsPage } = await import('@/app/regions/page')
    const element = await RegionsPage()
    render(element as React.ReactElement)

    const link = screen.getByRole('link', { name: /explore sikkim products/i })
    expect(link).toBeTruthy()
  })

  it('bug #26 — the first 4 cards (above-the-fold row) get priority for LCP, later ones don\'t', async () => {
    vi.doMock('@/lib/storeData', () => ({
      getStoreData: vi.fn(async () => ({
        states: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, name: `State ${i}` })),
        state_images: [
          { state_id: 's0', image_url: '/s0.jpg', sort_order: 0 },
          { state_id: 's5', image_url: '/s5.jpg', sort_order: 0 },
        ],
      })),
      getNormalizedProducts: vi.fn(async () => ([])),
    }))

    const { default: RegionsPage } = await import('@/app/regions/page')
    const element = await RegionsPage()
    const { container } = render(element as React.ReactElement)

    // State 0 (index 0, has an image) should be eager/priority.
    const firstImg = container.querySelector('img[alt="State 0"]')
    expect(firstImg?.getAttribute('loading')).toBe('eager')

    // State 5 (index 5, has an image) is past the priority cutoff — should lazy-load.
    const lastImg = container.querySelector('img[alt="State 5"]')
    expect(lastImg?.getAttribute('loading')).toBe('lazy')
  })
})
