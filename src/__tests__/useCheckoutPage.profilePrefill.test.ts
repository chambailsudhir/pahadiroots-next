/**
 * useCheckoutPage.profilePrefill.test.ts
 *
 * Regression tests for the checkout autofill fixes on the saved-address /
 * profile-prefill side (the OTHER half of the reported "autofill is slow"
 * issue — the pincode→city/state side is covered by
 * AddressForm.autofill.test.ts). This effect had ZERO test coverage before
 * this file.
 *
 *   1. [BUG FIX — unbounded wait] The background `/api/profile` fetch had no
 *      timeout — only cancelled on unmount. A slow/cold-started endpoint
 *      left the checkout form sitting unfilled for however long the network
 *      took, with no bound.
 *   2. [BUG FIX — no feedback] There was zero loading indicator while this
 *      fetch was in flight — the form just looked frozen. `profilePrefillLoading`
 *      is now exposed so the UI can show a "Loading your saved details…" status.
 *   3. `profilePrefillLoading` must clear on EVERY exit path — success, HTTP
 *      error, network error, and timeout — never get stuck "on".
 *   4. `profilePrefillLoading` must start `false` when the cache was already
 *      warm at mount (nothing is actually loading from the user's POV in
 *      that case — showing a spinner would be misleading).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCheckoutPage } from '@/hooks/useCheckoutPage'
import { useCartStore } from '@/store/cartStore'
import { useUserStore } from '@/store/userStore'
import type { SiteSettings } from '@/types'

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

// Control the cache read per-test; writeProfileCache is spied but otherwise a no-op.
const mockReadProfileCache = vi.fn()
vi.mock('@/lib/profileCache', () => ({
  readProfileCache:  () => mockReadProfileCache(),
  writeProfileCache: vi.fn(),
}))

const settings = {} as SiteSettings

function primeStores() {
  useCartStore.getState().clearCart()
  useCartStore.setState({ _hasHydrated: true })
  useUserStore.setState({ user: null } as Partial<ReturnType<typeof useUserStore.getState>>)
}

describe('useCheckoutPage — profile prefill loading & timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    primeStores()
    mockReadProfileCache.mockReturnValue(null) // cold cache by default
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts profilePrefillLoading=true when the cache is cold, and clears it on a successful fetch', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        profile: { first_name: 'Asha', last_name: 'Rana', phone: '9876543210',
                   address_line1: 'Flat 4', city: 'Dehradun', state: 'Uttarakhand', pincode: '248001' },
      }),
    })

    const { result } = renderHook(() => useCheckoutPage(settings))
    expect(result.current.profilePrefillLoading).toBe(true)

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(result.current.profilePrefillLoading).toBe(false)
    expect(result.current.addr.city).toBe('Dehradun')
  })

  it('[BUG FIX] starts profilePrefillLoading=false when the cache was already warm — nothing is actually loading', () => {
    mockReadProfileCache.mockReturnValue({
      ts: Date.now(),
      profile: { first_name: 'Asha', last_name: 'Rana', phone: '9876543210' },
      addresses: [{
        id: 'default', is_default: true, label: 'Home',
        name: 'Asha Rana', flat: 'Flat 4', area: '',
        city: 'Dehradun', state: 'Uttarakhand', pincode: '248001', phone: '9876543210',
      }],
    })
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}) // never resolves — irrelevant, shouldn't matter for the flag
    )

    const { result } = renderHook(() => useCheckoutPage(settings))
    expect(result.current.profilePrefillLoading).toBe(false)
  })

  it('[BUG FIX] a hung /api/profile request does not leave profilePrefillLoading stuck on — it times out', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: string, opts?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
    )

    const { result } = renderHook(() => useCheckoutPage(settings))
    expect(result.current.profilePrefillLoading).toBe(true)

    // Advance past the 6s internal timeout
    await act(async () => { await vi.advanceTimersByTimeAsync(6_001) })

    expect(result.current.profilePrefillLoading).toBe(false)
  })

  it('[BUG FIX] a network/HTTP error also clears profilePrefillLoading, not just success', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNRESET'))

    const { result } = renderHook(() => useCheckoutPage(settings))
    expect(result.current.profilePrefillLoading).toBe(true)

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(result.current.profilePrefillLoading).toBe(false)
  })
})
