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
import { render, act } from '@testing-library/react'

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

  it('BUG FIX: stays transparent while the hero is still on screen, even once scrollY is well past a flat 60px — only the hero itself leaving the viewport should trigger the solid look', async () => {
    mockPathname = '/'
    // Real IntersectionObserver doesn't exist in jsdom; capture the
    // callback so the test can drive it directly, simulating "hero still
    // intersecting" (large scrollY, but the 75vh-tall hero is still
    // mostly on screen) vs "hero has scrolled fully out of view".
    let ioCallback: (entries: Array<{ isIntersecting: boolean }>) => void = () => {}
    class MockIntersectionObserver {
      constructor(cb: typeof ioCallback) { ioCallback = cb }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    Object.defineProperty(window, 'scrollY', { value: 400, writable: true, configurable: true })

    const heroEl = document.createElement('div')
    heroEl.id = 'home-hero-banner'
    document.body.appendChild(heroEl)

    const { container } = render(<Header settings={settings} />)
    const nav = () => container.querySelector('nav.old-nav')

    // Hero still intersecting (on screen) — must stay transparent despite
    // a large scrollY, unlike the old flat-60px behaviour.
    act(() => { ioCallback([{ isIntersecting: true }]) })
    expect(nav()?.classList.contains('overlay-nav-transparent')).toBe(true)

    // Hero has scrolled fully out of view — now it should go solid.
    act(() => { ioCallback([{ isIntersecting: false }]) })
    expect(nav()?.classList.contains('overlay-nav-transparent')).toBe(false)
    expect(nav()?.classList.contains('scrolled')).toBe(true)

    document.body.removeChild(heroEl)
    vi.unstubAllGlobals()
  })
})
