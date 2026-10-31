// @vitest-environment jsdom
/**
 * LazyOverlays — the cart drawer, search overlay, mobile menu and login modal load on demand (audit perf).
 *  - none of them is in the DOM at page load
 *  - opening a panel loads + mounts exactly that panel
 *  - ~3s after load the rest are warmed up in the background so the first tap is instant
 *  - a failed chunk download is retried the next time the panel is opened
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
// Flip to true in one test to simulate a panel whose chunk/code fails.
const cartBroken = { value: false }
vi.mock('@/components/cart/CartDrawer', () => ({ default: ({ settings }: { settings: { site_name?: string } }) => {
  if (cartBroken.value) throw new Error('chunk failed')
  return <div data-testid="cart">cart:{settings.site_name}</div>
} }))
vi.mock('@/components/search/SearchOverlay', () => ({ default: () => <div data-testid="search" /> }))
vi.mock('@/components/layout/MobileMenu', () => ({ default: ({ categories }: { categories: unknown[] }) => <div data-testid="menu">menu:{categories.length}</div> }))
vi.mock('@/components/auth/AuthModal', () => ({ default: () => <div data-testid="auth" /> }))

import LazyOverlays from '@/components/layout/LazyOverlays'
import { useUIStore } from '@/store/uiStore'

const props = { settings: { site_name: 'HimVeda' } as never, categories: [1, 2] as never, states: [] as never }
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => { vi.useFakeTimers(); push.mockClear(); cartBroken.value = false; useUIStore.setState({ isCartOpen: false, isSearchOpen: false, isMobileMenuOpen: false, isAuthOpen: false }) })
afterEach(() => { vi.useRealTimers() })

describe('LazyOverlays', () => {
  it('mounts none of the panels at page load', async () => {
    render(<LazyOverlays {...props} />)
    await flush(1000)
    for (const id of ['cart', 'search', 'menu', 'auth']) expect(screen.queryByTestId(id)).toBeNull()
  })

  it('opening the cart mounts the cart drawer (with its props) and only the cart', async () => {
    render(<LazyOverlays {...props} />)
    act(() => useUIStore.getState().openCart())
    await flush(10)
    expect(screen.getByTestId('cart').textContent).toBe('cart:HimVeda')
    for (const id of ['search', 'menu', 'auth']) expect(screen.queryByTestId(id)).toBeNull()
  })

  it.each([
    ['openSearch', 'search'], ['openMobileMenu', 'menu'], ['openAuth', 'auth'],
  ] as const)('%s mounts the %s panel', async (action, id) => {
    render(<LazyOverlays {...props} />)
    act(() => useUIStore.getState()[action]())
    await flush(10)
    expect(screen.getByTestId(id)).toBeTruthy()
  })

  it('passes categories to the mobile menu', async () => {
    render(<LazyOverlays {...props} />)
    act(() => useUIStore.getState().openMobileMenu())
    await flush(10)
    expect(screen.getByTestId('menu').textContent).toBe('menu:2')
  })

  it('warms every panel up in the background about 3s after load, so the first tap is instant', async () => {
    render(<LazyOverlays {...props} />)
    await flush(2500)
    expect(screen.queryByTestId('cart')).toBeNull()      // not yet
    await flush(1500)
    for (const id of ['cart', 'search', 'menu', 'auth']) expect(screen.getByTestId(id)).toBeTruthy()
  })

  it('stays mounted after closing so the next open is immediate', async () => {
    render(<LazyOverlays {...props} />)
    act(() => useUIStore.getState().openCart()); await flush(10)
    act(() => useUIStore.getState().closeCart()); await flush(10)
    expect(screen.getByTestId('cart')).toBeTruthy()
  })

  // ── Safety net ────────────────────────────────────────────────────────────────────────────────────────
  it('a panel that fails to load never crashes the page, and an opened cart falls back to the /cart page', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    cartBroken.value = true
    render(<LazyOverlays {...props} />)
    act(() => useUIStore.getState().openCart())
    await flush(50)
    expect(screen.queryByTestId('cart')).toBeNull()
    expect(push).toHaveBeenCalledWith('/cart')
    // the other panels still work
    act(() => useUIStore.getState().openAuth())
    await flush(50)
    expect(screen.getByTestId('auth')).toBeTruthy()
    err.mockRestore()
  })

  it('a failure during the silent background warm-up does not redirect anyone', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    cartBroken.value = true
    render(<LazyOverlays {...props} />)
    await flush(4000)                       // warm-up fires, the cart panel fails, nobody asked for it
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByTestId('search')).toBeTruthy()
    err.mockRestore()
  })
})
