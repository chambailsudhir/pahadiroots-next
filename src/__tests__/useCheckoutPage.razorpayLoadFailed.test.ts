/**
 * useCheckoutPage.razorpayLoadFailed.test.ts
 *
 * Regression test for a CRITICAL bug reported live from production
 * (screenshot showed the Pay button stuck on "Loading payment..." with no
 * way to proceed): the Razorpay <Script>'s onError handler only logged to
 * the console — it never set any state. If the script failed to load for
 * ANY reason (network hiccup, slow connection, ad-blocker, transient CDN
 * issue) OR hung indefinitely without firing onLoad or onError at all,
 * razorpayLoaded stayed false forever. The Pay button is disabled whenever
 * razorpayLoaded is false, so the customer was stuck permanently with zero
 * explanation and zero way to recover except an accidental page refresh.
 *
 * Covers:
 *   1. razorpayLoadFailed starts false and stays false while loading is
 *      still plausibly in progress.
 *   2. A 10s timeout sets razorpayLoadFailed = true if razorpayLoaded never
 *      became true (covers the "script hangs silently" case, which onError
 *      alone can't catch).
 *   3. The timeout does NOT fire if razorpayLoaded becomes true first (no
 *      false-positive failure banner on a normal, slightly-slow load).
 *   4. setRazorpayLoadFailed can be set directly (the onError path).
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

describe('useCheckoutPage — razorpayLoadFailed fallback', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart()
    useCartStore.setState({ _hasHydrated: true })
    useCartStore.getState().addItem(sampleItem)
    useUserStore.setState({ user: null } as Partial<ReturnType<typeof useUserStore.getState>>)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    }))
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts with razorpayLoadFailed false', () => {
    const { result } = renderHook(() => useCheckoutPage(settings))
    expect(result.current.razorpayLoadFailed).toBe(false)
  })

  it('sets razorpayLoadFailed = true after 10s if the script never signals loaded (covers a hung/silent script load)', () => {
    const { result } = renderHook(() => useCheckoutPage(settings))
    expect(result.current.razorpayLoadFailed).toBe(false)

    act(() => { vi.advanceTimersByTime(10_000) })

    expect(result.current.razorpayLoadFailed).toBe(true)
  })

  it('does NOT set razorpayLoadFailed if razorpayLoaded becomes true before the timeout', () => {
    const { result } = renderHook(() => useCheckoutPage(settings))

    act(() => {
      vi.advanceTimersByTime(3_000)
      result.current.setRazorpayLoaded(true)
    })
    act(() => { vi.advanceTimersByTime(10_000) })

    expect(result.current.razorpayLoadFailed).toBe(false)
  })

  it('allows setting razorpayLoadFailed directly (the onError path, for a clean network-level failure)', () => {
    const { result } = renderHook(() => useCheckoutPage(settings))

    act(() => { result.current.setRazorpayLoadFailed(true) })

    expect(result.current.razorpayLoadFailed).toBe(true)
  })
})
