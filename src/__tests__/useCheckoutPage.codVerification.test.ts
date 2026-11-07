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

function fill(result: { current: ReturnType<typeof useCheckoutPage> }) {
  act(() => {
    result.current.setAddrField('name', 'Test User')
    result.current.setAddrField('phone', '9876543210')
    result.current.setAddrField('flat', 'Flat 4, Test Building')
    result.current.setAddrField('area', 'Rajpur Road')
    result.current.setAddrField('city', 'Dehradun')
    result.current.setAddrField('state', 'Uttarakhand')
    result.current.setAddrField('pincode', '248001')
    result.current.setEmail('asha@example.com')
    result.current.setPayMethod('cod')
  })
}
const json = (status: number, body: object) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })

// Nov 2026: risky-COD verification. A 409 COD_VERIFICATION_REQUIRED opens the code step (no error banner); the confirmed code's
// token goes with the re-placed order.
describe('useCheckoutPage — risky COD verification step', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart()
    useCartStore.setState({ _hasHydrated: true })
    useCartStore.getState().addItem(sampleItem)
    useUserStore.setState({ user: null } as Partial<ReturnType<typeof useUserStore.getState>>)
    vi.spyOn(window, 'open').mockImplementation(() => null)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('opens the step on COD_VERIFICATION_REQUIRED, then places the order with the token after the code is confirmed', async () => {
    const orderBodies: Array<Record<string, unknown>> = []
    let orderCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/orders') {
        orderBodies.push(JSON.parse(String(init?.body)))
        orderCalls++
        return orderCalls === 1
          ? json(409, { error: 'Please confirm this Cash on Delivery order', code: 'COD_VERIFICATION_REQUIRED' })
          : json(201, { success: true, order_number: 'ORD-1', order_id: 1, confirmation_token: 'c' })
      }
      if (url === '/api/v1/cod-verify/start') return json(200, { sent: true, to: 'as**@example.com' })
      if (url === '/api/v1/cod-verify/confirm') return json(200, { verified: true, token: 'tok-xyz' })
      return json(200, {})
    }))
    const { result } = renderHook(() => useCheckoutPage(settings))
    fill(result)
    await act(async () => { await result.current.handlePlace() })
    expect(result.current.codVerify.open).toBe(true)
    expect(result.current.error).toBe('')
    expect(orderBodies[0].cod_verification_token).toBeUndefined()

    await act(async () => { await result.current.requestCodCode() })
    expect(result.current.codVerify.sentTo).toBe('as**@example.com')
    await act(async () => { await result.current.confirmCodCode('123456') })
    expect(result.current.codVerify.open).toBe(false)
    expect(orderCalls).toBe(2)
    expect(orderBodies[1].cod_verification_token).toBe('tok-xyz')
  })

  it('COD_NOT_AVAILABLE hides COD for this phone and shows the reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/v1/orders'
      ? json(409, { error: 'Cash on Delivery is not available for this mobile number', code: 'COD_NOT_AVAILABLE' })
      : json(200, {})))
    const codSettings = { cod_enabled: 'true', cod_max_value: '3000' } as unknown as SiteSettings
    const { result } = renderHook(() => useCheckoutPage(codSettings))
    fill(result)
    expect(result.current.codOk).toBe(true)
    await act(async () => { await result.current.handlePlace() })
    expect(result.current.codOk).toBe(false)
    expect(result.current.error).toMatch(/not available for this mobile number/)
  })

  it('a wrong code keeps the step open with the server message and does not place the order', async () => {
    let orderCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/v1/orders') { orderCalls++; return json(409, { error: 'x', code: 'COD_VERIFICATION_REQUIRED' }) }
      if (url === '/api/v1/cod-verify/confirm') return json(400, { error: 'That code is not right. 4 attempts left.', code: 'CODE_WRONG' })
      return json(200, { sent: true, to: 'as**@example.com' })
    }))
    const { result } = renderHook(() => useCheckoutPage(settings))
    fill(result)
    await act(async () => { await result.current.handlePlace() })
    await act(async () => { await result.current.confirmCodCode('000000') })
    expect(result.current.codVerify.open).toBe(true)
    expect(result.current.codVerify.error).toMatch(/4 attempts left/)
    expect(orderCalls).toBe(1)
  })
})
