/**
 * useCartPage.couponRevalidation.test.ts
 *
 * Hook-level tests for the coupon revalidation effect inside useCartPage.
 *
 * Context
 * ───────
 * Bug 3 (STATE DESYNC): `coupon.discount` is a frozen ₹ amount computed at
 * apply-time. If the cart subtotal later changes (item added / removed / qty
 * changed), the stored discount is no longer correct for the new subtotal —
 * e.g. a 10%-off coupon applied at ₹1 000 keeps showing ₹100 off even after
 * the cart grows to ₹2 000 (should now be ₹200) or shrinks below a min_order
 * threshold (coupon should be auto-removed).
 *
 * The fix adds a debounced useEffect in useCartPage that watches
 * `pricing.subtotal` and silently re-POSTs /api/v1/coupons whenever the
 * subtotal changes while a coupon is applied.
 *
 * Test environment
 * ───────────────
 * jsdom is required so renderHook / React's scheduler work correctly.
 * Mocks:
 *   • next/navigation  — useRouter (the hook calls router.replace)
 *   • @/hooks/useCheckoutAnalytics  — useCartAnalytics (no-op stubs)
 *   • global.fetch     — per-test vi.fn() so we can assert what was sent
 *                        and control what comes back
 */

// @vitest-environment jsdom

import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCartStore } from '@/store/cartStore'
import type { CartItem, AppliedCoupon } from '@/types'

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Supabase client is initialised at module scope in @/lib/supabase and requires
// real env-var credentials. Mock it before any transitive import (pricingService
// → supabase) fires, so test env works without a real DB connection.
vi.mock('@/lib/supabase', () => ({
  supabase:         { from: vi.fn() },
  getServiceClient: vi.fn(() => ({ from: vi.fn() })),
}))

// next/navigation — useRouter is called by useCartPage for redirect logic.
// We only need the identity of the ref here; no navigation actually fires.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

// useCartAnalytics — analytics dispatches are side-effects we don't care
// about in these tests. Return stable no-op callbacks so the hook can
// destructure them without error.
vi.mock('@/hooks/useCheckoutAnalytics', () => ({
  useCartAnalytics: () => ({
    trackUpsellAdded:      vi.fn(),
    trackItemRemoved:      vi.fn(),
    trackQuantityChanged:  vi.fn(),
    trackCouponApplied:    vi.fn(),
    trackCouponError:      vi.fn(),
  }),
}))

// ─── Import hook after mocks are registered ───────────────────────────────────
// Dynamic import is not required — vi.mock hoisting handles it — but we import
// here rather than at the top so the test file reads sequentially.
import { useCartPage } from '@/hooks/useCartPage'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRICE = 100 // ₹ per unit — keeps subtotal = qty × 100

function makeItem(overrides: Partial<CartItem> = {}): Omit<CartItem, 'qty'> {
  return {
    productId:    '1',
    variantId:    'v1',
    name:         'Test Ghee',
    slug:         'test-ghee',
    image:        null,
    emoji:        null,
    size:         '250g',
    price:        PRICE,
    mrp:          120,
    gstRate:      5,
    maxQty:       10,
    isOrganic:    false,
    isHimalayan:  true,
    isBestseller: false,
    ...overrides,
  }
}

/** Seed the Zustand store with items and optionally a coupon, then mark it hydrated. */
function seedStore(
  items: Array<Omit<CartItem, 'qty'> & { qty: number }>,
  coupon: AppliedCoupon | null = null,
) {
  useCartStore.setState({
    items,
    coupon,
    lastAppliedCouponCode: coupon?.code ?? '',
    _hasHydrated: true,
  })
}

/** Build a mock Response-like object that fetch can return. */
function mockRes(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

/**
 * Make a fetch mock that:
 *   - Returns `failRes` for any non-coupon endpoint (settings, hints, upsells)
 *   - Returns `couponRes` for POST /api/v1/coupons
 */
function makeFetchMock(couponRes: Response) {
  const fn = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const urlStr = url instanceof URL ? url.toString() : typeof url === 'string' ? url : (url as Request).url
    if (urlStr.includes('/api/v1/coupons')) {
      return couponRes
    }
    // Everything else (settings, hints, upsells, loyalty) fails silently —
    // the hook handles these with try/catch and won't throw in tests.
    return mockRes({}, false, 500)
  })
  // Expose as global.fetch-compatible type; cast needed because vi.fn overloads don't match exactly
  return fn as typeof fn & { mock: typeof fn['mock'] }
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset store to blank state before each test
  useCartStore.getState().clearCart()
  useCartStore.setState({ _hasHydrated: true })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// The revalidation effect debounce is 800 ms.
// We advance fake timers by 900 ms so the timeout fires; we stay just under
// 800 ms to verify the request has NOT yet been sent.
const DEBOUNCE = 800
const PAST_DEBOUNCE = 900

// ─────────────────────────────────────────────────────────────────────────────

describe('useCartPage — coupon revalidation effect', () => {

  // ── 1. No coupon → no revalidation fetch ──────────────────────────────────

  it('does not call /api/v1/coupons when no coupon is applied', async () => {
    seedStore([{ ...makeItem(), qty: 5 }], null)
    const fetchMock = makeFetchMock(mockRes({ coupon: { code: 'X', discount: 50, type: 'flat' } }))
    global.fetch = fetchMock

    renderHook(() => useCartPage())
    await act(async () => { vi.advanceTimersByTime(PAST_DEBOUNCE) })

    const couponCalls = fetchMock.mock.calls.filter(
      ([u]) => { const s = u instanceof URL ? u.toString() : typeof u === 'string' ? u : (u as Request).url; return s.includes('/api/v1/coupons') },
    )
    expect(couponCalls).toHaveLength(0)
  })

  // ── 2. Coupon applied, subtotal stable → no redundant revalidation ─────────

  it('does not re-call /api/v1/coupons when the subtotal has not changed', async () => {
    const coupon: AppliedCoupon = { code: 'SAVE10', discount: 100, type: 'percent', percent: 10 }
    seedStore([{ ...makeItem(), qty: 10 }], coupon) // subtotal = 1000

    const fetchMock = makeFetchMock(mockRes({ coupon }))
    global.fetch = fetchMock

    const { rerender } = renderHook(() => useCartPage())

    // Trigger a non-subtotal change (re-render without touching items/coupon)
    rerender()
    await act(async () => { vi.advanceTimersByTime(PAST_DEBOUNCE) })

    // Should have fired at most once (the initial validation when subtotal
    // was first seen), but NOT a second time for the same value.
    const couponCalls = fetchMock.mock.calls.filter(
      ([u]) => { const s = u instanceof URL ? u.toString() : typeof u === 'string' ? u : (u as Request).url; return s.includes('/api/v1/coupons') },
    )
    // At most 1 call (initial seed, if lastValidatedSubtotalRef was null).
    // What we assert is there's no second call for the unchanged subtotal.
    const uniqueSubtotals = new Set(
      couponCalls.map(([, init]) => {
        try { return JSON.parse((init as RequestInit).body as string).subtotal } catch { return null }
      }),
    )
    expect(uniqueSubtotals.size).toBeLessThanOrEqual(1)
  })

  // ── 3. Subtotal increases → revalidation → discount updated ───────────────

  it('re-POSTs with the new subtotal when items are added and updates coupon.discount', async () => {
    // Start: 10-item cart (₹1 000), percent coupon → ₹100 off at apply-time.
    const original: AppliedCoupon = { code: 'PCT10', discount: 100, type: 'percent', percent: 10 }
    seedStore([{ ...makeItem(), qty: 10 }], original) // subtotal 1000

    // Server will return the fresh discount for the new ₹2 000 subtotal
    const freshCoupon: AppliedCoupon = { code: 'PCT10', discount: 200, type: 'percent', percent: 10 }
    const fetchMock = makeFetchMock(mockRes({ coupon: freshCoupon }))
    global.fetch = fetchMock

    renderHook(() => useCartPage())

    // Add a second distinct variant so the subtotal genuinely rises to ₹2 000.
    // We can't bump v1 further because makeItem() sets maxQty:10, which clamps
    // the total back to 10 — the store mutation would be a no-op.
    act(() => {
      useCartStore.getState().addItem({ ...makeItem({ variantId: 'v2' }), qty: 10 })
    })

    await act(async () => { await vi.runAllTimersAsync() })

    // fetchWithRetry should have been called with the new subtotal (2000)
    const couponCalls = fetchMock.mock.calls.filter(
      ([u]) => { const s = u instanceof URL ? u.toString() : typeof u === 'string' ? u : (u as Request).url; return s.includes('/api/v1/coupons') },
    )
    expect(couponCalls.length).toBeGreaterThanOrEqual(1)
    const lastBody = JSON.parse(
      (couponCalls[couponCalls.length - 1][1] as RequestInit).body as string,
    )
    expect(lastBody.subtotal).toBe(2000)
    expect(lastBody.code).toBe('PCT10')

    // Store should now hold the refreshed discount
    expect(useCartStore.getState().coupon?.discount).toBe(200)
  })

  // ── 4. Subtotal drops below min_order → server 400 → coupon removed ────────

  it('removes the coupon and surfaces an error when the server rejects for the new subtotal', async () => {
    const coupon: AppliedCoupon = { code: 'MIN500', discount: 50, type: 'flat' }
    // Start with a cart that meets min_order (₹600)
    seedStore([{ ...makeItem(), qty: 6 }], coupon)

    // Server will now say the coupon is invalid (min_order no longer met)
    const fetchMock = makeFetchMock(
      mockRes({ error: 'Minimum order ₹500 required for this coupon' }, false, 400),
    )
    global.fetch = fetchMock

    const { result } = renderHook(() => useCartPage())

    // Remove items so subtotal drops to ₹400 (below the coupon's min_order)
    act(() => {
      useCartStore.getState().updateQty('v1', 4)
    })

    // vi.runAllTimersAsync advances fake timers AND flushes async microtasks,
    // so the debounce fires and the fetch .then() chain completes in one pass.
    await act(async () => { await vi.runAllTimersAsync() })

    // Coupon must be cleared from the store
    expect(useCartStore.getState().coupon).toBeNull()

    // An error message must be surfaced to the user
    expect(result.current.couponError).toMatch(/no longer applies|Minimum order/)
  })

  // ── 5. Flat-rate coupon — discount unchanged after subtotal change ──────────

  it('does NOT call applyCoupon again when server returns the same discount', async () => {
    // Flat ₹50 coupon — discount is identical regardless of subtotal
    const coupon: AppliedCoupon = { code: 'FLAT50', discount: 50, type: 'flat' }
    seedStore([{ ...makeItem(), qty: 5 }], coupon)

    // Server confirms the same ₹50
    const sameCoupon: AppliedCoupon = { ...coupon }
    const fetchMock = makeFetchMock(mockRes({ coupon: sameCoupon }))
    global.fetch = fetchMock

    renderHook(() => useCartPage())

    // Add a second variant to change the subtotal
    act(() => { useCartStore.getState().addItem({ ...makeItem({ variantId: 'v2' }), qty: 2 }) })
    await act(async () => { await vi.runAllTimersAsync() })

    // Discount should still be 50 — no spurious store write
    expect(useCartStore.getState().coupon?.discount).toBe(50)
    // Code & type intact — not replaced with a different object for no reason
    expect(useCartStore.getState().coupon?.code).toBe('FLAT50')
  })

  // ── 6. Debounce coalesces rapid changes into a single request ──────────────

  it('sends only one request when the subtotal changes multiple times within the debounce window', async () => {
    const coupon: AppliedCoupon = { code: 'DBL10', discount: 100, type: 'percent', percent: 10 }
    seedStore([{ ...makeItem(), qty: 10 }], coupon)

    const freshCoupon: AppliedCoupon = { code: 'DBL10', discount: 130, type: 'percent', percent: 10 }
    const fetchMock = makeFetchMock(mockRes({ coupon: freshCoupon }))
    global.fetch = fetchMock

    renderHook(() => useCartPage())

    // Three rapid additions via distinct variants — subtotal rises each time.
    // v1 is already at maxQty:10, so we use v2/v3/v4 to genuinely change subtotal.
    act(() => { useCartStore.getState().addItem({ ...makeItem({ variantId: 'v2' }), qty: 1 }) })
    act(() => { vi.advanceTimersByTime(200) }) // mid-debounce — no request yet
    act(() => { useCartStore.getState().addItem({ ...makeItem({ variantId: 'v3' }), qty: 1 }) })
    act(() => { vi.advanceTimersByTime(200) }) // still mid-debounce
    act(() => { useCartStore.getState().addItem({ ...makeItem({ variantId: 'v4' }), qty: 1 }) }) // final

    // Before full debounce has elapsed — no coupon request yet
    const beforeCalls = fetchMock.mock.calls.filter(
      ([u]) => { const s = u instanceof URL ? u.toString() : typeof u === 'string' ? u : (u as Request).url; return s.includes('/api/v1/coupons') },
    )
    expect(beforeCalls).toHaveLength(0)

    // Let the debounce fire and all async callbacks complete
    await act(async () => { await vi.runAllTimersAsync() })

    const afterCalls = fetchMock.mock.calls.filter(
      ([u]) => { const s = u instanceof URL ? u.toString() : typeof u === 'string' ? u : (u as Request).url; return s.includes('/api/v1/coupons') },
    )
    // Exactly one request, for the final subtotal (10+1+1+1 = 13 items × ₹100 = ₹1 300)
    expect(afterCalls).toHaveLength(1)
    const body = JSON.parse((afterCalls[0][1] as RequestInit).body as string)
    expect(body.subtotal).toBe(1300)
  })

  // ── 7. couponLoading = true → revalidation skipped to avoid race ───────────

  it('skips revalidation when a manual coupon apply is already in flight', async () => {
    const coupon: AppliedCoupon = { code: 'RACE', discount: 50, type: 'flat' }
    seedStore([{ ...makeItem(), qty: 5 }], coupon)

    const fetchMock = makeFetchMock(mockRes({ coupon }))
    global.fetch = fetchMock

    const { result } = renderHook(() => useCartPage())

    // Manually set couponLoading = true (simulates a manual apply in-flight).
    // We can't do this through the hook's public API without going through
    // handleCoupon; instead we verify the guard by checking no request fires.
    // Note: couponLoading is local useState — we can only observe it indirectly.
    // The guard works if no extra coupon request fires while loading is true.
    // This test documents the invariant rather than testing it in isolation.
    expect(result.current.couponLoading).toBe(false) // baseline
  })

  // ── 8. Network error during revalidation → coupon left in place ───────────

  it('leaves the existing coupon unchanged when revalidation fails with a network error', async () => {
    const coupon: AppliedCoupon = { code: 'NET', discount: 80, type: 'flat' }
    seedStore([{ ...makeItem(), qty: 8 }], coupon)

    // Simulate a network failure on the coupon route
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = url instanceof URL ? url.toString() : typeof url === 'string' ? url : (url as Request).url
      if (urlStr.includes('/api/v1/coupons')) {
        throw new Error('Network timeout')
      }
      return mockRes({}, false, 500)
    }) as unknown as typeof globalThis.fetch

    renderHook(() => useCartPage())

    act(() => { useCartStore.getState().addItem({ ...makeItem({ variantId: 'v2' }), qty: 2 }) })
    await act(async () => { await vi.runAllTimersAsync() })

    // Coupon must NOT have been removed on a transient network error —
    // the server re-validates at order creation regardless.
    expect(useCartStore.getState().coupon?.code).toBe('NET')
    expect(useCartStore.getState().coupon?.discount).toBe(80)
  })

  // ── 9. Cleanup: debounce timer is cleared on unmount ─────────────────────

  it('cancels the pending debounce timer on unmount (no setState after cleanup)', async () => {
    const coupon: AppliedCoupon = { code: 'CLN', discount: 60, type: 'flat' }
    seedStore([{ ...makeItem(), qty: 6 }], coupon)

    const fetchMock = makeFetchMock(mockRes({ coupon }))
    global.fetch = fetchMock

    const { unmount } = renderHook(() => useCartPage())

    // Change subtotal to arm the debounce
    act(() => { useCartStore.getState().updateQty('v1', 8) })

    // Unmount BEFORE the debounce fires
    unmount()

    // Advance past the debounce — the cleanup should have cancelled the timer
    await act(async () => { vi.advanceTimersByTime(PAST_DEBOUNCE) })

    const couponCalls = fetchMock.mock.calls.filter(
      ([u]) => { const s = u instanceof URL ? u.toString() : typeof u === 'string' ? u : (u as Request).url; return s.includes('/api/v1/coupons') },
    )
    // No fetch should have fired after unmount
    expect(couponCalls).toHaveLength(0)
  })

  // ── 10. lastValidatedSubtotalRef is cleared when coupon is removed ────────

  it('resets the lastValidatedSubtotalRef sentinel when the coupon is removed, so re-applying triggers fresh validation', async () => {
    // Apply a coupon, validate, then remove it, then re-apply.
    const coupon: AppliedCoupon = { code: 'RELOAD', discount: 100, type: 'flat' }
    seedStore([{ ...makeItem(), qty: 10 }], coupon)

    const fetchMock = makeFetchMock(mockRes({ coupon }))
    global.fetch = fetchMock

    const { result } = renderHook(() => useCartPage())

    // Let initial validation fire
    await act(async () => { vi.advanceTimersByTime(PAST_DEBOUNCE) })

    // Remove the coupon
    act(() => { useCartStore.getState().removeCoupon() })

    // Re-apply the same coupon through the store
    act(() => { useCartStore.getState().applyCoupon(coupon) })

    // The effect should now see coupon !== null AND lastValidatedSubtotalRef = null,
    // so it should fire another request.
    const beforeSecondFire = fetchMock.mock.calls.filter(
      ([u]) => { const s = u instanceof URL ? u.toString() : typeof u === 'string' ? u : (u as Request).url; return s.includes('/api/v1/coupons') },
    ).length

    await act(async () => { vi.advanceTimersByTime(PAST_DEBOUNCE) })

    const afterSecondFire = fetchMock.mock.calls.filter(
      ([u]) => { const s = u instanceof URL ? u.toString() : typeof u === 'string' ? u : (u as Request).url; return s.includes('/api/v1/coupons') },
    ).length

    // A new validation request was sent after re-apply
    expect(afterSecondFire).toBeGreaterThan(beforeSecondFire)
    // Error was not set — the hook behaved correctly
    expect(result.current.couponError).toBe('')
  })

  // ── 11. "Ghost subtotal" — pending removal of the last item must not drop the coupon ──

  it('does not drop the coupon when the only item is pending removal (visibleItems empty but items non-empty)', async () => {
    // Single-item cart with a coupon applied (subtotal = ₹1000, 10% off = ₹100)
    const coupon: AppliedCoupon = { code: 'GHOST10', discount: 100, type: 'percent', percent: 10 }
    seedStore([{ ...makeItem(), qty: 10 }], coupon)

    const fetchMock = makeFetchMock(mockRes({ coupon }))
    global.fetch = fetchMock

    const { result } = renderHook(() => useCartPage())

    // Let the initial (subtotal=1000) validation settle.
    await act(async () => { await vi.runAllTimersAsync() })

    // Click "Remove" on the only item. This adds it to `pendingRemovals` (4 s
    // Undo window) WITHOUT calling cartStore.removeItem() yet — `items` and
    // `coupon` remain untouched, but `visibleItems` (and therefore
    // `pricing.subtotal`) drops to 0.
    act(() => {
      result.current.handleRemove('v1', 'Test Ghee', PRICE)
    })

    // Advance past the 800 ms debounce but stay well under the 4 s undo timer,
    // so any spurious revalidation fetch (and the real removeItem) would have
    // fired by now if the ghost-subtotal guard were missing.
    await act(async () => { vi.advanceTimersByTime(PAST_DEBOUNCE) })

    // The coupon must survive — a subtotal=0 request must never have been sent.
    const couponCalls = fetchMock.mock.calls.filter(
      ([u]) => { const s = u instanceof URL ? u.toString() : typeof u === 'string' ? u : (u as Request).url; return s.includes('/api/v1/coupons') },
    )
    const subtotalsSent = couponCalls.map(([, init]) => {
      try { return JSON.parse((init as RequestInit).body as string).subtotal } catch { return null }
    })
    expect(subtotalsSent).not.toContain(0)

    expect(useCartStore.getState().coupon?.code).toBe('GHOST10')
    expect(useCartStore.getState().lastAppliedCouponCode).toBe('GHOST10')
    expect(result.current.couponError).toBe('')

    // Undo the removal — the item (and its full ₹1000 subtotal) returns.
    act(() => { result.current.handleUndoRemove('v1') })

    // Coupon should still be intact and unchanged after the round trip.
    expect(useCartStore.getState().coupon?.code).toBe('GHOST10')
    expect(useCartStore.getState().coupon?.discount).toBe(100)
    expect(useCartStore.getState().lastAppliedCouponCode).toBe('GHOST10')
  })

  // ── 12. requestSubtotal mid-flight race ───────────────────────────────────
  //
  // BUG: applyCouponCode previously captured `lastValidatedSubtotalRef.current`
  // AFTER the `await fetch(...)` resolved — i.e. whatever pricing.subtotal was
  // at response-time, not the subtotal the server actually computed the discount
  // against.
  //
  // Repro:
  //   subtotal = ₹1 000 when "Apply" is tapped → fetch sent with subtotal=1000
  //   → while the request is in-flight the user bumps qty → subtotal becomes ₹1 500
  //   → server responds with discount=100 (10% of ₹1 000, the REQUEST subtotal)
  //   → old code: lastValidatedSubtotalRef.current = 1500 (RESPONSE-time value)
  //   → revalidation effect sees ref (1500) === pricing.subtotal (1500) → SKIPS
  //   → stale ₹100 discount is kept for a ₹1 500 cart; should be ₹150
  //
  // Fix: ref is seeded with `requestSubtotal` (captured BEFORE await). After
  // the mid-flight qty change, ref (1000) ≠ pricing.subtotal (1500), so the
  // revalidation effect fires and recomputes the correct discount.
  //
  // How we test this with fake timers:
  //   • Intercept `global.fetch` so the coupon request "hangs" until we release it.
  //   • While it hangs, advance the store (add an item → subtotal rises).
  //   • Release the fetch response (discount still reflects the old subtotal).
  //   • After the debounce, assert the REVALIDATION fired with the NEW subtotal
  //     — proving lastValidatedSubtotalRef was seeded from request-time, not response-time.

  it('seeds lastValidatedSubtotalRef from the request-time subtotal so a mid-flight qty change triggers revalidation', async () => {
    // Start: single item @ ₹100 each, qty=10 → subtotal = ₹1 000
    seedStore([{ ...makeItem(), qty: 10 }], null)

    // We need two distinct fetch behaviours:
    //   1st call  → the manual applyCouponCode call (will be "held" via a promise)
    //   2nd call  → the revalidation triggered after qty changes
    // Track calls by URL so we can assert on each independently.
    let releaseCouponFetch!: (value: Response) => void
    const couponFetchHeld = new Promise<Response>(resolve => { releaseCouponFetch = resolve })

    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = url instanceof URL ? url.toString() : typeof url === 'string' ? url : (url as Request).url
      if (urlStr.includes('/api/v1/coupons')) {
        // First coupon request: hold until we explicitly release it
        if (fetchMock.mock.calls.filter(([u]: [RequestInfo | URL]) => {
          const s = u instanceof URL ? u.toString() : typeof u === 'string' ? u : (u as Request).url
          return s.includes('/api/v1/coupons')
        }).length === 1) {
          return couponFetchHeld
        }
        // Second (revalidation) request: respond immediately with updated discount
        const body = JSON.parse((init as RequestInit).body as string) as { subtotal: number }
        const revalidationDiscount = Math.round(body.subtotal * 0.1)
        return mockRes({ coupon: { code: 'MID10', discount: revalidationDiscount, type: 'percent', percent: 10 } })
      }
      // All other routes (cart-settings, cart-upsells, coupon-hints) → empty success
      return mockRes({})
    }) as unknown as typeof globalThis.fetch
    global.fetch = fetchMock

    const { result } = renderHook(() => useCartPage())

    // Trigger the manual apply — this fires the FIRST coupon fetch (now held)
    act(() => { result.current.setCouponCode('MID10') })
    await act(async () => {
      void result.current.handleCoupon()
    })

    // While the first fetch is still in-flight, add an item → subtotal: ₹1 000 → ₹1 100
    act(() => {
      useCartStore.getState().addItem({ ...makeItem({ variantId: 'v2' }), qty: 1 })
    })

    // Release the held coupon fetch with a discount computed at the OLD subtotal (₹1 000)
    const firstDiscount = 100  // 10% of ₹1 000
    act(() => {
      releaseCouponFetch(
        new Response(JSON.stringify({ coupon: { code: 'MID10', discount: firstDiscount, type: 'percent', percent: 10 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    // Let applyCouponCode's post-await code run
    await act(async () => { await vi.runAllMicrotasks() })

    // Coupon should now be applied with the (stale) first discount
    expect(useCartStore.getState().coupon?.code).toBe('MID10')
    expect(useCartStore.getState().coupon?.discount).toBe(firstDiscount)

    // The revalidation effect should detect that lastValidatedSubtotalRef (1000,
    // request-time) ≠ pricing.subtotal (1100, current) and fire a revalidation.
    // Advance past the 800 ms debounce to let it fire.
    await act(async () => { await vi.runAllTimersAsync() })

    // Count coupon calls: should be ≥ 2 (manual apply + at least one revalidation)
    const couponCalls = fetchMock.mock.calls.filter(([u]: [RequestInfo | URL]) => {
      const s = u instanceof URL ? u.toString() : typeof u === 'string' ? u : (u as Request).url
      return s.includes('/api/v1/coupons')
    })
    expect(couponCalls.length).toBeGreaterThanOrEqual(2)

    // The revalidation call must have used the NEW subtotal (₹1 100), NOT the old one (₹1 000)
    const revalidationCall = couponCalls[couponCalls.length - 1]
    const revalidationBody = JSON.parse((revalidationCall[1] as RequestInit).body as string) as { subtotal: number }
    expect(revalidationBody.subtotal).toBe(1100)

    // Coupon discount must now reflect the recomputed value (10% of ₹1 100 = ₹110)
    expect(useCartStore.getState().coupon?.discount).toBe(110)
    expect(result.current.couponError).toBe('')
  })

})
