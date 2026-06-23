/**
 * CartSummary.test.ts
 *
 * Component-level tests for CartSummary.tsx — the order summary panel with
 * coupon input, price breakdown, and checkout CTA. Zero coverage before
 * this file.
 *
 * Covered here:
 *   1. belowMinOrder gating — disabled button + warning message vs. the
 *      real checkout Link, based on minOrderAmt vs pricing.subtotal.
 *   2. [BUG FIX] Enter key in the coupon input is blocked while couponLoading
 *      is true (prevents a double-submit race).
 *   3. [BUG FIX] coupon hint pills are disabled while couponLoading is true
 *      (same race-condition guard as the Apply button).
 *   4. onCheckout (flushPendingRemovals) fires when the real Link is clicked.
 *   5. aria-invalid / aria-describedby wiring on the coupon input reflects
 *      couponError state.
 *   6. Coupon-applied banner replaces the input; clicking the remove (✕)
 *      button calls onRemoveCoupon.
 *   7. Conditional rows: coupon discount line, free-shipping vs paid
 *      shipping, GST note, savings pill — each only rendered when its
 *      underlying condition is true.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import React from 'react'
import type { AppliedCoupon } from '@/types'
import type { PriceSummary } from '@/lib/services/pricingService'

vi.mock('next/link', () => ({
  default: ({ children, href, onClick }: { children: React.ReactNode; href: string; onClick?: () => void }) =>
    React.createElement('a', { href, onClick }, children),
}))

import CartSummary from '@/components/cart/CartSummary'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePricing(overrides: Partial<PriceSummary> = {}): PriceSummary {
  return {
    subtotal: 500, discount: 0, shipping: 0, isFreeShipping: true,
    total: 500, gstTotal: 25, freeShippingMin: 799, remainingForFreeShip: 0,
    progressBase: 500, prepaidDiscount: 0,
    ...overrides,
  } as PriceSummary
}

const noop = () => {}

function el(props: Partial<React.ComponentProps<typeof CartSummary>> = {}) {
  return React.createElement(CartSummary, {
    totalQty: 2,
    pricing: makePricing(),
    coupon: null,
    onApplyCoupon: noop,
    onRemoveCoupon: noop,
    couponCode: '',
    onCouponCodeChange: noop,
    couponLoading: false,
    couponError: '',
    ...props,
  } as React.ComponentProps<typeof CartSummary>)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Min-order gating
// ─────────────────────────────────────────────────────────────────────────────

describe('CartSummary — min order gating', () => {
  it('shows the real checkout Link when subtotal meets minOrderAmt', () => {
    render(el({ pricing: makePricing({ subtotal: 1000 }), minOrderAmt: 500 }))
    const link = screen.getByText(/proceed to checkout/i).closest('a')
    expect(link).toBeTruthy()
    expect(link?.getAttribute('href')).toBe('/checkout')
  })

  it('shows a disabled button with a warning when subtotal is below minOrderAmt', () => {
    render(el({ pricing: makePricing({ subtotal: 300 }), minOrderAmt: 500 }))
    const btn = screen.getByRole('button', { name: /proceed to checkout/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/minimum order is/i)).toBeTruthy()
  })

  it('does not gate checkout when minOrderAmt is 0 (no minimum configured)', () => {
    render(el({ pricing: makePricing({ subtotal: 1 }), minOrderAmt: 0 }))
    expect(screen.queryByText(/minimum order is/i)).toBeNull()
    const link = screen.getByText(/proceed to checkout/i).closest('a')
    expect(link).toBeTruthy()
  })

  it('calls onCheckout when the real checkout Link is clicked (flushPendingRemovals wiring)', () => {
    const onCheckout = vi.fn()
    render(el({ pricing: makePricing({ subtotal: 1000 }), minOrderAmt: 500, onCheckout }))

    fireEvent.click(screen.getByText(/proceed to checkout/i))
    expect(onCheckout).toHaveBeenCalledTimes(1)
  })

  it('shows the exact amount still needed in the min-order warning', () => {
    render(el({ pricing: makePricing({ subtotal: 300 }), minOrderAmt: 500 }))
    expect(screen.getByText((_, node) => node?.textContent === '₹200')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Coupon input — Enter key race guard (BUG FIX)
// ─────────────────────────────────────────────────────────────────────────────

describe('CartSummary — coupon Enter key guard (BUG FIX)', () => {
  it('calls onApplyCoupon when Enter is pressed and not loading', () => {
    const onApplyCoupon = vi.fn()
    render(el({ couponLoading: false, onApplyCoupon }))
    fireEvent.keyDown(screen.getByPlaceholderText(/welcome50/i), { key: 'Enter' })
    expect(onApplyCoupon).toHaveBeenCalledTimes(1)
  })

  it('does NOT call onApplyCoupon when Enter is pressed while couponLoading is true', () => {
    const onApplyCoupon = vi.fn()
    render(el({ couponLoading: true, onApplyCoupon }))
    fireEvent.keyDown(screen.getByPlaceholderText(/welcome50/i), { key: 'Enter' })
    expect(onApplyCoupon).not.toHaveBeenCalled()
  })

  it('ignores non-Enter keys', () => {
    const onApplyCoupon = vi.fn()
    render(el({ couponLoading: false, onApplyCoupon }))
    fireEvent.keyDown(screen.getByPlaceholderText(/welcome50/i), { key: 'a' })
    expect(onApplyCoupon).not.toHaveBeenCalled()
  })

  it('disables the Apply button while couponLoading is true', () => {
    render(el({ couponLoading: true }))
    expect((screen.getByRole('button', { name: /applying/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Coupon hints — disabled while loading (BUG FIX, race condition)
// ─────────────────────────────────────────────────────────────────────────────

describe('CartSummary — coupon hint pills (BUG FIX)', () => {
  const hints = [{ code: 'WELCOME50', label: 'Flat ₹50 off' }, { code: 'SAVE10', label: '10% off' }]

  it('renders one pill per hint with the correct aria-label', () => {
    render(el({ couponHints: hints }))
    expect(screen.getByRole('button', { name: /apply coupon welcome50: flat ₹50 off/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /apply coupon save10: 10% off/i })).toBeTruthy()
  })

  it('calls onApplyHint with the hint code when clicked', () => {
    const onApplyHint = vi.fn()
    render(el({ couponHints: hints, onApplyHint }))
    fireEvent.click(screen.getByRole('button', { name: /apply coupon welcome50/i }))
    expect(onApplyHint).toHaveBeenCalledWith('WELCOME50')
  })

  it('disables all hint pills while couponLoading is true', () => {
    render(el({ couponHints: hints, couponLoading: true }))
    const pill = screen.getByRole('button', { name: /apply coupon welcome50/i })
    expect((pill as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not render the hints section when hints array is empty', () => {
    render(el({ couponHints: [] }))
    expect(screen.queryByRole('group', { name: /available coupon codes/i })).toBeNull()
  })

  it('does not render hints when a coupon is already applied', () => {
    render(el({
      couponHints: hints,
      coupon: { code: 'SAVE10', discount: 50, type: 'flat' } as AppliedCoupon,
    }))
    expect(screen.queryByRole('group', { name: /available coupon codes/i })).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// aria-invalid / aria-describedby wiring
// ─────────────────────────────────────────────────────────────────────────────

describe('CartSummary — coupon error accessibility wiring', () => {
  it('sets aria-invalid=false and no aria-describedby when there is no error', () => {
    render(el({ couponError: '' }))
    const input = screen.getByLabelText(/coupon code/i)
    expect(input.getAttribute('aria-invalid')).toBe('false')
    expect(input.hasAttribute('aria-describedby')).toBe(false)
  })

  it('sets aria-invalid=true and aria-describedby pointing at the error span when an error is present', () => {
    render(el({ couponError: 'Coupon expired' }))
    const input = screen.getByLabelText(/coupon code/i)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('coupon-code-error')
    expect(document.getElementById('coupon-code-error')?.textContent).toMatch(/coupon expired/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Applied coupon banner
// ─────────────────────────────────────────────────────────────────────────────

describe('CartSummary — applied coupon banner', () => {
  const coupon = { code: 'SAVE10', discount: 50, type: 'flat' } as AppliedCoupon

  it('replaces the input with the applied-coupon banner when a coupon is set', () => {
    render(el({ coupon }))
    expect(screen.queryByLabelText(/coupon code/i)).toBeNull()
    expect(screen.getByText('SAVE10')).toBeTruthy()
  })

  it('calls onRemoveCoupon when the remove button is clicked', () => {
    const onRemoveCoupon = vi.fn()
    render(el({ coupon, onRemoveCoupon }))
    fireEvent.click(screen.getByRole('button', { name: /remove coupon/i }))
    expect(onRemoveCoupon).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Conditional price-breakdown rows
// ─────────────────────────────────────────────────────────────────────────────

describe('CartSummary — conditional price rows', () => {
  it('shows the coupon discount line only when coupon is set AND discount > 0', () => {
    render(el({
      coupon: { code: 'SAVE10', discount: 50, type: 'flat' } as AppliedCoupon,
      pricing: makePricing({ discount: 50 }),
    }))
    expect(screen.getByText(/coupon \(save10\)/i)).toBeTruthy()
  })

  it('hides the coupon discount line when discount is 0 even if a coupon object is set', () => {
    render(el({
      coupon: { code: 'SAVE10', discount: 0, type: 'flat' } as AppliedCoupon,
      pricing: makePricing({ discount: 0 }),
    }))
    expect(screen.queryByText(/coupon \(save10\)/i)).toBeNull()
  })

  it('shows FREE shipping label when isFreeShipping is true', () => {
    render(el({ pricing: makePricing({ isFreeShipping: true }) }))
    expect(screen.getByText(/free/i)).toBeTruthy()
  })

  it('shows a formatted shipping charge when isFreeShipping is false', () => {
    render(el({ pricing: makePricing({ isFreeShipping: false, shipping: 99 }) }))
    expect(screen.getByText(/₹99/)).toBeTruthy()
  })

  it('shows the GST note only when gstTotal > 0', () => {
    render(el({ pricing: makePricing({ gstTotal: 0 }) }))
    expect(screen.queryByText(/prices include gst/i)).toBeNull()
  })

  it('shows the savings pill only when discount > 0', () => {
    render(el({ pricing: makePricing({ discount: 0 }) }))
    expect(screen.queryByText(/saving.*on this order/i)).toBeNull()
  })

  it('shows the savings pill when discount > 0', () => {
    render(el({ pricing: makePricing({ discount: 75 }) }))
    expect(screen.getByText(/saving.*on this order/i)).toBeTruthy()
  })

  it('shows correct singular item count in the subtotal row', () => {
    render(el({ totalQty: 1 }))
    expect(screen.getByText(/subtotal \(1 item\)/i)).toBeTruthy()
  })
})
