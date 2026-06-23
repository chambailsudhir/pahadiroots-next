/**
 * CartDrawer.itemMemo.test.ts
 *
 * Empirical (not static) verification of the CartDrawerItem memoization fix.
 *
 * Context
 * ───────
 * The cart-performance round extracted each CartDrawer row into its own
 * React.memo'd `CartDrawerItem` (named export). The claim was: with stable
 * `updateQty` / `removeItem` / `closeCart` references and an unchanged `item`
 * object reference, a row's render function does NOT re-execute when ANOTHER
 * row's `item` changes (e.g. a qty +/- on a sibling).
 *
 * Verifying a React.memo bail-out from static reading is reasonable but not
 * proof — this test proves it by observation.
 *
 * Technique
 * ─────────
 * `next/image` is mocked to a plain function component that records how many
 * times it's called, keyed by `alt` (= item.name, unique per row). If
 * CartDrawerItem's render function doesn't run, this mock is never invoked
 * for that row — so the call count is the most direct possible signal of
 * "did this row's render function execute".
 *
 * Note: this file uses React.createElement instead of JSX. The project's
 * tsconfig.json sets `"jsx": "preserve"` (Next.js/SWC does the JSX transform
 * normally), but Vitest's esbuild transform honours that setting for .tsx
 * test files too, so raw JSX in a *test* file fails to parse. createElement
 * avoids JSX syntax entirely without touching the shared vitest config.
 *
 *   1. Same `item` reference + stable callbacks, parent re-renders
 *      → render count must NOT increase (memo bail-out).
 *   2. New `item` reference (qty changed) for the SAME row
 *      → render count MUST increase (this row legitimately changed).
 *   3. Sibling row's `item` reference is untouched while another row updates
 *      → the sibling's render count must NOT increase — this is the actual
 *      bug fixed this round (previously, EVERY row was inline JSX inside
 *      CartDrawer's `items.map`, so any cart mutation re-created every row).
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { CartDrawerItem } from '@/components/cart/CartDrawer'
import type { CartItem } from '@/types'

// CartDrawer.tsx -> pricingService.ts -> @/lib/supabase, which calls
// createClient(...) at module scope using NEXT_PUBLIC_SUPABASE_URL — unset in
// the test environment. Mocked the same way as useCartPage.couponRevalidation.test.ts
// and useCartPage.addedUpsell.test.ts.
vi.mock('@/lib/supabase', () => ({
  supabase:         { from: vi.fn() },
  getServiceClient: vi.fn(() => ({ from: vi.fn() })),
}))

// ─── next/image mock — counts calls per `alt` ─────────────────────────────────
let renderCounts: Record<string, number> = {}

vi.mock('next/image', () => ({
  default: (props: { alt: string; src: string }) => {
    renderCounts[props.alt] = (renderCounts[props.alt] ?? 0) + 1
    return React.createElement('img', { alt: props.alt, src: props.src })
  },
}))

// next/link — render as a plain <a> so the tree doesn't need the router context
vi.mock('next/link', () => ({
  default: ({ children, href, onClick }: { children: React.ReactNode; href: string; onClick?: () => void }) =>
    React.createElement('a', { href, onClick }, children),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    productId:    '1',
    variantId:    'v1',
    name:         'Item A',
    slug:         'item-a',
    image:        'https://example.com/a.jpg',
    emoji:        null,
    size:         '250g',
    price:        100,
    mrp:          120,
    gstRate:      5,
    qty:          1,
    maxQty:       10,
    isOrganic:    false,
    isHimalayan:  true,
    isBestseller: false,
    ...overrides,
  }
}

// Stable callback references — a fresh vi.fn() per render would bust the memo
// on its own, independent of `item`. CartDrawer passes the same Zustand
// action references (updateQty/removeItem) and the same `closeCart` on every
// render, so module-level stable fns here mirror that.
const updateQty  = vi.fn()
const removeItem = vi.fn()
const closeCart  = vi.fn()

beforeEach(() => {
  renderCounts = {}
  updateQty.mockClear()
  removeItem.mockClear()
  closeCart.mockClear()
})

// Mirrors how CartDrawer's `items.map(...)` invokes CartDrawerItem for each
// row, with whatever `item` reference is currently in the `items` array.
function row(item: CartItem) {
  return React.createElement(CartDrawerItem, { item, updateQty, removeItem, closeCart })
}

function twoRows(a: CartItem, b: CartItem) {
  return React.createElement(React.Fragment, null, row(a), row(b))
}

describe('CartDrawerItem — React.memo bail-out (empirical)', () => {

  it('does NOT re-render when the same item reference is passed again', () => {
    const itemA = makeItem()
    const { rerender } = render(row(itemA))
    expect(renderCounts['Item A']).toBe(1)

    // Parent re-renders with the exact same `item` object reference and the
    // same stable callbacks — props are shallow-equal, memo should bail out.
    rerender(row(itemA))
    expect(renderCounts['Item A']).toBe(1)
  })

  it('DOES re-render when this item gets a new reference (its own qty changed)', () => {
    const itemA = makeItem({ qty: 1 })
    const { rerender } = render(row(itemA))
    expect(renderCounts['Item A']).toBe(1)

    const itemA2 = { ...itemA, qty: 2 } // new object, as updateQty's .map() produces
    rerender(row(itemA2))
    expect(renderCounts['Item A']).toBe(2)
  })

  it("a sibling row does NOT re-render when only the OTHER row's item changes", () => {
    const itemA = makeItem({ variantId: 'a', name: 'Item A' })
    const itemB = makeItem({ variantId: 'b', name: 'Item B', qty: 1 })

    const { rerender } = render(twoRows(itemA, itemB))
    expect(renderCounts['Item A']).toBe(1)
    expect(renderCounts['Item B']).toBe(1)

    // Simulate updateQty('b', 2): cartStore's `items.map(i => i.variantId ===
    // 'b' ? {...i, qty: 2} : i)` returns a NEW array where item A keeps its
    // ORIGINAL object reference and item B gets a new one.
    const itemB2 = { ...itemB, qty: 2 }
    rerender(twoRows(itemA, itemB2))

    // Item B's row re-rendered (its data changed)...
    expect(renderCounts['Item B']).toBe(2)
    // ...but Item A's row did NOT — this is the actual fix. Before this
    // round, CartDrawer's items.map produced inline JSX for every row on
    // every render, so Item A's row would also have re-rendered here.
    expect(renderCounts['Item A']).toBe(1)
  })
})
