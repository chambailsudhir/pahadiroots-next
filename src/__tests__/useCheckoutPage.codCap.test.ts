// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCheckoutPage } from '@/hooks/useCheckoutPage'
import { useCartStore } from '@/store/cartStore'
import { useUserStore } from '@/store/userStore'
import type { SiteSettings, CartItem } from '@/types'

const h = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() }, getServiceClient: vi.fn(() => ({ from: vi.fn() })) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: vi.fn() }) }))
vi.mock('@/hooks/useCheckoutAnalytics', () => ({
  useCheckoutAnalytics: () => ({
    trackCheckoutStarted: vi.fn(), trackAddressSubmitted: vi.fn(), trackPaymentMethodSelected: vi.fn(),
    trackOrderPlaced: vi.fn(), trackCouponApplied: vi.fn(), trackCouponError: vi.fn(), trackLoyaltyApplied: vi.fn(),
    trackPaymentFailed: vi.fn(), trackPaymentInitiated: vi.fn(), trackPaymentVerified: vi.fn(),
  }),
}))
vi.mock('@/lib/profileCache', () => ({ readProfileCache: () => null, writeProfileCache: vi.fn() }))


const SETTINGS = { cod_enabled: 'true', cod_max_value: '3000', flat_shipping_charge: '99', free_shipping_min: '5000', cod_surcharge_amount: '50', prepaid_discount_pct: '0' } as unknown as SiteSettings
const item = (price: number) => ({
  productId: 'p1', variantId: 'v1', name: 'Honey', slug: 'honey', price, mrp: price, qty: 1, image: null, size: '1kg', maxQty: 10, gstRate: 5,
} as CartItem)

describe('useCheckoutPage — COD availability uses the COD TOTAL (what the server checks), not the raw subtotal', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart(); useCartStore.setState({ _hasHydrated: true })
    useUserStore.setState({ user: null } as Partial<ReturnType<typeof useUserStore.getState>>)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) })))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('₹2,950 of goods + ₹99 shipping + ₹50 COD fee = ₹3,099 > ₹3,000 cap → COD hidden (it used to show and then fail at Place Order)', () => {
    useCartStore.getState().addItem(item(2950))
    const { result } = renderHook(() => useCheckoutPage(SETTINGS))
    expect(result.current.codOk).toBe(false)
  })

  it('₹2,800 + 99 + 50 = ₹2,949 → COD offered', () => {
    useCartStore.getState().addItem(item(2800))
    const { result } = renderHook(() => useCheckoutPage(SETTINGS))
    expect(result.current.codOk).toBe(true)
  })

  // Nov 2026 verification: before a method was chosen the page priced as COD even when COD could not be picked, adding the ₹50 COD
  // fee to a total the customer could never pay and showing more than the cart did.
  it('with COD unavailable and nothing chosen yet, the total carries no COD fee (priced as the online payment)', () => {
    vi.stubEnv('NEXT_PUBLIC_RAZORPAY_KEY_ID', 'rzp_test_x')
    try {
      useCartStore.getState().addItem(item(2950))
      const { result } = renderHook(() => useCheckoutPage({ ...SETTINGS, upi_enabled: 'true' } as unknown as SiteSettings))
      expect(result.current.codOk).toBe(false)
      expect(result.current.pricing.codSurcharge).toBe(0)
      expect(result.current.payMethod).toBe('razorpay')
    } finally { vi.unstubAllEnvs() }
  })
})

describe('useCheckoutPage — no silently pre-selected state', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart(); useCartStore.setState({ _hasHydrated: true })
    useUserStore.setState({ user: null } as Partial<ReturnType<typeof useUserStore.getState>>)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) })))
  })
  afterEach(() => { vi.unstubAllGlobals() })
  it('a new visitor starts with an empty state (it used to be Uttarakhand), so a wrong default can never be submitted unnoticed', () => {
    useCartStore.getState().addItem(item(500))
    const { result } = renderHook(() => useCheckoutPage(SETTINGS))
    expect(result.current.addr.state).toBe('')
  })
})
