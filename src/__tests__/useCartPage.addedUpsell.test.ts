/**
 * useCartPage.addedUpsell.test.ts
 *
 * Hook-level tests for `addedUpsell` and its underlying `cartKey` fingerprint.
 *
 * Context
 * ───────
 * `addedUpsell` (the list of cart variantIds passed to UpsellSection as
 * `addedIds`, used to mark "✓ Added" cards) is DERIVED state — Fix 15 made it
 * reflect the live cart contents instead of standalone append-only state.
 *
 * Fix 16 (this round, [PERF]) changed *how* it's derived: previously
 * `items.map(i => i.variantId)`, now `cartKey.split(',')` where `cartKey` is
 * `items.map(i => i.variantId).sort().join(',')`.
 *
 * `items` gets a brand-new array reference on every cart mutation, including
 * pure qty +/- changes (updateQty maps the array to bump one item's qty).
 * Deriving addedUpsell directly from `items` therefore produced a new array
 * on every qty tap — even though the SET of variantIds in the cart hadn't
 * changed — busting UpsellSection's React.memo and re-rendering its whole
 * grid on every +/- click.
 *
 * `cartKey` is memoized to change ONLY when the variantId set changes (an
 * item is added or removed), so `addedUpsell` now keeps the same array
 * reference across qty-only updates.
 *
 * These tests verify:
 *   1. `addedUpsell` correctly reflects which variantIds are in the cart
 *      (still holds after the cartKey-based rewrite).
 *   2. `addedUpsell` is `[]` (not `['']`) for an empty cart — guards against
 *      the `''.split(',') === ['']` footgun.
 *   3. `addedUpsell` keeps the SAME array reference across a qty-only change
 *      (the actual perf fix).
 *   4. `addedUpsell` gets a NEW reference (and updated contents) when an item
 *      is added or removed (variantId set changes).
 *
 * Test environment
 * ───────────────
 * jsdom is required so renderHook / React's scheduler work correctly.
 * Mocks mirror useCartPage.couponRevalidation.test.ts:
 *   • @/lib/supabase   — pricingService imports getServiceClient at module scope
 *   • next/navigation  — useRouter (the hook calls router.replace)
 *   • @/hooks/useCheckoutAnalytics — no-op stubs
 *   • global.fetch     — fails (500) for every endpoint; the hook's try/catch
 *                        handles this gracefully and doesn't affect addedUpsell
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCartStore } from '@/store/cartStore'
import type { CartItem } from '@/types'

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabase:         { from: vi.fn() },
  getServiceClient: vi.fn(() => ({ from: vi.fn() })),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/hooks/useCheckoutAnalytics', () => ({
  useCartAnalytics: () => ({
    trackUpsellAdded:      vi.fn(),
    trackItemRemoved:      vi.fn(),
    trackQuantityChanged:  vi.fn(),
    trackCouponApplied:    vi.fn(),
    trackCouponError:      vi.fn(),
  }),
}))

import { useCartPage } from '@/hooks/useCartPage'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<CartItem> = {}): Omit<CartItem, 'qty'> {
  return {
    productId:    '1',
    variantId:    'v1',
    name:         'Test Ghee',
    slug:         'test-ghee',
    image:        null,
    emoji:        null,
    size:         '250g',
    price:        100,
    mrp:          120,
    gstRate:      5,
    maxQty:       10,
    isOrganic:    false,
    isHimalayan:  true,
    isBestseller: false,
    ...overrides,
  }
}

function seedStore(items: Array<Omit<CartItem, 'qty'> & { qty: number }>) {
  useCartStore.setState({
    items,
    coupon: null,
    lastAppliedCouponCode: '',
    _hasHydrated: true,
  })
}

// Every endpoint fails (500) — the hook's try/catch handles this without
// affecting addedUpsell, which is derived purely from the cart store.
function failingFetch() {
  return vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof globalThis.fetch
}

beforeEach(() => {
  useCartStore.getState().clearCart()
  useCartStore.setState({ _hasHydrated: true })
  vi.useFakeTimers()
  global.fetch = failingFetch()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useCartPage — addedUpsell / cartKey', () => {

  // ── 1. Correctness — reflects live cart contents ──────────────────────────

  it('reflects the variantIds currently in the cart', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 1 }, { ...makeItem({ variantId: 'v2' }), qty: 3 }])

    const { result } = renderHook(() => useCartPage())

    expect([...result.current.addedUpsell].sort()).toEqual(['v1', 'v2'])
  })

  // ── 2. Empty cart → [] , not [''] ──────────────────────────────────────────

  it('is an empty array (not [""]) for an empty cart', () => {
    seedStore([])

    const { result } = renderHook(() => useCartPage())

    expect(result.current.addedUpsell).toEqual([])
  })

  // ── 3. PERF: stable reference across qty-only changes ─────────────────────

  it('keeps the same array reference when only an item quantity changes', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 1 }, { ...makeItem({ variantId: 'v2' }), qty: 1 }])

    const { result, rerender } = renderHook(() => useCartPage())

    const before = result.current.addedUpsell
    expect(before.sort()).toEqual(['v1', 'v2'])

    act(() => { useCartStore.getState().updateQty('v1', 5) })
    rerender()

    const after = result.current.addedUpsell
    // Same variantId SET → cartKey unchanged → same array reference.
    // This is what keeps UpsellSection's React.memo from re-rendering on qty taps.
    expect(after).toBe(before)
    expect(after.sort()).toEqual(['v1', 'v2'])
  })

  // ── 4. New reference + updated contents when the variantId set changes ────

  it('updates (new reference, new contents) when an item is added', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 1 }])

    const { result, rerender } = renderHook(() => useCartPage())

    const before = result.current.addedUpsell
    expect(before).toEqual(['v1'])

    act(() => {
      useCartStore.getState().addItem({ ...makeItem({ variantId: 'v2' }), qty: 1 })
    })
    rerender()

    const after = result.current.addedUpsell
    expect(after).not.toBe(before)
    expect([...after].sort()).toEqual(['v1', 'v2'])
  })

  it('updates (new reference, new contents) when an item is removed', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 1 }, { ...makeItem({ variantId: 'v2' }), qty: 1 }])

    const { result, rerender } = renderHook(() => useCartPage())

    const before = result.current.addedUpsell
    expect(before.sort()).toEqual(['v1', 'v2'])

    act(() => { useCartStore.getState().removeItem('v1') })
    rerender()

    const after = result.current.addedUpsell
    expect(after).not.toBe(before)
    expect(after).toEqual(['v2'])
  })
})
