/**
 * CartUIComponents.test.ts
 *
 * Component-level tests for CartUIComponents.tsx — StickyCartCTA (mobile
 * sticky checkout bar) and EmptyCart. Zero coverage before this file.
 *
 * Covered here:
 *   1. [BUG FIX] belowMinOrder uses `orderSubtotal ?? total`, not `total`.
 *      Locks in the prior-round fix: the min-order gate must compare the
 *      PRE-shipping subtotal (matching CartSummary), not the post-shipping
 *      total — using `total` would let a low-subtotal order squeak past the
 *      gate once shipping is added on top, inconsistent with CartSummary's
 *      gating on the same order.
 *   2. Falls back to `total` when orderSubtotal is not provided (back-compat
 *      for existing call sites — the prop is optional).
 *   3. matchMedia-driven isMobile state — inert/aria-hidden applied on
 *      desktop (>960px), removed on mobile (<=960px), and the effect
 *      correctly subscribes/unsubscribes from the 'change' event.
 *   4. onCheckout (flushPendingRemovals) fires on the real Link.
 *   5. EmptyCart — static content renders; decorative icon is aria-hidden.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import React from 'react'

vi.mock('next/link', () => ({
  default: ({ children, href, onClick }: { children: React.ReactNode; href: string; onClick?: () => void }) =>
    React.createElement('a', { href, onClick }, children),
}))

import { StickyCartCTA, EmptyCart } from '@/components/cart/CartUIComponents'

// ─── matchMedia mock ──────────────────────────────────────────────────────────

interface MqlMock {
  matches: boolean
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  trigger: (matches: boolean) => void
}

function mockMatchMedia(initialMatches: boolean): MqlMock {
  let listener: ((e: { matches: boolean }) => void) | null = null
  const mql: MqlMock = {
    matches: initialMatches,
    addEventListener: vi.fn((_event: string, cb: (e: { matches: boolean }) => void) => { listener = cb }),
    removeEventListener: vi.fn(),
    trigger: (matches: boolean) => {
      mql.matches = matches
      listener?.({ matches })
    },
  }
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia
  return mql
}

function el(props: Partial<React.ComponentProps<typeof StickyCartCTA>> = {}) {
  return React.createElement(StickyCartCTA, {
    total: 500,
    totalQty: 2,
    ...props,
  } as React.ComponentProps<typeof StickyCartCTA>)
}

beforeEach(() => {
  mockMatchMedia(false) // default: desktop (not mobile)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// [BUG FIX] orderSubtotal vs total for min-order gating
// ─────────────────────────────────────────────────────────────────────────────

describe('StickyCartCTA — orderSubtotal min-order gating (BUG FIX)', () => {
  it('gates checkout using orderSubtotal, NOT total, when both are provided and differ', () => {
    // total (post-shipping) = 600, orderSubtotal (pre-shipping) = 300.
    // minOrderAmt = 500: comparing against `total` (600) would WRONGLY pass;
    // comparing against `orderSubtotal` (300) correctly fails the gate.
    // mockMatchMedia(true) -> mobile, so the wrapper isn't `inert` and the
    // disabled button is reachable by getByRole (inert elements are excluded
    // from the accessibility tree).
    mockMatchMedia(true)
    render(el({ total: 600, orderSubtotal: 300, minOrderAmt: 500 }))
    const btn = screen.getByRole('button', { name: /checkout/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('allows checkout when orderSubtotal alone meets minOrderAmt, even if total is lower due to a discount', () => {
    render(el({ total: 450, orderSubtotal: 500, minOrderAmt: 500 }))
    expect(screen.queryByRole('button', { name: /checkout/i })).toBeNull()
    const link = screen.getByText(/checkout/i).closest('a')
    expect(link?.getAttribute('href')).toBe('/checkout')
  })

  it('falls back to `total` for the gate when orderSubtotal is not provided', () => {
    mockMatchMedia(true)
    render(el({ total: 300, orderSubtotal: undefined, minOrderAmt: 500 }))
    const btn = screen.getByRole('button', { name: /checkout/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not gate when minOrderAmt is 0', () => {
    render(el({ total: 1, orderSubtotal: 1, minOrderAmt: 0 }))
    const link = screen.getByText(/checkout/i).closest('a')
    expect(link).toBeTruthy()
  })

  it('always displays `total` (not orderSubtotal) as the visible amount, regardless of the gate', () => {
    render(el({ total: 600, orderSubtotal: 300, minOrderAmt: 0 }))
    expect(screen.getByText('₹600')).toBeTruthy()
    expect(screen.queryByText('₹300')).toBeNull()
  })

  it('calls onCheckout when the real (non-gated) Link is clicked', () => {
    const onCheckout = vi.fn()
    render(el({ total: 600, orderSubtotal: 600, minOrderAmt: 500, onCheckout }))
    fireEvent.click(screen.getByText(/checkout/i))
    expect(onCheckout).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// matchMedia-driven isMobile / inert toggling
// ─────────────────────────────────────────────────────────────────────────────

describe('StickyCartCTA — responsive inert/aria-hidden toggling', () => {
  it('applies inert and aria-hidden when matchMedia reports desktop (not mobile)', () => {
    mockMatchMedia(false)
    const { container } = render(el())
    const wrap = container.firstElementChild as HTMLElement
    expect(wrap.hasAttribute('inert')).toBe(true)
    expect(wrap.getAttribute('aria-hidden')).toBe('true')
  })

  it('removes inert and aria-hidden when matchMedia reports mobile', () => {
    mockMatchMedia(true)
    const { container } = render(el())
    const wrap = container.firstElementChild as HTMLElement
    expect(wrap.hasAttribute('inert')).toBe(false)
    expect(wrap.hasAttribute('aria-hidden')).toBe(false)
  })

  it('reacts to a live viewport change event (desktop -> mobile)', async () => {
    const { act } = await import('@testing-library/react')
    const mql = mockMatchMedia(false)
    const { container } = render(el())
    const wrap = container.firstElementChild as HTMLElement
    expect(wrap.hasAttribute('inert')).toBe(true)

    act(() => { mql.trigger(true) }) // simulate a resize crossing the breakpoint
    expect(wrap.hasAttribute('inert')).toBe(false)
  })

  it('registers a matchMedia change listener on mount', () => {
    const mql = mockMatchMedia(false)
    render(el())
    expect(mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('removes the matchMedia change listener on unmount (no leak)', () => {
    const mql = mockMatchMedia(false)
    const { unmount } = render(el())
    unmount()
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('queries the (max-width: 960px) breakpoint', () => {
    const matchMediaSpy = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })
    window.matchMedia = matchMediaSpy as unknown as typeof window.matchMedia
    render(el())
    expect(matchMediaSpy).toHaveBeenCalledWith('(max-width: 960px)')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Item count pluralization
// ─────────────────────────────────────────────────────────────────────────────

describe('StickyCartCTA — item count display', () => {
  it('shows singular "item" for qty 1', () => {
    render(el({ totalQty: 1 }))
    expect(screen.getByText(/1 item ·/i)).toBeTruthy()
  })

  it('shows plural "items" for qty > 1', () => {
    render(el({ totalQty: 4 }))
    expect(screen.getByText(/4 items ·/i)).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EmptyCart
// ─────────────────────────────────────────────────────────────────────────────

describe('EmptyCart', () => {
  it('renders the empty-cart heading and tagline', () => {
    render(React.createElement(EmptyCart))
    expect(screen.getByText('Your cart is empty')).toBeTruthy()
    expect(screen.getByText(/from high-altitude farms/i)).toBeTruthy()
  })

  it('renders a Browse Products link to /products', () => {
    render(React.createElement(EmptyCart))
    const link = screen.getByText(/browse products/i).closest('a')
    expect(link?.getAttribute('href')).toBe('/products')
  })

  it('marks the decorative cart icon as aria-hidden', () => {
    const { container } = render(React.createElement(EmptyCart))
    const icon = container.querySelector('[aria-hidden="true"]')
    expect(icon?.textContent).toBe('🛒')
  })
})
