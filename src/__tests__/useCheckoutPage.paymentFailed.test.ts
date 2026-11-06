/**
 * S-03 / L-15 (Nov 2026 verification): `rzp.on('payment.failed')`.
 *
 * A declined / failed attempt INSIDE the Razorpay modal used to leave "Placing Order…" disabled until the customer closed the
 * modal. The hook now registers a `payment.failed` handler that releases the button at once (the modal itself offers Retry).
 * The call is optional-chained (`.on?.()`) for older checkout.js builds, so a mock WITHOUT `on` would pass silently — this
 * mock exposes `on` and asserts the handler is registered and does the right thing.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCheckoutPage } from '@/hooks/useCheckoutPage'
import { useCartStore } from '@/store/cartStore'
import { useUserStore } from '@/store/userStore'
import type { SiteSettings, CartItem } from '@/types'

const h = vi.hoisted(() => ({ replace: vi.fn(), trackPaymentFailed: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() }, getServiceClient: vi.fn(() => ({ from: vi.fn() })) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: vi.fn() }) }))
vi.mock('@/hooks/useCheckoutAnalytics', () => ({
  useCheckoutAnalytics: () => ({
    trackCheckoutStarted: vi.fn(), trackAddressSubmitted: vi.fn(), trackPaymentMethodSelected: vi.fn(),
    trackOrderPlaced: vi.fn(), trackCouponApplied: vi.fn(), trackCouponError: vi.fn(), trackLoyaltyApplied: vi.fn(),
    trackPaymentFailed: h.trackPaymentFailed, trackPaymentInitiated: vi.fn(), trackPaymentVerified: vi.fn(),
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

type Listener = (payload?: unknown) => void
const rzp = { listeners: {} as Record<string, Listener>, opened: 0, dismiss: null as null | (() => void) }

describe('useCheckoutPage — payment.failed inside the Razorpay modal releases the Place Order button', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_RAZORPAY_KEY_ID', 'rzp_test_key')
    h.replace.mockReset(); rzp.listeners = {}; rzp.opened = 0; rzp.dismiss = null
    useCartStore.getState().clearCart()
    useCartStore.setState({ _hasHydrated: true })
    useCartStore.getState().addItem(sampleItem)
    useUserStore.setState({ user: null } as Partial<ReturnType<typeof useUserStore.getState>>)
    const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
      if (url === '/api/v1/payments') {
        const body = JSON.parse(init?.body ?? '{}')
        if (body.action === 'create_payment') return res(200, { success: true, order_id: 'db-1', order_number: 'PR1A2B3C4D', razorpay_order_id: 'order_x', amount: 14300, currency: 'INR' })
      }
      return res(200, {})
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('open', vi.fn())
    ;(window as unknown as { Razorpay: unknown }).Razorpay = class {
      constructor(opts: { modal?: { ondismiss?: () => void } }) { rzp.dismiss = opts.modal?.ondismiss ?? null }
      on(ev: string, cb: Listener) { rzp.listeners[ev] = cb }
      open() { rzp.opened += 1 }
    }
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

  async function openModal() {
    const { result } = renderHook(() => useCheckoutPage(settings))
    fillValidAddress(result)
    act(() => { result.current.setPayMethod('razorpay') })
    await act(async () => { await result.current.handlePlace() })
    expect(rzp.opened).toBe(1)
    return result
  }

  it('registers a payment.failed handler on the Razorpay instance', async () => {
    await openModal()
    expect(typeof rzp.listeners['payment.failed']).toBe('function')
  })

  it('while the modal is open the button is held; a failed attempt releases it without an error message or a cleared cart', async () => {
    const result = await openModal()
    expect(result.current.placing).toBe(true)   // modal open → "Placing Order…" held

    act(() => { rzp.listeners['payment.failed']({ error: { code: 'BAD_REQUEST_ERROR', description: 'Payment failed' } }) })

    expect(result.current.placing).toBe(false)  // released at once (the modal offers Retry itself)
    expect(result.current.error).toBe('')       // no "failed" banner behind the modal — nothing to contact support about yet
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(h.replace).not.toHaveBeenCalled()
  })

  it('after a failed attempt a second Place Order click goes through again (the guard was released)', async () => {
    const result = await openModal()
    act(() => { rzp.listeners['payment.failed']() })
    await act(async () => { await result.current.handlePlace() })
    const creates = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(c => c[0] === '/api/v1/payments' && JSON.parse(String((c[1] as { body?: string })?.body ?? '{}')).action === 'create_payment')
    expect(creates).toHaveLength(2)
    expect(rzp.opened).toBe(2)
  })

  it('closing the modal (ondismiss) also releases the button', async () => {
    const result = await openModal()
    act(() => { rzp.dismiss?.() })
    expect(result.current.placing).toBe(false)
  })

  it('does not crash on an older checkout.js whose instance has no `on`', async () => {
    ;(window as unknown as { Razorpay: unknown }).Razorpay = class { open() { rzp.opened += 1 } }
    const result = await openModal()
    expect(result.current.error).toBe('')
    expect(result.current.placing).toBe(true)
  })
})
