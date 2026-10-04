/**
 * P3 (client) — idempotency key lifecycle on the checkout page.
 *
 *  • key CHANGES when anything defining the order changes (qty, payment method)
 *  • key is KEPT when nothing changed (so a dismissed Razorpay modal resumes the same order)
 *  • key is replaced when the server answers 409 IDEMPOTENCY_CONFLICT
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

const key = () => useCartStore.getState().idempotencyKey
const jsonRes = (status: number, body: object) => ({
  ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body,
})

describe('useCheckoutPage — idempotency key lifecycle (P3)', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart()
    useCartStore.setState({ _hasHydrated: true })
    useCartStore.getState().addItem(sampleItem)
    useUserStore.setState({ user: null } as Partial<ReturnType<typeof useUserStore.getState>>)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(200, {})))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps the key when nothing about the order changes', async () => {
    const { result, rerender } = renderHook(() => useCheckoutPage(settings))
    const before = key()
    expect(before).not.toBe('')
    rerender()
    await act(async () => { await Promise.resolve() })
    expect(key()).toBe(before)
    expect(result.current.payMethod).toBeDefined()
  })

  it('mints a NEW key when the cart quantity changes', async () => {
    renderHook(() => useCheckoutPage(settings))
    const before = key()
    await act(async () => { useCartStore.getState().updateQty('v1', 3) })
    expect(key()).not.toBe('')
    expect(key()).not.toBe(before)
  })

  it('mints a NEW key when the payment method changes', async () => {
    const { result } = renderHook(() => useCheckoutPage(settings))
    const before = key()
    const next = result.current.payMethod === 'cod' ? 'razorpay' : 'cod'
    await act(async () => { result.current.setPayMethod(next) })
    expect(key()).not.toBe(before)
  })

  it('does not touch the key when the cart is emptied after a successful order (clearCart sets it to "")', async () => {
    renderHook(() => useCheckoutPage(settings))
    await act(async () => { useCartStore.getState().clearCart() })
    expect(key()).toBe('')
  })

  it('replaces the key when /api/v1/orders answers 409 IDEMPOTENCY_CONFLICT and shows the server message', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/v1/orders'
        ? jsonRes(409, { error: 'Your cart or payment details changed. Please place it again.', code: 'IDEMPOTENCY_CONFLICT' })
        : jsonRes(200, {}))

    const { result } = renderHook(() => useCheckoutPage(settings))
    fillValidAddress(result)
    act(() => { result.current.setPayMethod('cod') })
    const before = key()

    await act(async () => { await result.current.handlePlace() })

    expect(key()).not.toBe(before)
    expect(key()).not.toBe('')
    expect(result.current.error).toMatch(/place it again/i)
  })
})
