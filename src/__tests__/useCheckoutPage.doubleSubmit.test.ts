/**
 * useCheckoutPage.doubleSubmit.test.ts
 *
 * Regression test for a bug found live via production Vercel logs: two
 * customer-visible "place order" CTAs on the checkout page (OrderSummary's
 * inline "Place COD Order" button and CheckoutClient's mobile sticky-bar
 * "Place Order →" button) are both wired directly to the same handlePlace(),
 * with no shared disabled-state check between them. `placing` (React state)
 * was the only guard, and state updates are asynchronous — two calls to
 * handlePlace in the same synchronous tick (both CTAs firing near-
 * simultaneously, or a plain fast double-click on one button before it
 * visually disables) would both read the pre-update `placing` value and both
 * proceed to fire a real POST /api/v1/orders.
 *
 * This was invisible for months because the order API's own idempotency key
 * silently deduped the resulting double order row at the database level —
 * but the per-phone rate limiter (3 requests / 60s, see rateLimitKv.ts) runs
 * BEFORE that dedup logic and counts each HTTP attempt separately. Once a
 * real, working rate limiter was in place (this same debugging session),
 * customers started seeing "Too many requests" on what was, from their
 * perspective, a single legitimate checkout click.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCheckoutPage } from '@/hooks/useCheckoutPage'
import { useCartStore } from '@/store/cartStore'
import { useUserStore } from '@/store/userStore'
import type { SiteSettings, CartItem } from '@/types'

vi.mock('@/lib/supabase', () => ({
  supabase:         { from: vi.fn() },
  getServiceClient: vi.fn(() => ({ from: vi.fn() })),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/hooks/useCheckoutAnalytics', () => ({
  useCheckoutAnalytics: () => ({
    trackCheckoutStarted: vi.fn(), trackAddressSubmitted: vi.fn(),
    trackPaymentMethodSelected: vi.fn(), trackOrderPlaced: vi.fn(),
    trackCouponApplied: vi.fn(), trackCouponError: vi.fn(),
    trackLoyaltyApplied: vi.fn(), trackPaymentFailed: vi.fn(),
  }),
}))
vi.mock('@/lib/profileCache', () => ({
  readProfileCache:  () => null,
  writeProfileCache: vi.fn(),
}))

const settings = { codEnabled: true, razorpayEnabled: true } as unknown as SiteSettings

const sampleItem: CartItem = {
  productId: 'p1', variantId: 'v1', name: 'Cold Pressed Mustard Oil',
  slug: 'mustard-oil', price: 143, mrp: 150, qty: 1, image: null,
  size: '500ml', maxQty: 10, gstRate: 5,
} as CartItem

function fillValidAddress(result: { current: ReturnType<typeof useCheckoutPage> }) {
  act(() => {
    result.current.setAddrField('name', 'Test User')
    result.current.setAddrField('phone', '9876543210')
    result.current.setAddrField('flat', 'Flat 4, Test Building')
    result.current.setAddrField('city', 'Dehradun')
    result.current.setAddrField('state', 'Uttarakhand')
    result.current.setAddrField('pincode', '248001')
  })
}

// The hook fires its own background calls on mount (/api/profile,
// /api/v1/coupon-hints) through the same mocked global fetch — count only
// the order-placement calls we actually care about here.
function ordersCallCount(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(call => call[0] === '/api/v1/orders').length
}

// A controllable promise — resolves on demand rather than hanging forever,
// so we can precisely simulate "request still in flight" without leaving a
// dangling unresolved promise across test boundaries (which was corrupting
// subsequent tests in this file).
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

describe('useCheckoutPage — double-submission guard on handlePlace', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart()
    useCartStore.setState({ _hasHydrated: true })
    useCartStore.getState().addItem(sampleItem)
    useUserStore.setState({ user: null } as Partial<ReturnType<typeof useUserStore.getState>>)
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('[BUG FIX] two handlePlace() calls in the same tick only fire one /api/v1/orders request', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    const { promise, resolve } = deferred<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }>()
    // C1: handlePlace now validates the cart against the server BEFORE creating the order.
    // Let that check resolve immediately (fail-open 500) so only the ORDER request stays
    // in flight; everything else resolves normally.
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/v1/orders') return promise
      if (url === '/api/v1/cart/validate') return Promise.resolve({ ok: false, status: 500, text: async () => '', json: async () => ({}) })
      return Promise.resolve({ ok: true, status: 200, text: async () => '', json: async () => ({}) })
    })

    const { result } = renderHook(() => useCheckoutPage(settings))
    fillValidAddress(result)
    act(() => { result.current.setPayMethod?.('cod') })

    // Simulate both checkout CTAs firing near-simultaneously — call
    // handlePlace twice without awaiting the first, exactly as two
    // synchronous onClick handlers would in the same event-loop tick.
    let p1: Promise<void>, p2: Promise<void>
    act(() => {
      p1 = result.current.handlePlace()
      p2 = result.current.handlePlace()
    })

    // The order request leaves a moment later (after the cart validation); wait for it…
    await vi.waitFor(() => expect(ordersCallCount(fetchMock)).toBe(1))
    // …and make sure the second click did not produce another one once everything settles.
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(ordersCallCount(fetchMock)).toBe(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/orders', expect.any(Object))

    // Let the in-flight request resolve so nothing dangles into the next test.
    await act(async () => {
      resolve({ ok: true, status: 201, text: async () => '', json: async () => ({ order_number: 'ORD-TEST-1' }) })
      await Promise.all([p1, p2])
    })
  })

  it('releases the guard on validation failure so a corrected retry can proceed', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({ ok: true, status: 201, text: async () => '', json: async () => ({ order_number: 'ORD-TEST-2' }) })

    const { result } = renderHook(() => useCheckoutPage(settings))
    // Deliberately leave the address incomplete — validation should fail
    // before ever reaching fetch, and must release the guard so a
    // subsequent, corrected submit isn't permanently blocked.
    act(() => { result.current.setPayMethod?.('cod') })

    await act(async () => { await result.current.handlePlace() })
    expect(ordersCallCount(fetchMock)).toBe(0)
    expect(result.current.error).toBeTruthy()

    fillValidAddress(result)
    await act(async () => { await result.current.handlePlace() })
    expect(ordersCallCount(fetchMock)).toBe(1)
  })

  it('releases the guard after a failed order so the customer can retry', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok: false, status: 500,
      text: async () => 'Order save failed',
      json: async () => ({ error: 'Order save failed' }),
    })

    const { result } = renderHook(() => useCheckoutPage(settings))
    fillValidAddress(result)
    act(() => { result.current.setPayMethod?.('cod') })

    await act(async () => { await result.current.handlePlace() })
    expect(ordersCallCount(fetchMock)).toBe(1)

    // A second attempt after the first one resolved (failed) must be able
    // to go through — the guard is per-in-flight-request, not permanent.
    await act(async () => { await result.current.handlePlace() })
    expect(ordersCallCount(fetchMock)).toBe(2)
  })
})
