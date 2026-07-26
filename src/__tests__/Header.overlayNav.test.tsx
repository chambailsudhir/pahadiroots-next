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
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
    const heroEl = document.createElement('div')
    heroEl.id = 'home-hero-banner'
    document.body.appendChild(heroEl)
    // Hero still mostly on screen: its bottom edge is well below the nav.
    heroEl.getBoundingClientRect = () => ({ bottom: 500, height: 600 } as DOMRect)
    Object.defineProperty(window, 'scrollY', { value: 400, writable: true, configurable: true })

    const { container } = render(<Header settings={settings} />)
    const nav = () => container.querySelector('nav.old-nav')

    // Hero still on screen — must stay transparent despite a large
    // scrollY, unlike the old flat-60px behaviour.
    act(() => { window.dispatchEvent(new Event('scroll')) })
    expect(nav()?.classList.contains('overlay-nav-transparent')).toBe(true)

    // Hero has scrolled fully out of view (its bottom edge is now above
    // the nav) — now it should go solid.
    heroEl.getBoundingClientRect = () => ({ bottom: -10, height: 600 } as DOMRect)
    act(() => { window.dispatchEvent(new Event('scroll')) })
    expect(nav()?.classList.contains('overlay-nav-transparent')).toBe(false)
    expect(nav()?.classList.contains('scrolled')).toBe(true)

    document.body.removeChild(heroEl)
    vi.unstubAllGlobals()
  })

  it('BUG FIX: does not flicker when topBarHeight changes — the heroPast scroll listener must not be torn down and recreated on every topBarHeight update (this was the cause of the reported random transparent/solid flicker)', async () => {
    mockPathname = '/'
    const heroEl = document.createElement('div')
    heroEl.id = 'home-hero-banner'
    document.body.appendChild(heroEl)
    heroEl.getBoundingClientRect = () => ({ bottom: 500, height: 600 } as DOMRect)

    const addSpy = vi.spyOn(window, 'addEventListener')
    render(<Header settings={settings} />)
    const scrollListenerCallsAfterMount = addSpy.mock.calls.filter(c => c[0] === 'scroll').length

    // Simulate the topBar's ResizeObserver firing several times in a row
    // (e.g. sub-pixel layout recalculation) — this used to be exactly
    // what tore the old IntersectionObserver-based effect down and
    // rebuilt it repeatedly.
    act(() => {
      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('resize'))
    })

    const scrollListenerCallsAfterResizes = addSpy.mock.calls.filter(c => c[0] === 'scroll').length
    expect(scrollListenerCallsAfterResizes).toBe(scrollListenerCallsAfterMount)

    addSpy.mockRestore()
    document.body.removeChild(heroEl)
  })

  it('BUG FIX: ignores a hero measurement taken before layout has settled (height still 0), instead of trusting it and incorrectly snapping to solid on the very first paint of a hard refresh', () => {
    mockPathname = '/'
    const heroEl = document.createElement('div')
    heroEl.id = 'home-hero-banner'
    document.body.appendChild(heroEl)
    // Simulates the exact failure: right at mount, before web fonts/
    // images have settled, the hero transiently reads as zero-height
    // with a bottom at/under the nav — which used to be trusted at
    // face value and incorrectly flipped heroPast to true.
    heroEl.getBoundingClientRect = () => ({ bottom: 0, height: 0 } as DOMRect)

    const { container } = render(<Header settings={settings} />)
    const nav = container.querySelector('nav.old-nav')
    // Must stay transparent — the bad reading should have been ignored.
    expect(nav?.classList.contains('overlay-nav-transparent')).toBe(true)

    document.body.removeChild(heroEl)
  })

  it('BUG FIX: also ignores a small-but-nonzero reading, not only an exact zero (a transient not-yet-settled layout can land on either)', () => {
    mockPathname = '/'
    const heroEl = document.createElement('div')
    heroEl.id = 'home-hero-banner'
    document.body.appendChild(heroEl)
    // 40px is nowhere near the hero's real ~540-800px range, but is not
    // literally zero — this would have slipped past a height > 0 check.
    heroEl.getBoundingClientRect = () => ({ bottom: 30, height: 40 } as DOMRect)

    const { container } = render(<Header settings={settings} />)
    const nav = container.querySelector('nav.old-nav')
    expect(nav?.classList.contains('overlay-nav-transparent')).toBe(true)

    document.body.removeChild(heroEl)
  })

  it('BUG FIX: a bad first reading (nav incorrectly stuck solid even though the hero is genuinely fully in view) gets corrected by one of the delayed retries, without needing a scroll or the (unreliable, fires-once) window load event', () => {
    vi.useFakeTimers()
    mockPathname = '/'
    const heroEl = document.createElement('div')
    heroEl.id = 'home-hero-banner'
    document.body.appendChild(heroEl)
    // Mirrors the reported bug exactly: on first mount the hero
    // transiently reads as having (almost) scrolled away — a large
    // enough height to pass the layout-settled guard, but a bottom
    // that's wrongly small — snapping the nav solid even though
    // scrollY is 0 and the hero is fully visible on screen.
    heroEl.getBoundingClientRect = () => ({ bottom: -5, height: 700 } as DOMRect)

    const { container } = render(<Header settings={settings} />)
    const nav = () => container.querySelector('nav.old-nav')
    expect(nav()?.classList.contains('overlay-nav-transparent')).toBe(false)
    expect(nav()?.classList.contains('scrolled')).toBe(true)

    // ...then a moment later a fresh measurement reflects the hero's
    // real, fully-in-view position — with no scroll, resize, or load
    // event ever firing, only time passing (one of the retry timers).
    heroEl.getBoundingClientRect = () => ({ bottom: 700, height: 700 } as DOMRect)
    act(() => { vi.advanceTimersByTime(2000) })

    expect(nav()?.classList.contains('overlay-nav-transparent')).toBe(true)

    document.body.removeChild(heroEl)
    vi.useRealTimers()
  })
})
