/**
 * validateCouponUserLimit.test.ts
 *
 * Tests for the per-customer usage limit (coupons.user_limit) in
 * validateCouponServer — a column that existed on the coupons table with
 * real values (both live coupons have user_limit=1) but was never actually
 * checked anywhere. Only the store-wide max_uses/uses_count check ran, so a
 * coupon meant to be "once per customer" behaved as "once ever, for the
 * whole store" instead.
 *
 * Separate file from validateCoupon.test.ts because this needs a
 * multi-table mock (coupons, then conditionally customers + coupon_usage)
 * rather than that file's single-table coupons-only chain.
 *
 * Cases covered:
 *   • No phone provided — per-customer check is skipped (cart-page pre-check
 *     before an address is known); coupon is still valid via max_uses alone.
 *   • user_limit is null — check skipped regardless of phone (unlimited per
 *     customer, existing behaviour unchanged).
 *   • Phone provided but no matching customer (brand-new customer) — 0 prior
 *     uses assumed, coupon is valid.
 *   • Phone matches a customer who has already used the coupon user_limit
 *     times — rejected with a clear, non-committal error message.
 *   • Phone matches a customer under their per-customer limit — valid.
 *   • Phone normalisation — a phone with +91/formatting still matches the
 *     stored normalized_phone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock supabase BEFORE importing the module under test ─────────────────
// Three tables get queried depending on the path: coupons (always),
// customers and coupon_usage (only when user_limit != null && phone given).

const mockCouponSingle = vi.fn()
const mockCouponEq2    = vi.fn(() => ({ single: mockCouponSingle }))
const mockCouponEq1    = vi.fn(() => ({ eq: mockCouponEq2 }))
const mockCouponSelect = vi.fn(() => ({ eq: mockCouponEq1 }))

const mockCustMaybeSingle = vi.fn()
const mockCustEq          = vi.fn(() => ({ maybeSingle: mockCustMaybeSingle }))
const mockCustSelect      = vi.fn(() => ({ eq: mockCustEq }))

const mockUsageEq2   = vi.fn()
const mockUsageEq1   = vi.fn(() => ({ eq: mockUsageEq2 }))
const mockUsageSelect = vi.fn(() => ({ eq: mockUsageEq1 }))

const mockFrom = vi.fn((table: string) => {
  if (table === 'coupons')      return { select: mockCouponSelect }
  if (table === 'customers')    return { select: mockCustSelect }
  if (table === 'coupon_usage') return { select: mockUsageSelect }
  throw new Error(`unexpected table in test: ${table}`)
})

vi.mock('@/lib/supabase', () => ({
  supabase:         { from: vi.fn() },
  getServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

import { validateCouponServer } from '@/lib/services/pricingService'

function couponRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    code: 'TESTCODE',
    type: 'flat',
    value: 100,
    max_uses: null,
    uses_count: 0,
    min_order: null,
    expires_at: null,
    max_discount: null,
    user_limit: null,
    is_active: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('validateCouponServer — per-customer usage limit (user_limit)', () => {
  it('skips the per-customer check when no phone is provided (e.g. cart-page pre-check)', async () => {
    mockCouponSingle.mockResolvedValueOnce({ data: couponRecord({ user_limit: 1 }), error: null })
    const result = await validateCouponServer('WELCOME50', 500) // no phone arg
    expect(result.valid).toBe(true)
    expect(mockFrom).not.toHaveBeenCalledWith('customers')
    expect(mockFrom).not.toHaveBeenCalledWith('coupon_usage')
  })

  it('skips the check entirely when user_limit is null, even with a phone given', async () => {
    mockCouponSingle.mockResolvedValueOnce({ data: couponRecord({ user_limit: null }), error: null })
    const result = await validateCouponServer('UNLIMITED', 500, '9876543210')
    expect(result.valid).toBe(true)
    expect(mockFrom).not.toHaveBeenCalledWith('customers')
  })

  it('is valid for a brand-new customer (no matching row in customers) — 0 prior uses assumed', async () => {
    mockCouponSingle.mockResolvedValueOnce({ data: couponRecord({ user_limit: 1 }), error: null })
    mockCustMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const result = await validateCouponServer('WELCOME50', 500, '9876543210')
    expect(result.valid).toBe(true)
    expect(mockFrom).not.toHaveBeenCalledWith('coupon_usage') // no customer id to check usage against
  })

  it('rejects when the matched customer has already reached their per-customer limit', async () => {
    mockCouponSingle.mockResolvedValueOnce({ data: couponRecord({ id: 7, user_limit: 1 }), error: null })
    mockCustMaybeSingle.mockResolvedValueOnce({ data: { id: 42 }, error: null })
    mockUsageEq2.mockResolvedValueOnce({ count: 1, error: null })

    const result = await validateCouponServer('WELCOME50', 500, '9876543210')

    expect(result.valid).toBe(false)
    // Deliberately does not say "usage limit reached" (that phrase means the
    // store-wide max_uses cap) — this is a different, per-customer reason.
    expect(result.error).toBe('You have already used this coupon')
    // Usage is checked against this exact customer + this exact coupon.
    expect(mockUsageEq1).toHaveBeenCalledWith('coupon_id', 7)
    expect(mockUsageEq2).toHaveBeenCalledWith('customer_id', 42)
  })

  it('is valid when the matched customer is still under their per-customer limit', async () => {
    mockCouponSingle.mockResolvedValueOnce({ data: couponRecord({ user_limit: 3 }), error: null })
    mockCustMaybeSingle.mockResolvedValueOnce({ data: { id: 42 }, error: null })
    mockUsageEq2.mockResolvedValueOnce({ count: 2, error: null })

    const result = await validateCouponServer('LOYAL3X', 500, '9876543210')
    expect(result.valid).toBe(true)
  })

  it('normalizes a phone with +91 / formatting before matching against normalized_phone', async () => {
    mockCouponSingle.mockResolvedValueOnce({ data: couponRecord({ user_limit: 1 }), error: null })
    mockCustMaybeSingle.mockResolvedValueOnce({ data: null, error: null })

    await validateCouponServer('WELCOME50', 500, '+91 98765-43210')

    expect(mockCustEq).toHaveBeenCalledWith('normalized_phone', '9876543210')
  })
})
