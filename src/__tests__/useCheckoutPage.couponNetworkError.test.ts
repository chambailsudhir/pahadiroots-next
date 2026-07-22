/**
 * useCheckoutPage.couponNetworkError.test.ts
 *
 * Covers a fix found in a fresh re-audit: handleCoupon() had no catch
 * block at all — only try/finally. A genuine network failure (fetch()
 * itself throwing — offline, DNS failure, etc., not just a non-OK
 * response) would silently reset the loading spinner via finally but
 * never set an error message, leaving the customer with no explanation.
 * handleApplyCouponHint, its near-identical sibling, already handled
 * this correctly — this fix brings handleCoupon in line with it.
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

describe('useCheckoutPage — handleCoupon network-error handling', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart()
    useCartStore.setState({ _hasHydrated: true })
    useCartStore.getState().addItem(sampleItem)
    useUserStore.setState({ user: null } as Partial<ReturnType<typeof useUserStore.getState>>)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('[BUG FIX] shows an error message when fetch() itself throws, instead of silently resetting the spinner', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const { result } = renderHook(() => useCheckoutPage(settings))
    act(() => { result.current.setCouponCode('SAVE10') })

    await act(async () => { await result.current.handleCoupon() })

    // This is the actual bug: previously there was no catch block, so a
    // thrown fetch error left couponError empty (finally still ran, only
    // resetting the loading flag) while the customer got no explanation.
    expect(result.current.couponLoading).toBe(false)
    expect(result.current.couponError).toBeTruthy()
  })

  it('still handles a normal non-OK JSON response correctly (not a regression)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid coupon code' }),
    }))

    const { result } = renderHook(() => useCheckoutPage(settings))
    act(() => { result.current.setCouponCode('BADCODE') })

    await act(async () => { await result.current.handleCoupon() })

    expect(result.current.couponError).toBe('Invalid coupon code')
    expect(result.current.couponLoading).toBe(false)
  })

  it('still applies a valid coupon successfully (not a regression)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ coupon: { code: 'SAVE10', discount: 50, type: 'flat', value: 50 } }),
    }))

    const { result } = renderHook(() => useCheckoutPage(settings))
    act(() => { result.current.setCouponCode('SAVE10') })

    await act(async () => { await result.current.handleCoupon() })

    expect(result.current.couponError).toBeFalsy()
    expect(result.current.couponLoading).toBe(false)
  })
})
