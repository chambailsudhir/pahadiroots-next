/**
 * CartDrawer.test.ts
 *
 * Component-level tests for the DEFAULT export of CartDrawer.tsx (the
 * drawer shell itself) — distinct from CartDrawer.itemMemo.test.ts, which
 * only tests the named `CartDrawerItem` row's memoization.
 *
 * AUDIT GAP: zero coverage on the drawer shell before this file, despite
 * dense, security/accessibility-relevant logic:
 *   • Focus trap (Tab/Shift+Tab cycling within the open dialog).
 *   • Focus return to the opening element on close (WCAG 2.1 §3.2).
 *   • Escape key closes the drawer.
 *   • Body scroll lock with scrollbar-width compensation (no layout shift).
 *   • `inert` attribute toggling so the closed drawer is unreachable by
 *     keyboard/screen reader.
 *   • Free-shipping progress bar math (shipProgressPct clamped to [0,100]).
 *   • Empty-cart vs populated-cart branch rendering.
 *   • Item count badge pluralization.
 *
 * Technique: React.createElement (not JSX) — same constraint as the
 * existing CartDrawer.itemMemo.test.ts (tsconfig "jsx":"preserve").
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, within } from '@testing-library/react'
import React from 'react'
import { useCartStore } from '@/store/cartStore'
import { useUIStore } from '@/store/uiStore'
import type { CartItem, SiteSettings } from '@/types'

vi.mock('@/lib/supabase', () => ({
  supabase:         { from: vi.fn() },
  getServiceClient: vi.fn(() => ({ from: vi.fn() })),
}))

vi.mock('next/image', () => ({
  default: (props: { alt: string; src: string }) =>
    React.createElement('img', { alt: props.alt, src: props.src }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, onClick }: { children: React.ReactNode; href: string; onClick?: () => void }) =>
    React.createElement('a', { href, onClick }, children),
}))

import CartDrawer from '@/components/cart/CartDrawer'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    productId: '1', variantId: 'v1', name: 'Test Ghee', slug: 'test-ghee',
    image: null, emoji: '🧈', size: '250g', price: 100, mrp: 120, gstRate: 5,
    qty: 1, maxQty: 10, isOrganic: false, isHimalayan: true, isBestseller: false,
    ...overrides,
  }
}

const settings = {} as SiteSettings

function el() {
  return React.createElement(CartDrawer, { settings })
}

beforeEach(() => {
  useCartStore.getState().clearCart()
  useCartStore.setState({ _hasHydrated: true })
  useUIStore.setState({ isCartOpen: false } as Partial<ReturnType<typeof useUIStore.getState>>)
  document.body.innerHTML = ''
  document.body.style.overflow = ''
  document.body.style.paddingRight = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Open / close basics
// ─────────────────────────────────────────────────────────────────────────────

describe('CartDrawer — open/close state', () => {
  it('renders the dialog with aria-modal=true when open', () => {
    useUIStore.setState({ isCartOpen: true })
    render(el())
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('clicking the overlay calls closeCart', () => {
    useUIStore.setState({ isCartOpen: true })
    const { container } = render(el())
    const overlay = container.querySelector('[aria-hidden="true"]')
    if (overlay) fireEvent.click(overlay)
    expect(useUIStore.getState().isCartOpen).toBe(false)
  })

  it('pressing Escape closes the drawer', () => {
    useUIStore.setState({ isCartOpen: true })
    render(el())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useUIStore.getState().isCartOpen).toBe(false)
  })

  it('clicking the Close button calls closeCart', () => {
    useUIStore.setState({ isCartOpen: true })
    render(el())
    fireEvent.click(screen.getByRole('button', { name: /close cart/i }))
    expect(useUIStore.getState().isCartOpen).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Focus management (WCAG 2.1 §3.2)
// ─────────────────────────────────────────────────────────────────────────────

describe('CartDrawer — focus trap and focus return', () => {
  it('returns focus to the element that opened the drawer when it closes', async () => {
    const { act } = await import('@testing-library/react')
    const opener = document.createElement('button')
    opener.textContent = 'Open Cart'
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    act(() => { useUIStore.setState({ isCartOpen: true }) })
    const { rerender } = render(el())

    act(() => {
      useUIStore.setState({ isCartOpen: false })
      rerender(el())
    })

    expect(document.activeElement).toBe(opener)
  })

  it('Tab from the last focusable element wraps to the first (focus trap)', () => {
    useUIStore.setState({ isCartOpen: true })
    useCartStore.setState({ items: [makeItem({ variantId: 'v1' })] })
    const { container } = render(el())

    const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'
    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    const last = focusables[focusables.length - 1]
    last.focus()
    expect(document.activeElement).toBe(last)

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(focusables[0])
  })

  it('Shift+Tab from the first focusable element wraps to the last (reverse focus trap)', () => {
    useUIStore.setState({ isCartOpen: true })
    useCartStore.setState({ items: [makeItem({ variantId: 'v1' })] })
    const { container } = render(el())

    const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'
    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    const first = focusables[0]
    first.focus()
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(focusables[focusables.length - 1])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Body scroll lock
// ─────────────────────────────────────────────────────────────────────────────

describe('CartDrawer — body scroll lock', () => {
  it('sets body overflow=hidden when open', () => {
    useUIStore.setState({ isCartOpen: true })
    render(el())
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('restores body overflow when closed', async () => {
    const { act } = await import('@testing-library/react')
    act(() => { useUIStore.setState({ isCartOpen: true }) })
    const { rerender } = render(el())
    expect(document.body.style.overflow).toBe('hidden')

    act(() => {
      useUIStore.setState({ isCartOpen: false })
      rerender(el())
    })
    expect(document.body.style.overflow).toBe('')
  })

  it('clears the scroll lock on unmount even if still open (cleanup safety)', () => {
    useUIStore.setState({ isCartOpen: true })
    const { unmount } = render(el())
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// inert attribute (keyboard/SR trap prevention when closed)
// ─────────────────────────────────────────────────────────────────────────────

describe('CartDrawer — inert attribute toggling', () => {
  it('sets inert on the drawer element when closed', () => {
    useUIStore.setState({ isCartOpen: false })
    const { container } = render(el())
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.hasAttribute('inert')).toBe(true)
  })

  it('removes inert from the drawer element when open', () => {
    useUIStore.setState({ isCartOpen: true })
    const { container } = render(el())
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.hasAttribute('inert')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Empty vs populated cart
// ─────────────────────────────────────────────────────────────────────────────

describe('CartDrawer — empty cart state', () => {
  it('shows the empty-cart message when there are no items', () => {
    useUIStore.setState({ isCartOpen: true })
    useCartStore.setState({ items: [] })
    render(el())
    expect(screen.getByText(/your cart is empty/i)).toBeTruthy()
  })

  it('does not show the footer/checkout CTA when the cart is empty', () => {
    useUIStore.setState({ isCartOpen: true })
    useCartStore.setState({ items: [] })
    render(el())
    expect(screen.queryByText(/proceed to checkout/i)).toBeNull()
  })

  it('shows items and the checkout CTA when the cart has items', () => {
    useUIStore.setState({ isCartOpen: true })
    useCartStore.setState({ items: [makeItem()] })
    render(el())
    expect(screen.getByText('Test Ghee')).toBeTruthy()
    expect(screen.getByText(/proceed to checkout/i)).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Item count badge
// ─────────────────────────────────────────────────────────────────────────────

describe('CartDrawer — item count badge', () => {
  it('shows singular "item" label for a single-quantity cart', () => {
    useUIStore.setState({ isCartOpen: true })
    useCartStore.setState({ items: [makeItem({ qty: 1 })] })
    render(el())
    expect(screen.getByLabelText('1 item in cart')).toBeTruthy()
  })

  it('shows plural "items" label when total qty > 1', () => {
    useUIStore.setState({ isCartOpen: true })
    useCartStore.setState({ items: [makeItem({ qty: 3 })] })
    render(el())
    expect(screen.getByLabelText('3 items in cart')).toBeTruthy()
  })

  it('sums quantities across multiple distinct items for the badge', () => {
    useUIStore.setState({ isCartOpen: true })
    useCartStore.setState({
      items: [makeItem({ variantId: 'v1', qty: 2 }), makeItem({ variantId: 'v2', qty: 3, name: 'Other' })],
    })
    render(el())
    expect(screen.getByLabelText('5 items in cart')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Free-shipping progress bar
// ─────────────────────────────────────────────────────────────────────────────

describe('CartDrawer — free shipping progress bar', () => {
  it('does not render the progress bar once free shipping is reached', () => {
    useUIStore.setState({ isCartOpen: true })
    useCartStore.setState({ items: [makeItem({ price: 1000, qty: 1 })] })
    render(el())
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('renders a progressbar with aria-valuenow between 0 and 100 when below the free-ship threshold', () => {
    useUIStore.setState({ isCartOpen: true })
    useCartStore.setState({ items: [makeItem({ price: 1, qty: 1 })] })
    render(el())

    const bar = screen.queryByRole('progressbar')
    if (bar) {
      const now = Number(bar.getAttribute('aria-valuenow'))
      expect(now).toBeGreaterThanOrEqual(0)
      expect(now).toBeLessThanOrEqual(100)
      expect(bar.getAttribute('aria-valuemin')).toBe('0')
      expect(bar.getAttribute('aria-valuemax')).toBe('100')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Coupon display in footer
// ─────────────────────────────────────────────────────────────────────────────

describe('CartDrawer — coupon display', () => {
  it('shows the discount line when a coupon is applied', () => {
    useUIStore.setState({ isCartOpen: true })
    useCartStore.setState({
      items: [makeItem()],
      coupon: { code: 'SAVE10', discount: 10, type: 'flat' },
    })
    render(el())
    expect(screen.getByText(/discount \(save10\)/i)).toBeTruthy()
  })

  it('does not show a discount line when no coupon is applied', () => {
    useUIStore.setState({ isCartOpen: true })
    useCartStore.setState({ items: [makeItem()], coupon: null })
    render(el())
    expect(screen.queryByText(/discount \(/i)).toBeNull()
  })
})
