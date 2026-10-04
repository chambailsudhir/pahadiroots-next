/**
 * C1 (client) — checkout confirms the customer's cart against live server prices/stock
 * BEFORE any order or payment exists, and tells them what changed when it loads.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCheckoutPage } from '@/hooks/useCheckoutPage'
import { useCartStore } from '@/store/cartStore'
import { useUserStore } from '@/store/userStore'
import type { SiteSettings, CartItem } from '@/types'

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() }, getServiceClient: vi.fn(() => ({ from: vi.fn() })) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
vi.mock('@/hooks/useCheckoutAnalytics', () => ({
  useCheckoutAnalytics: () => ({
    trackCheckoutStarted: vi.fn(), trackAddressSubmitted: vi.fn(), trackPaymentMethodSelected: vi.fn(),
    trackOrderPlaced: vi.fn(), trackCouponApplied: vi.fn(), trackCouponError: vi.fn(), trackLoyaltyApplied: vi.fn(),
    trackPaymentFailed: vi.fn(), trackPaymentInitiated: vi.fn(), trackPaymentVerified: vi.fn(),
  }),
}))
vi.mock('@/lib/profileCache', () => ({ readProfileCache: () => null, writeProfileCache: vi.fn() }))

const settings = { codEnabled: true, razorpayEnabled: true } as unknown as SiteSettings
const sampleItem = {
  productId: 'p1', variantId: 'v1', name: 'Cold Pressed Mustard Oil', slug: 'mustard-oil',
  price: 143, mrp: 150, qty: 2, image: null, size: '500ml', maxQty: 10, gstRate: 5,
} as CartItem

const res = (status: number, body: object) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body })
const liveLine = (over: Record<string, unknown> = {}) => ({ productId: 'p1', variantId: 'v1', status: 'ok', name: 'Cold Pressed Mustard Oil', price: 143, mrp: 150, available: 10, ...over })

let validateResponse: () => unknown
const calls = (url: string) => (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(c => c[0] === url).length

/** The load-time check sees an unchanged cart; every later check (the pre-payment one) sees `lines`. */
function changeAfterLoad(lines: unknown[]) {
  let n = 0
  validateResponse = () => res(200, { lines: n++ === 0 ? [liveLine()] : lines })
}
async function loaded(result: { current: ReturnType<typeof useCheckoutPage> }) {
  await waitFor(() => expect(calls('/api/v1/cart/validate')).toBeGreaterThan(0))
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
  expect(result.current.cartNotices).toEqual([])   // load-time check found nothing → pre-payment is the first to notice
}

function fill(result: { current: ReturnType<typeof useCheckoutPage> }) {
  act(() => {
    result.current.setAddrField('name', 'Test User'); result.current.setAddrField('phone', '9876543210')
    result.current.setAddrField('flat', 'Flat 4'); result.current.setAddrField('city', 'Dehradun')
    result.current.setAddrField('state', 'Uttarakhand'); result.current.setAddrField('pincode', '248001')
  })
}

describe('useCheckoutPage — cart revalidation (C1)', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart()
    useCartStore.setState({ _hasHydrated: true })
    useCartStore.getState().addItem(sampleItem)
    useUserStore.setState({ user: null } as Partial<ReturnType<typeof useUserStore.getState>>)
    validateResponse = () => res(200, { lines: [liveLine()] })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/v1/cart/validate') return validateResponse()
      if (url === '/api/v1/orders') return res(201, { order_number: 'PR1' })
      return res(200, {})
    }))
    vi.stubGlobal('open', vi.fn())
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('price went UP → order is NOT placed, cart shows the new price, customer is told exactly what changed', async () => {
    changeAfterLoad([liveLine({ price: 189 })])
    const { result } = renderHook(() => useCheckoutPage(settings))
    await loaded(result)
    fill(result); act(() => { result.current.setPayMethod('cod') })

    await act(async () => { await result.current.handlePlace() })

    expect(calls('/api/v1/orders')).toBe(0)
    expect(result.current.error).toMatch(/price of Cold Pressed Mustard Oil changed from ₹143 to ₹189/)
    expect(result.current.error).toMatch(/place it again/i)
    expect(result.current.placing).toBe(false)
    expect(useCartStore.getState().items[0].price).toBe(189)
  })

  it('item no longer available → order NOT placed and the line is removed', async () => {
    changeAfterLoad([liveLine({ status: 'unavailable', available: 0, price: 0 })])
    const { result } = renderHook(() => useCheckoutPage(settings))
    await loaded(result)
    fill(result); act(() => { result.current.setPayMethod('cod') })
    await act(async () => { await result.current.handlePlace() })

    expect(calls('/api/v1/orders')).toBe(0)
    expect(result.current.error).toMatch(/no longer available/)
    expect(useCartStore.getState().items).toHaveLength(0)
  })

  it('less stock than the cart holds → order NOT placed, qty reduced', async () => {
    changeAfterLoad([liveLine({ status: 'insufficient_stock', available: 1 })])
    const { result } = renderHook(() => useCheckoutPage(settings))
    await loaded(result)
    fill(result); act(() => { result.current.setPayMethod('cod') })
    await act(async () => { await result.current.handlePlace() })

    expect(calls('/api/v1/orders')).toBe(0)
    expect(useCartStore.getState().items[0].qty).toBe(1)
  })

  it('nothing changed → proceeds to place the order (second click after review also proceeds)', async () => {
    const { result } = renderHook(() => useCheckoutPage(settings))
    fill(result); act(() => { result.current.setPayMethod('cod') })
    await act(async () => { await result.current.handlePlace() })
    expect(calls('/api/v1/orders')).toBe(1)
  })

  it('the validation request itself fails (5xx) → FAILS OPEN: order placed, server stays the authority', async () => {
    const { result } = renderHook(() => useCheckoutPage(settings))
    await loaded(result)
    validateResponse = () => res(500, { error: 'boom' })
    fill(result); act(() => { result.current.setPayMethod('cod') })
    await act(async () => { await result.current.handlePlace() })
    expect(calls('/api/v1/orders')).toBe(1)
  })

  it('network error on validation → FAILS OPEN too', async () => {
    const { result } = renderHook(() => useCheckoutPage(settings))
    await loaded(result)
    validateResponse = () => { throw new Error('offline') }
    fill(result); act(() => { result.current.setPayMethod('cod') })
    await act(async () => { await result.current.handlePlace() })
    expect(calls('/api/v1/orders')).toBe(1)
  })

  it('a refreshed price mints a NEW idempotency key (a pending order at the old price must not be reused)', async () => {
    const { result } = renderHook(() => useCheckoutPage(settings))
    await loaded(result)
    const before = useCartStore.getState().idempotencyKey
    expect(before).not.toBe('')

    await act(async () => {
      useCartStore.getState().applyLiveLines([liveLine({ price: 189 }) as never])   // same call the revalidation makes
    })
    expect(useCartStore.getState().items[0].price).toBe(189)
    expect(useCartStore.getState().idempotencyKey).not.toBe(before)
  })

  it('on load: tells the customer what changed (banner messages)', async () => {
    validateResponse = () => res(200, { lines: [liveLine({ price: 160 })] })
    const { result } = renderHook(() => useCheckoutPage(settings))
    await waitFor(() => expect(result.current.cartNotices.length).toBeGreaterThan(0))
    expect(result.current.cartNotices[0]).toMatch(/changed from ₹143 to ₹160/)
    act(() => result.current.dismissCartNotices())
    expect(result.current.cartNotices).toEqual([])
  })

  it('on load with nothing changed: no notice', async () => {
    const { result } = renderHook(() => useCheckoutPage(settings))
    await waitFor(() => expect(calls('/api/v1/cart/validate')).toBeGreaterThan(0))
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
    expect(result.current.cartNotices).toEqual([])
  })
})
