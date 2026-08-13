/**
 * syncCustomerProfileFailures.test.ts
 *
 * BUG FIX covered here: syncCustomerProfile()'s two failure paths (the
 * initial customer lookup, and the auto-create insert for a first-time
 * user) both used to swallow errors to a bare `null`/fallthrough with zero
 * logging — the exact reason a live "Profile not found" 404 on
 * /api/wishlist for a real logged-in user was untraceable: nothing in
 * Vercel's logs distinguished "user genuinely has no profile" from
 * "we tried to create one and it silently failed" from "the lookup itself
 * timed out and we may be about to create a duplicate customer row".
 *
 * These tests pin down the two fixed behaviors so this can't quietly
 * regress back to a bare `.catch(() => null)`:
 *   1. A lookup failure now throws (surfaces as 401/503 to the route caller)
 *      instead of silently falling through to the insert path — a lookup
 *      failure is NOT the same thing as "no existing customer found", and
 *      treating it that way risked creating duplicate customer rows on a
 *      transient Supabase blip.
 *   2. An insert failure is now logged via captureError with alert:true —
 *      still returns null (unchanged external behavior / no route
 *      contract change), but now observable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const captureErrorMock = vi.fn()

beforeEach(() => {
  vi.resetModules()
  vi.doMock('@/lib/logger', () => ({
    captureError: captureErrorMock,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), metric: vi.fn() },
  }))
  captureErrorMock.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

describe('syncCustomerProfile — lookup failure', () => {
  it('throws (does not silently fall through to insert) when the customer lookup itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network timeout')))
    const { syncCustomerProfile } = await import('@/lib/api/serverUtils')

    await expect(
      syncCustomerProfile({ id: 'auth-1', email: 'a@x.com' }),
    ).rejects.toThrow('network timeout')

    expect(captureErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'syncCustomerProfile.lookup', userId: 'auth-1' }),
    )
  })
})

describe('syncCustomerProfile — auto-create failure', () => {
  it('logs via captureError with alert:true and still returns null when the create-on-first-use insert fails', async () => {
    const fetchMock = vi.fn()
      // 1) lookup — no existing customer
      .mockResolvedValueOnce(jsonResponse(200, []))
      // 2) insert — fails (e.g. unique constraint clash on email against a different auth_user_id)
      .mockResolvedValueOnce(jsonResponse(409, { message: 'duplicate key value violates unique constraint' }))
    vi.stubGlobal('fetch', fetchMock)

    const { syncCustomerProfile } = await import('@/lib/api/serverUtils')
    const result = await syncCustomerProfile({ id: 'auth-2', email: 'b@x.com' })

    expect(result).toBeNull()
    expect(captureErrorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'syncCustomerProfile.create', userId: 'auth-2', alert: true }),
    )
  })

  it('returns the created row on success and does not log anything', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(201, [{ id: 'cust-new', auth_user_id: 'auth-3', email: 'c@x.com' }]))
    vi.stubGlobal('fetch', fetchMock)

    const { syncCustomerProfile } = await import('@/lib/api/serverUtils')
    const result = await syncCustomerProfile({ id: 'auth-3', email: 'c@x.com' })

    expect(result).toEqual({ id: 'cust-new', auth_user_id: 'auth-3', email: 'c@x.com' })
    expect(captureErrorMock).not.toHaveBeenCalled()
  })
})
