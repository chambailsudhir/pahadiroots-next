// @vitest-environment jsdom

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

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }

// Nov 2026 verification: the coins re-check after a cart change removed the redeemed coins on ANY non-OK answer, including a rate
// limit (429) or a server error; only a definite "no" (400) should, as for coupons.
describe('useCheckoutPage — coins re-check keeps the redemption on 429 / 5xx', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    useCartStore.getState().clearCart()
    useCartStore.setState({ _hasHydrated: true })
    useCartStore.getState().addItem({ ...sampleItem, price: 500, qty: 2 })
    useUserStore.setState({ user: null } as Partial<ReturnType<typeof useUserStore.getState>>)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it.each([[429], [503]])('a %i answer to the re-check keeps the coins', async (status) => {
    const answers = [{ ok: true, status: 200, json: async () => ({ points: 40, discount_inr: 10 }) }]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/v1/loyalty') return answers.shift() ?? { ok: false, status, json: async () => ({ error: 'busy' }) }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }
    }))
    const { result } = renderHook(() => useCheckoutPage(settings))
    await act(async () => { await result.current.handleApplyLoyalty(40); await flush() })
    expect(result.current.loyaltyRedemption).toEqual({ points: 40, discount_inr: 10 })
    await act(async () => { useCartStore.getState().updateQty('v1', 3); await flush() })
    await act(async () => { vi.advanceTimersByTime(900); await flush() })
    expect(result.current.loyaltyRedemption).toEqual({ points: 40, discount_inr: 10 })
  })

  it('a 400 still removes them and says why', async () => {
    const answers = [{ ok: true, status: 200, json: async () => ({ points: 40, discount_inr: 10 }) }]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/v1/loyalty') return answers.shift() ?? { ok: false, status: 400, json: async () => ({ error: 'Too many coins for this order' }) }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' }
    }))
    const { result } = renderHook(() => useCheckoutPage(settings))
    await act(async () => { await result.current.handleApplyLoyalty(40); await flush() })
    await act(async () => { useCartStore.getState().updateQty('v1', 3); await flush() })
    await act(async () => { vi.advanceTimersByTime(900); await flush() })
    expect(result.current.loyaltyRedemption).toBeNull()
    expect(result.current.loyaltyError).toBe('Too many coins for this order')
  })
})
