/**
 * UpsellSection.test.ts
 *
 * Component-level tests for UpsellSection.tsx — the "Customers Also Buy"
 * grid rendered on the cart page.
 *
 * AUDIT GAP: useCartPage.addedUpsell.test.ts only verifies the `addedUpsell`
 * array produced by the HOOK. UpsellSection's own rendering logic — the
 * shimmer-count persistence ref, the addedSet Set-membership rendering
 * (disabled / "✓" state), the visibleItems slice(0,4) cap, and the
 * loading/error/empty fallback branches — had ZERO direct test coverage.
 *
 * Covered here:
 *   1. [UX FIX] shimmerCount persists the previous successful item count
 *      across a loading transition, instead of always showing 4 shimmers
 *      then jumping to 1-3 real items (layout shift).
 *   2. First load (no prior successful count) defaults to 2 shimmers.
 *   3. shimmerCount is clamped to [1, 4] — never 0, never more than 4.
 *   4. Items beyond the 4th are not rendered (visibleItems = items.slice(0,4)).
 *   5. addedIds correctly marks matching items as disabled / "✓".
 *   6. Loading / error / empty-result branches render the right fallback.
 *   7. Clicking "+ Add" calls onAdd with the correct item; clicking an
 *      already-added (disabled) button does not fire onAdd again.
 *
 * Technique: React.createElement (not JSX) — same constraint and pattern as
 * CartDrawer.itemMemo.test.ts (tsconfig "jsx":"preserve" makes raw JSX in a
 * .ts test file fail to parse under Vitest's transform).
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen, within } from '@testing-library/react'
import React from 'react'
import UpsellSection from '@/components/cart/UpsellSection'
import type { UpsellItem } from '@/types'

// next/image — render as a plain <img>, same pattern as CartDrawer.itemMemo.test.ts
vi.mock('next/image', () => ({
  default: (props: { alt: string; src: string }) =>
    React.createElement('img', { alt: props.alt, src: props.src }),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeUpsell(overrides: Partial<UpsellItem> = {}): UpsellItem {
  return {
    id:           'v1',
    productId:    'p1',
    name:         'Himalayan Honey',
    slug:         'himalayan-honey',
    size:         '500g',
    price:        250,
    mrp:          300,
    emoji:        '🍯',
    image:        null,
    gstRate:      5,
    maxQty:       8,
    badge:        null,
    isOrganic:    true,
    isHimalayan:  true,
    isBestseller: false,
    ...overrides,
  }
}

const baseProps = {
  remainingForFreeShip: 200,
  isFreeShipping:       false,
  freeShipMin:           799,
  onAdd:                 vi.fn(),
}

function el(props: Partial<React.ComponentProps<typeof UpsellSection>>) {
  return React.createElement(UpsellSection, {
    items:    [],
    loading:  false,
    error:    false,
    addedIds: [],
    ...baseProps,
    ...props,
  } as React.ComponentProps<typeof UpsellSection>)
}

beforeEach(() => {
  baseProps.onAdd.mockClear()
})

// ─────────────────────────────────────────────────────────────────────────────
// Loading / error / empty fallback branches
// ─────────────────────────────────────────────────────────────────────────────

describe('UpsellSection — fallback branches', () => {
  it('shows shimmer placeholders while loading', () => {
    const { container } = render(el({ loading: true, items: [] }))
    expect(container.querySelectorAll('[class*="shimmer"]').length).toBeGreaterThan(0)
  })

  it('shows an error message when error=true and not loading', () => {
    render(el({ loading: false, error: true, items: [] }))
    expect(screen.getByText(/couldn.t load suggestions/i)).toBeTruthy()
  })

  it('shows an empty-state message when items is empty and not loading/error', () => {
    render(el({ loading: false, error: false, items: [] }))
    expect(screen.getByText(/all caught up/i)).toBeTruthy()
  })

  it('marks the grid aria-busy=true while loading, false once loaded', () => {
    const { container, rerender } = render(el({ loading: true }))
    const grid = container.querySelector('[aria-label="Customer suggestions"]')
    expect(grid?.getAttribute('aria-busy')).toBe('true')

    rerender(el({ loading: false, items: [makeUpsell()] }))
    const gridAfter = container.querySelector('[aria-label="Customer suggestions"]')
    expect(gridAfter?.getAttribute('aria-busy')).toBe('false')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// [UX FIX] shimmerCount persistence — no jarring 4→1 layout jump
// ─────────────────────────────────────────────────────────────────────────────

describe('UpsellSection — shimmer count persistence (UX FIX)', () => {
  it('defaults to 2 shimmers on the very first load (no prior successful count)', () => {
    const { container } = render(el({ loading: true, items: [] }))
    expect(container.querySelectorAll('[class*="shimmer"]').length).toBe(2)
  })

  it('remembers the last successful item count and uses it for the NEXT loading phase', () => {
    // First load resolves with 3 real items
    const { container, rerender } = render(
      el({ loading: false, items: [makeUpsell({ id: 'a' }), makeUpsell({ id: 'b' }), makeUpsell({ id: 'c' })] }),
    )
    expect(container.querySelectorAll('[class*="item"]:not([class*="title"])').length).toBeGreaterThan(0)

    // Cart contents change -> a new fetch begins (loading=true, items still old until response)
    rerender(el({ loading: true, items: [] }))

    // Shimmer count should now be 3 (the last successful count), NOT the
    // hardcoded default of 4 or the reset-to-2 default.
    expect(container.querySelectorAll('[class*="shimmer"]').length).toBe(3)
  })

  it('clamps shimmerCount to a maximum of 4 even if more items were previously shown', () => {
    // items.slice(0,4) caps visibleItems at 4, so prevCountRef can never
    // exceed 4 in practice — verify the upper clamp holds regardless.
    const fiveItems = ['a', 'b', 'c', 'd', 'e'].map(id => makeUpsell({ id }))
    const { container, rerender } = render(el({ loading: false, items: fiveItems }))

    rerender(el({ loading: true, items: [] }))
    expect(container.querySelectorAll('[class*="shimmer"]').length).toBeLessThanOrEqual(4)
  })

  it('clamps shimmerCount to a minimum of 1 (never renders 0 shimmers while loading)', () => {
    // A successful load with 0 items doesn't update prevCountRef (guard:
    // `visibleItems.length > 0`), so the ref retains its prior value (or the
    // initial default of 2) — shimmerCount must never become 0 while loading.
    const { container, rerender } = render(el({ loading: false, items: [] }))
    rerender(el({ loading: true, items: [] }))
    expect(container.querySelectorAll('[class*="shimmer"]').length).toBeGreaterThanOrEqual(1)
  })

  it('does not update the remembered count on an error response (only successful loads count)', () => {
    // Successful load with 1 item, then error, then loading again — shimmer
    // count should reflect the last SUCCESSFUL count (1), not be corrupted
    // by the error state in between.
    const { container, rerender } = render(el({ loading: false, items: [makeUpsell()] }))
    rerender(el({ loading: false, error: true, items: [] }))
    rerender(el({ loading: true, items: [] }))

    expect(container.querySelectorAll('[class*="shimmer"]').length).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// visibleItems cap (slice(0,4))
// ─────────────────────────────────────────────────────────────────────────────

describe('UpsellSection — item count cap', () => {
  it('renders at most 4 items even when more are supplied', () => {
    const sixItems = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => makeUpsell({ id, name: `Product ${id}` }))
    render(el({ loading: false, items: sixItems }))

    expect(screen.queryByText('Product a')).toBeTruthy()
    expect(screen.queryByText('Product d')).toBeTruthy()
    expect(screen.queryByText('Product e')).toBeNull()
    expect(screen.queryByText('Product f')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// addedIds / addedSet — disabled state and "✓" rendering
// ─────────────────────────────────────────────────────────────────────────────

describe('UpsellSection — addedIds / disabled state', () => {
  it('renders "+ Add" and an enabled button for an item NOT in addedIds', () => {
    render(el({ loading: false, items: [makeUpsell({ id: 'v1' })], addedIds: [] }))
    const btn = screen.getByRole('button', { name: /add himalayan honey to cart/i })
    expect(btn).toBeTruthy()
    expect((btn as HTMLButtonElement).disabled).toBe(false)
    expect(btn.textContent).toContain('+ Add')
  })

  it('renders "✓" and a disabled button for an item that IS in addedIds', () => {
    render(el({ loading: false, items: [makeUpsell({ id: 'v1' })], addedIds: ['v1'] }))
    const btn = screen.getByRole('button', { name: /add himalayan honey to cart/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(btn.textContent).toContain('✓')
  })

  it('only marks the matching item as added, not its siblings', () => {
    render(el({
      loading: false,
      items: [makeUpsell({ id: 'v1', name: 'Honey' }), makeUpsell({ id: 'v2', name: 'Ghee' })],
      addedIds: ['v1'],
    }))
    const honeyBtn = screen.getByRole('button', { name: /add honey to cart/i })
    const gheeBtn  = screen.getByRole('button', { name: /add ghee to cart/i })
    expect((honeyBtn as HTMLButtonElement).disabled).toBe(true)
    expect((gheeBtn  as HTMLButtonElement).disabled).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// onAdd click behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('UpsellSection — onAdd', () => {
  it('calls onAdd with the clicked item when not yet added', () => {
    const item = makeUpsell({ id: 'v1', name: 'Honey' })
    render(el({ loading: false, items: [item], addedIds: [], onAdd: baseProps.onAdd }))

    fireEvent.click(screen.getByRole('button', { name: /add honey to cart/i }))

    expect(baseProps.onAdd).toHaveBeenCalledTimes(1)
    expect(baseProps.onAdd).toHaveBeenCalledWith(item)
  })

  it('does not call onAdd when the button is already disabled (added)', () => {
    const item = makeUpsell({ id: 'v1', name: 'Honey' })
    render(el({ loading: false, items: [item], addedIds: ['v1'], onAdd: baseProps.onAdd }))

    const btn = screen.getByRole('button', { name: /add honey to cart/i })
    fireEvent.click(btn) // disabled buttons don't fire onClick in jsdom either, but verify explicitly

    expect(baseProps.onAdd).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Price display (MRP strikethrough)
// ─────────────────────────────────────────────────────────────────────────────

describe('UpsellSection — price display', () => {
  it('shows a struck-through MRP when mrp > price', () => {
    const { container } = render(el({ loading: false, items: [makeUpsell({ mrp: 300, price: 250 })] }))
    const s = container.querySelector('s')
    expect(s).toBeTruthy()
    expect(s?.getAttribute('aria-label')).toMatch(/was/i)
  })

  it('does not show an MRP strikethrough when mrp equals price', () => {
    const { container } = render(el({ loading: false, items: [makeUpsell({ mrp: 250, price: 250 })] }))
    expect(container.querySelector('s')).toBeNull()
  })
})
