/**
 * MobileBottomNav.test.tsx
 *
 * Had ZERO test coverage before this file, despite being a brand-new,
 * route-aware, always-mounted-in-layout.tsx component — jsdom has no real
 * IntersectionObserver, and the scroll-to-top button uses the real API,
 * so any test that rendered this component would have crashed on mount
 * until __mocks__/intersectionObserver.ts existed.
 *
 * Covers:
 *   • Route suppression — returns null on /account and /checkout (each has
 *     its own contextual bottom bar), renders everywhere else including
 *     /products/[slug] (the PDP's own sticky bar sits ABOVE this nav
 *     rather than replacing it — see AddToCartSection.test.ts).
 *   • Home tab active state (BUG FIX — claimed done in an earlier report,
 *     verified NOT actually in the code, now genuinely implemented):
 *     .active class + aria-current="page" only on '/'.
 *   • Cart badge count reflects the cart store and caps display at "9+".
 *   • Search/cart/menu buttons call the right useUIStore action.
 *   • WhatsApp "Chat" link is present only when settings.whatsapp_number
 *     is set, and strips non-digit characters for the wa.me href.
 *   • Scroll-to-top button visibility is driven by the sentinel's
 *     IntersectionObserver, not a scroll listener.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { act } from 'react'
import React from 'react'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import type { SiteSettings } from '@/types'
import { resetIntersectionObserverMock, fireIntersection } from './__mocks__/intersectionObserver'

let mockPathname = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

import MobileBottomNav from '@/components/layout/MobileBottomNav'

const settings = {} as SiteSettings

function makeCartItem(qty: number) {
  return {
    productId: '1', variantId: '1', name: 'Honey', slug: 'honey',
    image: '', emoji: '🍯', size: '500g', price: 250, mrp: 300,
    gstRate: 5, maxQty: 20, qty,
    isOrganic: false, isHimalayan: false, isBestseller: false,
  }
}

// MobileBottomNav observes a sentinel div by ID that layout.tsx renders as
// a sibling, not as its own child — a standalone render needs the same
// sentinel present for the scroll-to-top IntersectionObserver to ever
// actually get constructed against a real element.
function renderNav(props: Partial<React.ComponentProps<typeof MobileBottomNav>> = {}) {
  return render(
    <>
      <div id="mbn-scroll-sentinel" />
      <MobileBottomNav settings={settings} {...props} />
    </>
  )
}

beforeEach(() => {
  mockPathname = '/'
  useCartStore.getState().clearCart()
  useCartStore.setState({ _hasHydrated: true })
  useUIStore.setState({
    isCartOpen: false, isSearchOpen: false, isMobileMenuOpen: false,
  } as Partial<ReturnType<typeof useUIStore.getState>>)
  resetIntersectionObserverMock()
})

// ─────────────────────────────────────────────────────────────────────────────
// Route suppression
// ─────────────────────────────────────────────────────────────────────────────
describe('MobileBottomNav — route suppression', () => {
  it('renders on the home page', () => {
    mockPathname = '/'
    const { container } = renderNav()
    expect(container.querySelector('.mbn')).not.toBeNull()
  })

  it('renders on the /products LISTING page', () => {
    mockPathname = '/products'
    const { container } = renderNav()
    expect(container.querySelector('.mbn')).not.toBeNull()
  })

  it('renders on an individual product page too (PDP sticky bar sits above it, not instead of it)', () => {
    mockPathname = '/products/himalayan-honey'
    const { container } = renderNav()
    expect(container.querySelector('.mbn')).not.toBeNull()
  })

  it('does NOT render on /account (has its own .mobTabs bar)', () => {
    mockPathname = '/account'
    const { container } = renderNav()
    expect(container.querySelector('.mbn')).toBeNull()
  })

  it('does NOT render on nested /account routes', () => {
    mockPathname = '/account/orders'
    const { container } = renderNav()
    expect(container.querySelector('.mbn')).toBeNull()
  })

  it('does NOT render on /checkout (has its own .ck-mob-bar)', () => {
    mockPathname = '/checkout'
    const { container } = renderNav()
    expect(container.querySelector('.mbn')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Home tab active state (BUG FIX — genuinely implemented now)
// ─────────────────────────────────────────────────────────────────────────────
describe('MobileBottomNav — Home tab active state', () => {
  it('marks Home active with aria-current="page" on the homepage', () => {
    mockPathname = '/'
    const { container } = renderNav()
    const home = container.querySelector('a.mbn-item') as HTMLAnchorElement
    expect(home.className).toContain('active')
    expect(home.getAttribute('aria-current')).toBe('page')
  })

  it('does NOT mark Home active on any other page', () => {
    mockPathname = '/products'
    const { container } = renderNav()
    const home = container.querySelector('a.mbn-item') as HTMLAnchorElement
    expect(home.className).not.toContain('active')
    expect(home.getAttribute('aria-current')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cart badge
// ─────────────────────────────────────────────────────────────────────────────
describe('MobileBottomNav — cart badge', () => {
  it('shows no badge when the cart is empty', () => {
    const { container } = renderNav()
    expect(container.querySelector('.mbn-badge')).toBeNull()
  })

  it('shows the item count once mounted and the cart has items', () => {
    useCartStore.getState().addItem(makeCartItem(3))
    const { container } = renderNav()
    expect(container.querySelector('.mbn-badge')?.textContent).toBe('3')
  })

  it('caps the badge display at "9+" for large counts', () => {
    useCartStore.getState().addItem(makeCartItem(15))
    const { container } = renderNav()
    expect(container.querySelector('.mbn-badge')?.textContent).toBe('9+')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Panel actions — same source of truth as Header.tsx
// ─────────────────────────────────────────────────────────────────────────────
describe('MobileBottomNav — search/cart/menu wire into the shared useUIStore', () => {
  it('Search button opens the search overlay', () => {
    render(<MobileBottomNav settings={settings} />)
    fireEvent.click(document.querySelector('.mbn-item:nth-child(2)') as HTMLElement)
    expect(useUIStore.getState().isSearchOpen).toBe(true)
  })

  it('Cart button opens the cart drawer', () => {
    render(<MobileBottomNav settings={settings} />)
    const cartBtn = document.querySelector('button[aria-label="Open cart"]') as HTMLElement
    fireEvent.click(cartBtn)
    expect(useUIStore.getState().isCartOpen).toBe(true)
  })

  it('More button opens the mobile menu', () => {
    render(<MobileBottomNav settings={settings} />)
    fireEvent.click(document.querySelector('button[aria-label="Open menu"]') as HTMLElement)
    expect(useUIStore.getState().isMobileMenuOpen).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp chat link
// ─────────────────────────────────────────────────────────────────────────────
describe('MobileBottomNav — WhatsApp chat link', () => {
  it('is absent when settings.whatsapp_number is not set', () => {
    const { container } = renderNav()
    expect(container.querySelector('a[href^="https://wa.me/"]')).toBeNull()
  })

  it('links to wa.me with only digits from whatsapp_number', () => {
    const { container } = renderNav({ settings: { ...settings, whatsapp_number: '+91 98765-43210' } })
    const link = container.querySelector('a[href^="https://wa.me/"]') as HTMLAnchorElement
    expect(link.href).toContain('https://wa.me/919876543210')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scroll-to-top button (IntersectionObserver-driven, not a scroll listener)
// ─────────────────────────────────────────────────────────────────────────────
describe('MobileBottomNav — scroll-to-top button', () => {
  it('starts hidden (not "visible") since the sentinel is presumed in view on mount', () => {
    const { container } = renderNav()
    expect(container.querySelector('.stt-btn')?.className).not.toContain('visible')
  })

  it('becomes visible once the sentinel scrolls out of view, and calls window.scrollTo when clicked', () => {
    const scrollToSpy = vi.fn()
    window.scrollTo = scrollToSpy
    const { container } = renderNav()
    act(() => fireIntersection(false))
    const btn = container.querySelector('.stt-btn') as HTMLButtonElement
    expect(btn.className).toContain('visible')
    fireEvent.click(btn)
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('is not focusable while hidden (tabIndex -1, aria-hidden true)', () => {
    const { container } = renderNav()
    const btn = container.querySelector('.stt-btn') as HTMLButtonElement
    expect(btn.tabIndex).toBe(-1)
    expect(btn.getAttribute('aria-hidden')).toBe('true')
  })
})
