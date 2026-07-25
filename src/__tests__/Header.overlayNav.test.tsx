// @vitest-environment jsdom
/**
 * Header.overlayNav.test.tsx
 *
 * FEATURE (requested): on the homepage, the hero banner was always
 * squeezed into whatever height was left below the header — the
 * announcement bar + ticker + 64px nav row all reserved flow space
 * above it, forcing the hero's background image to crop more than
 * necessary. This makes the nav a fixed, transparent-until-scrolled
 * overlay on the homepage only, so the hero gets its full height back.
 * Every other page keeps the original solid, in-flow nav untouched.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

let mockPathname = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))
vi.mock('next/image', () => ({
  default: (props: { alt: string; src: string }) =>
    React.createElement('img', { alt: props.alt, src: props.src }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))
vi.mock('@/lib/getSiteSettings', () => ({
  isEnabled: (v: unknown) => v === 'true' || v === true,
}))

import Header from '@/components/layout/Header'
import { useUIStore } from '@/store/uiStore'
import { useUserStore } from '@/store/userStore'
import { useCartStore } from '@/store/cartStore'
import type { SiteSettings } from '@/types'

const settings = {} as SiteSettings

beforeEach(() => {
  mockPathname = '/'
  useUIStore.setState({ isCartOpen: false, isSearchOpen: false, isMobileMenuOpen: false, isAuthOpen: false })
  useUserStore.setState({ user: null, wishlist: [] } as unknown as ReturnType<typeof useUserStore.getState>)
  useCartStore.setState({ items: [] } as unknown as ReturnType<typeof useCartStore.getState>)
})

describe('Header — homepage-only transparent overlay nav', () => {
  it('gives the nav the fixed, transparent overlay classes on the homepage', () => {
    mockPathname = '/'
    const { container } = render(<Header settings={settings} />)
    const nav = container.querySelector('nav.old-nav')
    expect(nav?.classList.contains('overlay-nav')).toBe(true)
    expect(nav?.classList.contains('overlay-nav-transparent')).toBe(true)
    expect((nav as HTMLElement).style.position).toBe('fixed')
  })

  it('does not use the overlay nav on any other page', () => {
    mockPathname = '/products'
    const { container } = render(<Header settings={settings} />)
    const nav = container.querySelector('nav.old-nav')
    expect(nav?.classList.contains('overlay-nav')).toBe(false)
    expect(nav?.classList.contains('overlay-nav-transparent')).toBe(false)
    expect((nav as HTMLElement).style.position).not.toBe('fixed')
  })

  it('BUG FIX: detects an already-scrolled position on mount (e.g. browser scroll-restoration on refresh/back-navigation) instead of waiting for the next scroll event', async () => {
    mockPathname = '/'
    Object.defineProperty(window, 'scrollY', { value: 120, writable: true, configurable: true })
    const { container, findByText } = render(<Header settings={settings} />)
    // flush the mount effect
    await findByText(/himveda/i, {}, { timeout: 1000 }).catch(() => null)
    const nav = container.querySelector('nav.old-nav')
    // Previously this stayed `overlay-nav-transparent` (white text, see-
    // through background) even though the page was already scrolled past
    // the hero — producing white-on-white text over whatever plain page
    // background happened to be behind the fixed nav at that scroll
    // offset. It must reflect the real scroll position immediately.
    expect(nav?.classList.contains('overlay-nav-transparent')).toBe(false)
    expect(nav?.classList.contains('scrolled')).toBe(true)
  })
})
