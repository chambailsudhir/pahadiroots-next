/**
 * validateCoupon.test.ts
 *
 * Tests for validateCouponServer — the server-side coupon validation function.
 * We mock @/lib/supabase so tests run without real DB credentials.
 *
 * Cases covered:
 *   • Invalid coupon code (DB returns error/no data)
 *   • Usage limit reached (uses_count >= max_uses)
 *   • Minimum order value not met
 *   • Expired coupon (expires_at in the past)
 *   • Valid flat coupon — correct shape returned
 *   • Valid flat coupon — non-integer DB value is rounded (bug regression)
 *   • Valid percent coupon — with and without max_discount cap
 *   • Percent coupon capped at subtotal fallback when max_discount is null
 *   • Percent discount is always rounded to integer
 *   • Code normalisation — lowercase + whitespace trimmed before DB query
 *   • DB query is called with the correct normalised code (mock call assertion)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock supabase BEFORE importing the module under test ─────────────────────
// validateCouponServer calls getServiceClient() internally. We intercept it so
// no real DB connection is needed and we can inspect call arguments.

const mockSingle = vi.fn()
const mockEq2    = vi.fn(() => ({ single: mockSingle }))
const mockEq1    = vi.fn(() => ({ eq: mockEq2 }))
const mockSelect = vi.fn(() => ({ eq: mockEq1 }))
const mockFrom   = vi.fn(() => ({ select: mockSelect }))

vi.mock('@/lib/supabase', () => ({
  supabase:         { from: vi.fn() },
  getServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { validateCouponServer } from '@/lib/services/pricingService'

// ─── Helper to set the DB response ────────────────────────────────────────────

function mockCoupon(data: Record<string, unknown> | null, error: unknown = null) {
  mockSingle.mockResolvedValueOnce({ data, error })
}

// Full coupon record with safe defaults — override only what matters in each test.
function couponRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: 'TESTCODE',
    type: 'flat',
    value: 100,
    max_uses: null,
    uses_count: 0,
    min_order: null,
    expires_at: null,
    max_discount: null,
    is_active: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── DB query call verification ───────────────────────────────────────────────

describe('validateCouponServer — DB query correctness', () => {
  it('queries the coupons table with the correct normalised code', async () => {
    mockCoupon(null, { message: 'not found' })
    await validateCouponServer('  welcome10  ', 500)

    // Verify the code is uppercased and trimmed before being sent to DB
    expect(mockFrom).toHaveBeenCalledWith('coupons')
    expect(mockSelect).toHaveBeenCalledWith('*')
    expect(mockEq1).toHaveBeenCalledWith('code', 'WELCOME10') // uppercased + trimmed
    expect(mockEq2).toHaveBeenCalledWith('is_active', true)   // only active coupons
  })

  it('uppercases a mixed-case code before querying', async () => {
    mockCoupon(null, { message: 'not found' })
    await validateCouponServer('Pahadi10', 500)
    expect(mockEq1).toHaveBeenCalledWith('code', 'PAHADI10')
  })

  it('trims surrounding whitespace from code before querying', async () => {
    mockCoupon(null, { message: 'not found' })
    await validateCouponServer('  SAVE50  ', 500)
    expect(mockEq1).toHaveBeenCalledWith('code', 'SAVE50')
  })
})

// ─── Invalid / not found ──────────────────────────────────────────────────────

describe('validateCouponServer — invalid coupon', () => {
  it('returns invalid when DB returns an error', async () => {
    mockCoupon(null, { message: 'not found' })
    const result = await validateCouponServer('BADCODE', 500)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Invalid or expired coupon')
    expect(result.coupon).toBeUndefined()
  })

  it('returns invalid when DB returns null data with no error', async () => {
    mockCoupon(null, null)
    const result = await validateCouponServer('NOCODE', 500)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Invalid or expired coupon')
  })
})

// ─── Usage limit ──────────────────────────────────────────────────────────────

describe('validateCouponServer — usage limit', () => {
  it('returns invalid when usage cap is exactly reached (uses_count === max_uses)', async () => {
    mockCoupon(couponRecord({ max_uses: 10, uses_count: 10 }))
    const result = await validateCouponServer('MAXED', 500)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Coupon usage limit reached')
  })

  it('returns invalid when uses_count exceeds max_uses', async () => {
    mockCoupon(couponRecord({ max_uses: 5, uses_count: 7 }))
    const result = await validateCouponServer('OVER', 500)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Coupon usage limit reached')
  })

  it('is valid when uses_count is one below max_uses', async () => {
    mockCoupon(couponRecord({ max_uses: 10, uses_count: 9 }))
    const result = await validateCouponServer('NEARLYTHERE', 500)
    expect(result.valid).toBe(true)
  })

  it('skips usage check and is valid when max_uses is null (unlimited coupon)', async () => {
    mockCoupon(couponRecord({ max_uses: null, uses_count: 9999 }))
    const result = await validateCouponServer('UNLIMITED', 500)
    expect(result.valid).toBe(true)
  })

  // BUG REGRESSION: the original guard was `if (data.max_uses && ...)`.
  // max_uses = 0 is falsy in JS, so the check was skipped entirely and the
  // coupon passed as valid — even though the admin set it to 0 specifically
  // to immediately disable it. The fix uses `!= null` so 0 is treated as a
  // real limit (0 uses allowed → always rejected once uses_count >= 0).
  it('treats max_uses = 0 as "disabled" — rejects even when uses_count is 0', async () => {
    mockCoupon(couponRecord({ max_uses: 0, uses_count: 0 }))
    const result = await validateCouponServer('DISABLED', 500)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Coupon usage limit reached')
  })
})

// ─── Minimum order ────────────────────────────────────────────────────────────

describe('validateCouponServer — minimum order', () => {
  it('returns invalid when subtotal is below min_order', async () => {
    mockCoupon(couponRecord({ min_order: 500 }))
    const result = await validateCouponServer('MIN500', 400)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('500') // error message references the threshold
  })

  it('error message cites the exact minimum order amount', async () => {
    mockCoupon(couponRecord({ min_order: 750 }))
    const result = await validateCouponServer('MIN750', 500)
    expect(result.error).toBe('Minimum order ₹750 required for this coupon')
  })

  it('is valid when subtotal exactly meets min_order', async () => {
    mockCoupon(couponRecord({ min_order: 500 }))
    const result = await validateCouponServer('MIN500', 500)
    expect(result.valid).toBe(true)
  })

  it('is valid when subtotal is above min_order', async () => {
    mockCoupon(couponRecord({ min_order: 500 }))
    const result = await validateCouponServer('MIN500', 1000)
    expect(result.valid).toBe(true)
  })

  it('skips min_order check when min_order is null', async () => {
    mockCoupon(couponRecord({ min_order: null }))
    const result = await validateCouponServer('NMIN', 1) // tiny subtotal — still valid
    expect(result.valid).toBe(true)
  })
})

// ─── Expiry ───────────────────────────────────────────────────────────────────

describe('validateCouponServer — expiry', () => {
  it('returns invalid for a clearly expired coupon', async () => {
    mockCoupon(couponRecord({ expires_at: '2020-01-01T00:00:00Z' }))
    const result = await validateCouponServer('EXPIRED', 500)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Coupon has expired')
  })

  it('is valid for a coupon expiring in the far future', async () => {
    mockCoupon(couponRecord({ expires_at: '2099-12-31T23:59:59Z' }))
    const result = await validateCouponServer('FUTURE', 500)
    expect(result.valid).toBe(true)
  })

  it('skips expiry check and is valid when expires_at is null (no expiry set)', async () => {
    mockCoupon(couponRecord({ expires_at: null }))
    const result = await validateCouponServer('NOEXP', 500)
    expect(result.valid).toBe(true)
  })
})

// ─── Valid flat coupon ────────────────────────────────────────────────────────

describe('validateCouponServer — valid flat coupon', () => {
  it('returns the correct AppliedCoupon shape', async () => {
    mockCoupon(couponRecord({ code: 'FLAT100', type: 'flat', value: 100 }))
    const result = await validateCouponServer('FLAT100', 500)

    expect(result.valid).toBe(true)
    expect(result.coupon).toMatchObject({
      code:    'FLAT100',
      discount: 100,
      type:    'flat',
    })
    // flat coupons must NOT set percent
    expect(result.coupon?.percent).toBeUndefined()
  })

  it('rounds non-integer flat discount values from DB — bug regression', async () => {
    // DB may store e.g. 49.99 (legacy data). Must be rounded to integer paise.
    // BUG WAS: `discount: data.value` returned 49.99 raw; fix: Math.round(data.value)
    mockCoupon(couponRecord({ value: 49.99 }))
    const result = await validateCouponServer('ODD', 500)

    expect(result.valid).toBe(true)
    expect(result.coupon?.discount).toBe(50) // Math.round(49.99) = 50
    expect(Number.isInteger(result.coupon?.discount)).toBe(true)
  })

  it('rounds .5 values correctly (banker rounding edge case)', async () => {
    mockCoupon(couponRecord({ value: 50.5 }))
    const result = await validateCouponServer('HALF', 500)
    expect(result.valid).toBe(true)
    expect(Number.isInteger(result.coupon?.discount)).toBe(true)
  })

  it('flat coupon discount is not capped by max_discount (max_discount is percent-only)', async () => {
    // max_discount field is only meaningful for percent coupons.
    // A flat ₹200 coupon with max_discount=50 should still give ₹200 off.
    mockCoupon(couponRecord({ value: 200, max_discount: 50 }))
    const result = await validateCouponServer('FLAT200', 500)
    expect(result.valid).toBe(true)
    expect(result.coupon?.discount).toBe(200)
  })
})

// ─── Valid percent coupon ─────────────────────────────────────────────────────

describe('validateCouponServer — valid percent coupon', () => {
  it('calculates percent discount from subtotal and returns correct shape', async () => {
    mockCoupon(couponRecord({ code: 'PCT10', type: 'percent', value: 10, max_discount: 500 }))
    // 10% of 1000 = 100
    const result = await validateCouponServer('PCT10', 1000)

    expect(result.valid).toBe(true)
    expect(result.coupon).toMatchObject({
      code:    'PCT10',
      discount: 100,
      type:    'percent',
      percent:  10,
    })
  })

  it('caps discount at max_discount when percent would exceed it', async () => {
    // 20% of 1000 = 200, but max_discount=150 → capped at 150
    mockCoupon(couponRecord({ type: 'percent', value: 20, max_discount: 150 }))
    const result = await validateCouponServer('CAPPED', 1000)

    expect(result.valid).toBe(true)
    expect(result.coupon?.discount).toBe(150)
  })

  it('applies full percent when discount is below max_discount', async () => {
    // 10% of 500 = 50, max_discount=200 → not capped, discount=50
    mockCoupon(couponRecord({ type: 'percent', value: 10, max_discount: 200 }))
    const result = await validateCouponServer('NOTCAPPED', 500)

    expect(result.valid).toBe(true)
    expect(result.coupon?.discount).toBe(50)
  })

  it('uses subtotal as fallback cap when max_discount is null — prevents Infinity/NaN', async () => {
    // Bug guard: Math.min(x, null ?? subtotal) = Math.min(x, subtotal).
    // Without this, if subtotal is very large and max_discount is null,
    // Math.round(Infinity) would produce Infinity in the total.
    mockCoupon(couponRecord({ type: 'percent', value: 50, max_discount: null }))
    // 50% of 200 = 100, subtotal fallback = 200, so discount = 100 (not capped)
    const result = await validateCouponServer('NOMAX', 200)

    expect(result.valid).toBe(true)
    expect(result.coupon?.discount).toBe(100)
    // Critically: discount must never exceed subtotal
    expect(result.coupon!.discount).toBeLessThanOrEqual(200)
  })

  it('discount never exceeds subtotal even with 100% coupon and null max_discount', async () => {
    // 100% of 500 = 500 == subtotal → Math.min(500, 500) = 500
    mockCoupon(couponRecord({ type: 'percent', value: 100, max_discount: null }))
    const subtotal = 500
    const result = await validateCouponServer('FREE', subtotal)

    expect(result.valid).toBe(true)
    expect(result.coupon!.discount).toBeLessThanOrEqual(subtotal)
    expect(Number.isFinite(result.coupon!.discount)).toBe(true)
  })

  it('rounds percent discount to nearest integer — no fractional paise', async () => {
    // 10% of 333 = 33.3 → Math.round = 33
    mockCoupon(couponRecord({ type: 'percent', value: 10, max_discount: 9999 }))
    const result = await validateCouponServer('ROUND', 333)

    expect(result.valid).toBe(true)
    expect(result.coupon?.discount).toBe(33)
    expect(Number.isInteger(result.coupon?.discount)).toBe(true)
  })
})

// ─── Validation order (priority of checks) ───────────────────────────────────

describe('validateCouponServer — check priority', () => {
  it('usage limit check fires before expiry check', async () => {
    // Coupon is both maxed-out AND expired — usage error should be returned
    // (usage is checked first in the implementation)
    mockCoupon(couponRecord({
      max_uses: 5, uses_count: 5,
      expires_at: '2020-01-01T00:00:00Z',
    }))
    const result = await validateCouponServer('MAXEDANDEXPIRED', 500)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Coupon usage limit reached')
  })

  it('min_order check fires before expiry check', async () => {
    // Coupon has high min order AND is expired — min order error first
    mockCoupon(couponRecord({
      min_order: 1000,
      expires_at: '2020-01-01T00:00:00Z',
    }))
    const result = await validateCouponServer('MINANDEXPIRED', 500)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('1000')
  })
})
