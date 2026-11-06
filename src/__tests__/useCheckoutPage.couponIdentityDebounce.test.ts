/**
 * S-03 / L-15 (Nov 2026 verification): the 2.5 s coupon re-check debounce.
 *
 * "One person / one address, one time only": once the checkout form holds a valid mobile and a complete-looking address, the
 * applied coupon is re-checked against that identity (POST /api/v1/coupons). It is debounced at 2500 ms (was 1.2 s) because typing
 * the address kept firing checks and used up the 5-per-minute limit the shopper needs to swap a coupon. Fake timers prove:
 *   • nothing is sent before 2.5 s, exactly one request at 2.5 s;
 *   • every keystroke inside the window restarts it;
 *   • the same identity is not re-checked twice; only a definite 400 strips the coupon (a 429 keeps it).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCheckoutPage } from '@/hooks/useCheckoutPage'
import { useCartStore } from '@/store/cartStore'
import { useUserStore } from '@/store/userStore'
import type { SiteSettings, CartItem, AppliedCoupon } from '@/types'

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

const settings = {} as unknown as SiteSettings
const sampleItem = {
  productId: 'p1', variantId: 'v1', name: 'Cold Pressed Mustard Oil', slug: 'mustard-oil',
  price: 1000, mrp: 1200, qty: 1, image: null, size: '500ml', maxQty: 10, gstRate: 5,
} as CartItem
const COUPON = { code: 'PAHADI10', discount: 100, type: 'percent', value: 10 } as unknown as AppliedCoupon
const res = (status: number, body: object) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body })

let couponResponses: Array<ReturnType<typeof res>> = []
const couponPosts = () => (global.fetch as ReturnType<typeof vi.fn>).mock.calls
  .filter(c => c[0] === '/api/v1/coupons')
  .map(c => JSON.parse(String((c[1] as { body?: string })?.body ?? '{}')))

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); await flush() }) }

function fillIdentity(result: { current: ReturnType<typeof useCheckoutPage> }) {
  act(() => {
    result.current.setAddrField('phone', '9876543210')
    result.current.setAddrField('pincode', '248001')
    result.current.setAddrField('flat', 'Flat 4, Test Building')
  })
}

describe('useCheckoutPage — coupon identity re-check is debounced at 2.5 s', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    useCartStore.getState().clearCart()
    useCartStore.setState({ _hasHydrated: true })
    useCartStore.getState().addItem(sampleItem)
    useCartStore.getState().applyCoupon(COUPON)
    useUserStore.setState({ user: null } as Partial<ReturnType<typeof useUserStore.getState>>)
    couponResponses = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/v1/coupons') return couponResponses.shift() ?? res(200, { valid: true, coupon: COUPON })
      return res(200, {})
    }))
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

  // The subtotal-revalidation effect (800 ms) fires once on mount with a coupon applied; let it settle so the identity
  // re-check is the only POST under test afterwards.
  async function mountSettled() {
    const r = renderHook(() => useCheckoutPage(settings))
    await advance(800)
    await flush()
    expect(couponPosts()).toHaveLength(1)
    return r.result
  }

  it('no request before 2.5 s, exactly one at 2.5 s, carrying phone + address', async () => {
    const result = await mountSettled()
    fillIdentity(result)
    await advance(2499)
    expect(couponPosts()).toHaveLength(1)
    await advance(1)
    const posts = couponPosts()
    expect(posts).toHaveLength(2)
    expect(posts[1]).toMatchObject({ code: 'PAHADI10', subtotal: 1000, phone: '9876543210', pincode: '248001', address: 'Flat 4, Test Building' })
  })

  it('a keystroke inside the window restarts the 2.5 s timer (one request, not one per keystroke)', async () => {
    const result = await mountSettled()
    fillIdentity(result)
    await advance(2000)
    act(() => { result.current.setAddrField('flat', 'Flat 4, Test Building, Lane 2') })
    await advance(2499)
    expect(couponPosts()).toHaveLength(1)   // still nothing: the edit at 2.0 s restarted the clock
    await advance(1)
    expect(couponPosts()).toHaveLength(2)
    expect(couponPosts()[1].address).toBe('Flat 4, Test Building, Lane 2')
  })

  it('the same identity is not re-checked twice; a changed identity is', async () => {
    const result = await mountSettled()
    fillIdentity(result)
    await advance(2500)
    expect(couponPosts()).toHaveLength(2)
    act(() => { result.current.setAddrField('city', 'Dehradun') })   // not part of the identity
    await advance(5000)
    expect(couponPosts()).toHaveLength(2)
    act(() => { result.current.setAddrField('phone', '9123456789') })
    await advance(2500)
    expect(couponPosts()).toHaveLength(3)
  })

  it('a definite 400 removes the coupon and shows the server reason; a 429 keeps it', async () => {
    couponResponses = [res(200, { valid: true, coupon: COUPON }), res(429, { error: 'Too many coupon checks' })]
    const result = await mountSettled()
    fillIdentity(result)
    await advance(2500)
    expect(useCartStore.getState().coupon).toEqual(COUPON)
    expect(result.current.couponError).toBe('')

    couponResponses = [res(400, { error: 'This coupon was already used at this address' })]
    act(() => { result.current.setAddrField('phone', '9123456789') })
    await advance(2500)
    expect(useCartStore.getState().coupon).toBeNull()
    expect(result.current.couponError).toBe('This coupon was already used at this address')
  })
})
