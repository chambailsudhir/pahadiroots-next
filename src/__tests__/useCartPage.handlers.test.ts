/**
 * useCartPage.handlers.test.ts
 *
 * Hook-level tests for useCartPage handlers and derived state NOT already
 * covered by useCartPage.couponRevalidation.test.ts (coupon revalidation
 * effect) or useCartPage.addedUpsell.test.ts (addedUpsell/cartKey).
 *
 * AUDIT GAP closed by this file:
 *   • flushPendingRemovals — [DATA INTEGRITY] the most recently documented
 *     fix in useCartPage.ts. Without it, a user who clicks Remove and
 *     immediately proceeds to checkout within the 4s undo window would have
 *     checkout still include the "removed" item (cartStore.items vs the cart
 *     page's visibleItems desync). Had ZERO test coverage before this file.
 *   • handleRemove / handleUndoRemove — pendingRemovals lifecycle, the actual
 *     item removal after the 4s timer, and the undo-cancels-removal path.
 *   • visibleItems / pricing / totalQty — derived from pendingRemovals, must
 *     exclude pending-removal items from totals immediately (the bug this
 *     was built to fix: "Your Items (2)" vs "Subtotal (3 items)" desync).
 *   • handleQtyChange — calls updateQty, sets/clears qtyAnim.
 *   • handleUpsellAdd — guards against double-adding an item already in cart
 *     (itemVariantIdsRef), maps UpsellItem → CartItem correctly.
 *   • applyCouponCode / handleCoupon / handleApplyHint — manual coupon apply
 *     path: success, error, uppercase normalization (Fix 10), mountedRef
 *     guard against setState after unmount (Fix 13).
 *   • Settings/reviews fetch — DB-driven review overrides vs fallback.
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

const trackUpsellAdded     = vi.fn()
const trackItemRemoved     = vi.fn()
const trackQuantityChanged = vi.fn()
const trackCouponApplied   = vi.fn()
const trackCouponError     = vi.fn()

vi.mock('@/hooks/useCheckoutAnalytics', () => ({
  useCartAnalytics: () => ({
    trackUpsellAdded,
    trackItemRemoved,
    trackQuantityChanged,
    trackCouponApplied,
    trackCouponError,
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

function makeUpsellItem(overrides: Partial<{
  id: string; productId: string; name: string; slug: string; size: string
  price: number; mrp: number; emoji: string | null; image: string | null
  gstRate: number; maxQty: number; badge: string | null
  isOrganic: boolean; isHimalayan: boolean; isBestseller: boolean
}> = {}) {
  return {
    id:           'up-v1',
    productId:    'up-1',
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

function seedStore(
  items: Array<Omit<CartItem, 'qty'> & { qty: number }>,
  coupon: { code: string; discount: number; type: 'flat' | 'percent'; percent?: number } | null = null,
) {
  useCartStore.setState({
    items,
    coupon,
    lastAppliedCouponCode: coupon?.code ?? '',
    _hasHydrated: true,
  })
}

function mockRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response
}

function urlOf(u: RequestInfo | URL): string {
  return u instanceof URL ? u.toString() : typeof u === 'string' ? u : (u as Request).url
}

/** Fetch mock: everything fails (500) by default — override per-route as needed. */
function makeFetchMock(overrides: Record<string, () => Response> = {}) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const u = urlOf(url)
    for (const [path, respond] of Object.entries(overrides)) {
      if (u.includes(path)) return respond()
    }
    return mockRes({}, false, 500)
  }) as unknown as typeof globalThis.fetch
}

beforeEach(() => {
  useCartStore.getState().clearCart()
  useCartStore.setState({ _hasHydrated: true })
  vi.useFakeTimers()
  trackUpsellAdded.mockClear()
  trackItemRemoved.mockClear()
  trackQuantityChanged.mockClear()
  trackCouponApplied.mockClear()
  trackCouponError.mockClear()
  global.fetch = makeFetchMock()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// handleRemove / handleUndoRemove / pendingRemovals lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('useCartPage — handleRemove / handleUndoRemove', () => {
  it('immediately excludes the item from visibleItems but keeps it in the store items array', () => {
    seedStore([
      { ...makeItem({ variantId: 'v1' }), qty: 1 },
      { ...makeItem({ variantId: 'v2' }), qty: 1 },
    ])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleRemove('v1', 'Test Ghee', 100) })

    // visibleItems updates immediately
    expect(result.current.visibleItems.map(i => i.variantId)).toEqual(['v2'])
    // but the underlying store item is still there (undo window)
    expect(useCartStore.getState().items.map(i => i.variantId)).toEqual(['v1', 'v2'])
  })

  it('fires trackItemRemoved analytics immediately on handleRemove', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 1 }])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleRemove('v1', 'Test Ghee', 100) })

    expect(trackItemRemoved).toHaveBeenCalledWith('Test Ghee', 100)
  })

  it('actually removes the item from the store after the 4s undo window elapses', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 1 }])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleRemove('v1', 'Test Ghee', 100) })
    expect(useCartStore.getState().items).toHaveLength(1) // still there mid-window

    act(() => { vi.advanceTimersByTime(4000) })
    expect(useCartStore.getState().items).toHaveLength(0) // gone after timeout
  })

  it('handleUndoRemove cancels the pending removal — item never leaves the store', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 1 }])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleRemove('v1', 'Test Ghee', 100) })
    act(() => { result.current.handleUndoRemove('v1') })

    // Advance well past the original 4s window — item must still be present
    act(() => { vi.advanceTimersByTime(5000) })
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(result.current.visibleItems).toHaveLength(1)
  })

  it('clicking Remove twice on the same item resets the undo timer (no double-remove)', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 1 }])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleRemove('v1', 'Test Ghee', 100) })
    act(() => { vi.advanceTimersByTime(3000) }) // 3s in, 1s left on first timer
    act(() => { result.current.handleRemove('v1', 'Test Ghee', 100) }) // re-click resets timer

    // Original timer would have fired at 4000ms total; we're now at 3000ms
    // elapsed with a FRESH 4000ms timer — advancing only 1500 more ms (4500
    // total) must NOT have removed the item yet, since the new timer needs
    // a full 4000ms from the second click.
    act(() => { vi.advanceTimersByTime(1500) })
    expect(useCartStore.getState().items).toHaveLength(1)

    // Now let the fresh 4s timer fully elapse
    act(() => { vi.advanceTimersByTime(2500) })
    expect(useCartStore.getState().items).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// flushPendingRemovals — DATA INTEGRITY FIX (checkout must match cart page)
// ─────────────────────────────────────────────────────────────────────────────

describe('useCartPage — flushPendingRemovals (DATA INTEGRITY FIX)', () => {
  it('synchronously removes all pending-removal items from the store when called', () => {
    seedStore([
      { ...makeItem({ variantId: 'v1' }), qty: 1 },
      { ...makeItem({ variantId: 'v2' }), qty: 1 },
      { ...makeItem({ variantId: 'v3' }), qty: 1 },
    ])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleRemove('v1', 'Test Ghee', 100) })
    act(() => { result.current.handleRemove('v2', 'Test Ghee', 100) })

    // Before flush: store still has all 3 (undo window active)
    expect(useCartStore.getState().items).toHaveLength(3)

    act(() => { result.current.flushPendingRemovals() })

    // After flush: v1 and v2 are gone from the STORE (not just visibleItems) —
    // exactly what checkout reads. Only v3 (never removed) remains.
    expect(useCartStore.getState().items.map(i => i.variantId)).toEqual(['v3'])
  })

  it('cancels the underlying setTimeout so the deferred removeItem never double-fires', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 1 }])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleRemove('v1', 'Test Ghee', 100) })
    act(() => { result.current.flushPendingRemovals() })

    expect(useCartStore.getState().items).toHaveLength(0)

    // Advancing time past the original 4s window must not throw or do anything
    // unexpected (the timer was cleared by flush, not left to fire independently)
    expect(() => { act(() => { vi.advanceTimersByTime(5000) }) }).not.toThrow()
    expect(useCartStore.getState().items).toHaveLength(0)
  })

  it('is a no-op when there are no pending removals', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 1 }])
    const { result } = renderHook(() => useCartPage())

    expect(() => { act(() => { result.current.flushPendingRemovals() }) }).not.toThrow()
    expect(useCartStore.getState().items).toHaveLength(1)
  })

  it('clears pendingRemovals from the hook state after flushing', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 1 }])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleRemove('v1', 'Test Ghee', 100) })
    expect(result.current.pendingRemovals.size).toBe(1)

    act(() => { result.current.flushPendingRemovals() })
    expect(result.current.pendingRemovals.size).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// visibleItems / pricing / totalQty — desync fix verification
// ─────────────────────────────────────────────────────────────────────────────

describe('useCartPage — visibleItems-derived pricing (no "Your Items (2) / Subtotal (3 items)" desync)', () => {
  it('pricing.subtotal drops immediately when an item is marked for removal (before the 4s timer)', () => {
    seedStore([
      { ...makeItem({ variantId: 'v1', price: 100 }), qty: 1 },
      { ...makeItem({ variantId: 'v2', price: 200 }), qty: 1 },
    ])
    const { result } = renderHook(() => useCartPage())

    expect(result.current.pricing.subtotal).toBe(300)

    act(() => { result.current.handleRemove('v1', 'Test Ghee', 100) })

    // Subtotal must reflect visibleItems (v2 only = 200), not the full store items (still 300)
    expect(result.current.pricing.subtotal).toBe(200)
    // Confirms the desync bug is fixed: store items is unchanged...
    expect(useCartStore.getState().items).toHaveLength(2)
    // ...but the displayed total already dropped.
  })

  it('totalQty matches visibleItems, not the raw store items, during a pending removal', () => {
    seedStore([
      { ...makeItem({ variantId: 'v1' }), qty: 3 },
      { ...makeItem({ variantId: 'v2' }), qty: 2 },
    ])
    const { result } = renderHook(() => useCartPage())

    expect(result.current.totalQty).toBe(5)

    act(() => { result.current.handleRemove('v1', 'Test Ghee', 100) })

    expect(result.current.totalQty).toBe(2) // only v2's qty counted
  })

  it('pricing.subtotal and totalQty revert correctly after Undo', () => {
    seedStore([
      { ...makeItem({ variantId: 'v1', price: 100 }), qty: 2 },
      { ...makeItem({ variantId: 'v2', price: 200 }), qty: 1 },
    ])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleRemove('v1', 'Test Ghee', 100) })
    expect(result.current.pricing.subtotal).toBe(200)

    act(() => { result.current.handleUndoRemove('v1') })
    expect(result.current.pricing.subtotal).toBe(400) // 2*100 + 1*200
    expect(result.current.totalQty).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// handleQtyChange
// ─────────────────────────────────────────────────────────────────────────────

describe('useCartPage — handleQtyChange', () => {
  it('calls updateQty on the store with the new quantity', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 1 }])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleQtyChange('v1', 3, 1) })

    expect(useCartStore.getState().items[0].qty).toBe(3)
  })

  it('fires trackQuantityChanged with old and new qty for the matching item', () => {
    seedStore([{ ...makeItem({ variantId: 'v1', name: 'Test Ghee' }), qty: 1 }])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleQtyChange('v1', 4, 1) })

    expect(trackQuantityChanged).toHaveBeenCalledWith('Test Ghee', 1, 4)
  })

  it('sets qtyAnim to "up" when increasing and clears it after 320ms', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 1 }])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleQtyChange('v1', 3, 1) })
    expect(result.current.qtyAnim.v1).toBe('up')

    act(() => { vi.advanceTimersByTime(320) })
    expect(result.current.qtyAnim.v1).toBeNull()
  })

  it('sets qtyAnim to "down" when decreasing', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 5 }])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleQtyChange('v1', 2, 5) })
    expect(result.current.qtyAnim.v1).toBe('down')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// handleUpsellAdd
// ─────────────────────────────────────────────────────────────────────────────

describe('useCartPage — handleUpsellAdd', () => {
  it('adds an upsell item to the cart with the correct field mapping', () => {
    seedStore([])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleUpsellAdd(makeUpsellItem()) })

    const items = useCartStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      variantId: 'up-v1',
      productId: 'up-1',
      name:      'Himalayan Honey',
      price:     250,
      isOrganic: true,
    })
  })

  it('does nothing when the item is already in the cart (itemVariantIdsRef guard)', () => {
    seedStore([{ ...makeItem({ variantId: 'up-v1' }), qty: 2 }])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleUpsellAdd(makeUpsellItem({ id: 'up-v1' })) })

    // Must still be exactly 1 item with qty 2 — handleUpsellAdd should bail out,
    // NOT call addItem (which would have bumped qty to 3)
    const items = useCartStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].qty).toBe(2)
  })

  it('fires trackUpsellAdded analytics with name and price', () => {
    seedStore([])
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.handleUpsellAdd(makeUpsellItem({ name: 'Pahadi Rajma', price: 180 })) })

    expect(trackUpsellAdded).toHaveBeenCalledWith('Pahadi Rajma', 180)
  })

  it('defaults missing badge flags (isOrganic/isHimalayan/isBestseller) to false', () => {
    seedStore([])
    const { result } = renderHook(() => useCartPage())

    const upsell = makeUpsellItem({ id: 'up-v2' })
    delete (upsell as Partial<typeof upsell>).isOrganic
    delete (upsell as Partial<typeof upsell>).isHimalayan
    delete (upsell as Partial<typeof upsell>).isBestseller

    act(() => { result.current.handleUpsellAdd(upsell as ReturnType<typeof makeUpsellItem>) })

    const item = useCartStore.getState().items[0]
    expect(item.isOrganic).toBe(false)
    expect(item.isHimalayan).toBe(false)
    expect(item.isBestseller).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyCouponCode / handleCoupon / handleApplyHint — manual apply path
// ─────────────────────────────────────────────────────────────────────────────

describe('useCartPage — handleCoupon (manual apply)', () => {
  it('applies a valid coupon and clears the input field on success', async () => {
    seedStore([{ ...makeItem(), qty: 5 }]) // subtotal = 500
    global.fetch = makeFetchMock({
      '/api/v1/coupons': () => mockRes({ coupon: { code: 'SAVE10', discount: 50, type: 'percent', percent: 10 } }),
    })

    const { result } = renderHook(() => useCartPage())
    act(() => { result.current.setCouponCode('save10') })

    await act(async () => { await result.current.handleCoupon() })

    expect(useCartStore.getState().coupon?.code).toBe('SAVE10')
    expect(result.current.couponCode).toBe('')
    expect(result.current.couponError).toBe('')
  })

  it('sends the coupon code uppercased and trimmed to the server', async () => {
    seedStore([{ ...makeItem(), qty: 5 }])
    const fetchMock = makeFetchMock({
      '/api/v1/coupons': () => mockRes({ coupon: { code: 'PAHADI10', discount: 50, type: 'flat' } }),
    })
    global.fetch = fetchMock

    const { result } = renderHook(() => useCartPage())
    act(() => { result.current.setCouponCode('  pahadi10  ') })

    await act(async () => { await result.current.handleCoupon() })

    const couponCall = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.find(
      (args: unknown[]) => urlOf(args[0] as RequestInfo | URL).includes('/api/v1/coupons'),
    )
    const body = JSON.parse((couponCall![1] as RequestInit).body as string)
    expect(body.code).toBe('PAHADI10')
  })

  it('does nothing when the coupon code is blank/whitespace', async () => {
    seedStore([{ ...makeItem(), qty: 5 }])
    const fetchMock = makeFetchMock({ '/api/v1/coupons': () => mockRes({}) })
    global.fetch = fetchMock

    const { result } = renderHook(() => useCartPage())
    act(() => { result.current.setCouponCode('   ') })

    await act(async () => { await result.current.handleCoupon() })

    const couponCalls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: unknown[]) => urlOf(args[0] as RequestInfo | URL).includes('/api/v1/coupons'),
    )
    expect(couponCalls).toHaveLength(0)
  })

  it('surfaces a server error message and fires trackCouponError without applying the coupon', async () => {
    seedStore([{ ...makeItem(), qty: 1 }]) // subtotal = 100
    global.fetch = makeFetchMock({
      '/api/v1/coupons': () => mockRes({ error: 'Minimum order ₹500 required for this coupon' }, false, 400),
    })

    const { result } = renderHook(() => useCartPage())
    act(() => { result.current.setCouponCode('BIGORDER') })

    await act(async () => { await result.current.handleCoupon() })

    expect(useCartStore.getState().coupon).toBeNull()
    expect(result.current.couponError).toMatch(/minimum order/i)
    expect(trackCouponError).toHaveBeenCalled()
  })

  it('surfaces a generic error on network failure', async () => {
    seedStore([{ ...makeItem(), qty: 1 }])
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (urlOf(url).includes('/api/v1/coupons')) throw new Error('Network down')
      return mockRes({}, false, 500)
    }) as unknown as typeof globalThis.fetch

    const { result } = renderHook(() => useCartPage())
    act(() => { result.current.setCouponCode('ANY') })

    await act(async () => { await result.current.handleCoupon() })

    expect(result.current.couponError).toMatch(/failed to apply/i)
    expect(useCartStore.getState().coupon).toBeNull()
  })

  it('sets couponLoading true during the request and false after it resolves', async () => {
    seedStore([{ ...makeItem(), qty: 1 }])
    let resolveFetch!: (v: Response) => void
    global.fetch = vi.fn((url: RequestInfo | URL) => {
      if (urlOf(url).includes('/api/v1/coupons')) {
        return new Promise<Response>(resolve => { resolveFetch = resolve })
      }
      return Promise.resolve(mockRes({}, false, 500))
    }) as unknown as typeof globalThis.fetch

    const { result } = renderHook(() => useCartPage())
    act(() => { result.current.setCouponCode('SLOW') })

    let pending!: Promise<void>
    act(() => { pending = result.current.handleCoupon() })

    expect(result.current.couponLoading).toBe(true)

    await act(async () => {
      resolveFetch(mockRes({ coupon: { code: 'SLOW', discount: 10, type: 'flat' } }))
      await pending
    })

    expect(result.current.couponLoading).toBe(false)
  })
})

describe('useCartPage — handleApplyHint', () => {
  it('uppercases the hint code in both the input field and the request (Fix 10)', async () => {
    seedStore([{ ...makeItem(), qty: 5 }])
    const fetchMock = makeFetchMock({
      '/api/v1/coupons': () => mockRes({ coupon: { code: 'WELCOME10', discount: 50, type: 'flat' } }),
    })
    global.fetch = fetchMock

    const { result } = renderHook(() => useCartPage())

    await act(async () => { result.current.handleApplyHint('welcome10') })

    const couponCall = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.find(
      (args: unknown[]) => urlOf(args[0] as RequestInfo | URL).includes('/api/v1/coupons'),
    )
    const body = JSON.parse((couponCall![1] as RequestInit).body as string)
    expect(body.code).toBe('WELCOME10')
    expect(useCartStore.getState().coupon?.code).toBe('WELCOME10')
  })
})

describe('useCartPage — handleRemoveCoupon', () => {
  it('clears the coupon, input field, and error message', () => {
    seedStore([{ ...makeItem(), qty: 5 }], { code: 'TEST', discount: 50, type: 'flat' })
    const { result } = renderHook(() => useCartPage())

    act(() => { result.current.setCouponCode('TEST') })
    act(() => { result.current.removeCoupon() })

    expect(useCartStore.getState().coupon).toBeNull()
    expect(result.current.couponCode).toBe('')
    expect(result.current.couponError).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// mountedRef guard — no setState after unmount (Fix 11 + Fix 13)
// ─────────────────────────────────────────────────────────────────────────────

describe('useCartPage — mountedRef guard against post-unmount setState', () => {
  it('does not throw or warn when a coupon apply resolves after unmount', async () => {
    seedStore([{ ...makeItem(), qty: 1 }])
    let resolveFetch!: (v: Response) => void
    global.fetch = vi.fn((url: RequestInfo | URL) => {
      if (urlOf(url).includes('/api/v1/coupons')) {
        return new Promise<Response>(resolve => { resolveFetch = resolve })
      }
      return Promise.resolve(mockRes({}, false, 500))
    }) as unknown as typeof globalThis.fetch

    const { result, unmount } = renderHook(() => useCartPage())
    act(() => { result.current.setCouponCode('LATE') })

    let pending!: Promise<void>
    act(() => { pending = result.current.handleCoupon() })

    unmount() // unmount BEFORE the fetch resolves

    await expect(act(async () => {
      resolveFetch(mockRes({ coupon: { code: 'LATE', discount: 10, type: 'flat' } }))
      await pending
    })).resolves.not.toThrow()
  })

  it('does not fire setQtyAnim timeout callback effects after unmount', () => {
    seedStore([{ ...makeItem({ variantId: 'v1' }), qty: 1 }])
    const { result, unmount } = renderHook(() => useCartPage())

    act(() => { result.current.handleQtyChange('v1', 2, 1) })
    unmount()

    // Advancing timers after unmount must not throw (mountedRef guards the callback)
    expect(() => { act(() => { vi.advanceTimersByTime(320) }) }).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Settings + reviews fetch
// ─────────────────────────────────────────────────────────────────────────────

describe('useCartPage — settings/reviews fetch', () => {
  it('uses fallback reviews when the settings fetch fails', async () => {
    seedStore([])
    global.fetch = makeFetchMock() // everything 500s

    const { result } = renderHook(() => useCartPage())
    await act(async () => { await vi.runAllTimersAsync() })

    expect(result.current.reviews.length).toBeGreaterThan(0)
    expect(result.current.reviews[0].name).toBe('Priya M.')
  })

  it('uses DB-driven reviews when settings provide complete review fields', async () => {
    seedStore([])
    global.fetch = makeFetchMock({
      '/api/v1/cart-settings': () => mockRes({
        settings: {
          review_1_name: 'Anjali R.', review_1_location: 'Pune', review_1_text: 'Loved the dal!',
        },
      }),
    })

    const { result } = renderHook(() => useCartPage())
    await act(async () => { await vi.runAllTimersAsync() })

    expect(result.current.reviews.some(r => r.name === 'Anjali R.')).toBe(true)
  })

  it('exposes free_shipping_min via freeShipMin once settings load', async () => {
    seedStore([])
    global.fetch = makeFetchMock({
      '/api/v1/cart-settings': () => mockRes({ settings: { free_shipping_min: '799' } }),
    })

    const { result } = renderHook(() => useCartPage())
    await act(async () => { await vi.runAllTimersAsync() })

    expect(result.current.freeShipMin).toBe(799)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// fetchWithRetry — not exported, so exercised indirectly through the
// cart-settings fetch effect. Covers the BUG FIX: a genuine network-level
// rejection (fetch() throwing, not just resolving with a 5xx) must now be
// retried with the same exponential backoff as a 5xx response.
// ─────────────────────────────────────────────────────────────────────────────

describe('useCartPage — fetchWithRetry retry behavior (BUG FIX: network errors now retried)', () => {
  it('retries after a genuine network-level rejection (fetch() throwing) and succeeds on a later attempt', async () => {
    seedStore([])
    let callCount = 0
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (!urlOf(url).includes('/api/v1/cart-settings')) return mockRes({}, false, 500)
      callCount++
      // First attempt: a real network failure (TypeError, as a browser throws
      // for "Failed to fetch") — NOT an HTTP response, fetch() itself rejects.
      if (callCount === 1) throw new TypeError('Failed to fetch')
      return mockRes({ settings: { free_shipping_min: '799' } })
    }) as unknown as typeof globalThis.fetch

    const { result } = renderHook(() => useCartPage())
    await act(async () => { await vi.runAllTimersAsync() })

    // BEFORE the fix: the network rejection on attempt 1 would propagate
    // immediately, the settings fetch would be treated as failed, and
    // freeShipMin would stay at the 0 fallback. AFTER the fix: attempt 1's
    // rejection is caught and retried, attempt 2 succeeds, and the real
    // value is used.
    expect(callCount).toBeGreaterThanOrEqual(2)
    expect(result.current.freeShipMin).toBe(799)
  })

  it('still retries on a 5xx HTTP response (pre-existing behavior, unaffected by the fix)', async () => {
    seedStore([])
    let callCount = 0
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (!urlOf(url).includes('/api/v1/cart-settings')) return mockRes({}, false, 500)
      callCount++
      if (callCount === 1) return mockRes({}, false, 503)
      return mockRes({ settings: { free_shipping_min: '799' } })
    }) as unknown as typeof globalThis.fetch

    const { result } = renderHook(() => useCartPage())
    await act(async () => { await vi.runAllTimersAsync() })

    expect(callCount).toBe(2)
    expect(result.current.freeShipMin).toBe(799)
  })

  it('does NOT retry on a 4xx response — fails fast with exactly one call', async () => {
    seedStore([])
    let callCount = 0
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (!urlOf(url).includes('/api/v1/cart-settings')) return mockRes({}, false, 500)
      callCount++
      return mockRes({ error: 'bad request' }, false, 400)
    }) as unknown as typeof globalThis.fetch

    const { result } = renderHook(() => useCartPage())
    await act(async () => { await vi.runAllTimersAsync() })

    expect(callCount).toBe(1) // no retry attempts for a 4xx
    expect(result.current.freeShipMin).toBe(0) // falls back to default
  })

  it('gives up after maxRetries consecutive network failures and falls back to defaults', async () => {
    seedStore([])
    let callCount = 0
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (!urlOf(url).includes('/api/v1/cart-settings')) return mockRes({}, false, 500)
      callCount++
      throw new TypeError('Failed to fetch') // always fails
    }) as unknown as typeof globalThis.fetch

    const { result } = renderHook(() => useCartPage())
    await act(async () => { await vi.runAllTimersAsync() })

    // maxRetries=2 -> 1 initial attempt + 2 retries = 3 total calls, then give up
    expect(callCount).toBe(3)
    expect(result.current.freeShipMin).toBe(0)
    expect(result.current.reviews[0].name).toBe('Priya M.') // fallback reviews used
  })
})
