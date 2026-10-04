/**
 * P1 follow-up — verify_payment can now answer 202 (authorized, awaiting capture) or
 * 503 (Razorpay lookup outage) while the customer's money HAS been taken. The hook must
 * send them to the order page (which polls) — not show an error and not invite a second
 * payment.
 *
 * @vitest-environment jsdom
 */
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

const settings = {} as unknown as SiteSettings
const sampleItem = {
  productId: 'p1', variantId: 'v1', name: 'Cold Pressed Mustard Oil', slug: 'mustard-oil',
  price: 143, mrp: 150, qty: 1, image: null, size: '500ml', maxQty: 10, gstRate: 5,
} as CartItem

const res = (status: number, body: object) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body })

function fillValidAddress(result: { current: ReturnType<typeof useCheckoutPage> }) {
  act(() => {
    result.current.setAddrField('name', 'Test User'); result.current.setAddrField('phone', '9876543210')
    result.current.setAddrField('flat', 'Flat 4'); result.current.setAddrField('city', 'Dehradun')
    result.current.setAddrField('state', 'Uttarakhand'); result.current.setAddrField('pincode', '248001')
  })
}

let rzpHandler: ((r: Record<string, string>) => Promise<void>) | null = null

async function payAndGetVerifyResult(verifyResponse: ReturnType<typeof res>) {
  const fetchMock = global.fetch as ReturnType<typeof vi.fn>
  fetchMock.mockImplementation(async (url: string, init?: { body?: string }) => {
    if (url === '/api/v1/payments') {
      const body = JSON.parse(init?.body ?? '{}')
      return body.action === 'verify_payment'
        ? verifyResponse
        : res(200, { success: true, order_id: 'db-1', razorpay_order_id: 'order_x', amount: 14300, currency: 'INR' })
    }
    return res(200, {})
  })
  const { result } = renderHook(() => useCheckoutPage(settings))
  fillValidAddress(result)
  act(() => { result.current.setPayMethod('razorpay') })
  await act(async () => { await result.current.handlePlace() })
  expect(rzpHandler).toBeTruthy()
  await act(async () => { await rzpHandler!({ razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x', razorpay_signature: 'sig' }) })
  return result
}

describe('useCheckoutPage — verify_payment pending (202 / 503) routes to the order page', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_RAZORPAY_KEY_ID', 'rzp_test_key')
    h.replace.mockReset(); rzpHandler = null
    useCartStore.getState().clearCart()
    useCartStore.setState({ _hasHydrated: true })
    useCartStore.getState().addItem(sampleItem)
    useUserStore.setState({ user: null } as Partial<ReturnType<typeof useUserStore.getState>>)
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('open', vi.fn())
    ;(window as unknown as { Razorpay: unknown }).Razorpay = class {
      constructor(opts: { handler: typeof rzpHandler }) { rzpHandler = opts.handler }
      open() {}
    }
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it.each([202, 503])('HTTP %i + pending → replaces to /order-success with order number and token, cart cleared, no error', async (status) => {
    const result = await payAndGetVerifyResult(res(status, {
      error: 'being confirmed', pending: true, order_number: 'PR1A2B3C4D', confirmation_token: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    }))

    expect(h.replace).toHaveBeenCalledTimes(1)
    const url = String(h.replace.mock.calls[0][0])
    expect(url).toContain('/order-success?')
    expect(url).toContain('id=PR1A2B3C4D')
    expect(url).toContain('token=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(result.current.error).toBe('')
    expect(useCartStore.getState().items).toHaveLength(0)
  })

  it('a genuine verification failure (400) still shows an error and does NOT navigate', async () => {
    const result = await payAndGetVerifyResult(res(400, { error: 'Payment verification failed' }))
    expect(h.replace).not.toHaveBeenCalled()
    expect(result.current.error).toMatch(/verification failed/i)
    expect(useCartStore.getState().items).toHaveLength(1)
  })

  it('a 503 WITHOUT an order reference (older/other failure) is still treated as an error', async () => {
    const result = await payAndGetVerifyResult(res(503, { error: 'down' }))
    expect(h.replace).not.toHaveBeenCalled()
    expect(result.current.error).toMatch(/down/)
  })
})
