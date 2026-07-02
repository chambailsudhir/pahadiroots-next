/**
 * useCheckoutPage.safeJsonParse.test.ts
 *
 * Regression test for a bug reported live from production screenshots: the
 * checkout error box displayed a raw JavaScript parser error to the customer —
 *
 *   ⚠ Unexpected token 'A', "An error o"... is not valid JSON
 *
 * Root cause: handlePlace called `await res.json()` on the /api/v1/orders
 * (and /api/v1/payments) response UNCONDITIONALLY, before checking `res.ok`.
 * When the server/platform returns a non-JSON body for any reason (an HTML
 * error page from a serverless function timeout/crash being the most likely
 * cause, given the response text starts with "An error o…", matching
 * Vercel's own platform error-page wording), `res.json()` throws a raw
 * SyntaxError that propagated straight to `setError(e.message)` — showing
 * cryptic internals to the customer mid-checkout instead of a clean message.
 *
 * This test does not attempt to reproduce *why* the server returned HTML
 * (that requires the live deployment's function logs) — it verifies the
 * CLIENT no longer breaks when it does.
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

// A response whose body is an HTML/plain-text platform error page, not JSON —
// simulating exactly what the screenshot showed.
function htmlErrorResponse(status = 500) {
  return {
    ok: false,
    status,
    text: async () => 'An error occurred with this application.\n\nNO_RESPONSE_FROM_FUNCTION',
    json: async () => { throw new SyntaxError("Unexpected token 'A', \"An error o\"... is not valid JSON") },
  }
}

describe('useCheckoutPage — safe JSON parsing on order placement', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart()
    useCartStore.setState({ _hasHydrated: true })
    useCartStore.getState().addItem(sampleItem)
    useUserStore.setState({ user: null } as Partial<ReturnType<typeof useUserStore.getState>>)
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('[BUG FIX] a non-JSON error response from /api/v1/orders shows a clean message, not a raw parser error', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(htmlErrorResponse(504))

    const { result } = renderHook(() => useCheckoutPage(settings))
    fillValidAddress(result)
    act(() => { result.current.setPayMethod?.('cod') })

    await act(async () => { await result.current.handlePlace() })

    expect(result.current.error).toBeTruthy()
    expect(result.current.error).not.toMatch(/Unexpected token/i)
    expect(result.current.error).not.toMatch(/is not valid JSON/i)
    expect(result.current.error).toMatch(/order save failed/i)
    expect(result.current.error).toContain('504')
  })
})
