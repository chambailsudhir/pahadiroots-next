/**
 * pricingService.test.ts
 *
 * Covers every financial path in calcPriceSummary:
 *   • Free-shipping threshold
 *   • Flat coupon vs percent coupon
 *   • GST total aggregation
 *   • Prepaid discount (razorpay vs cod)
 *   • Loyalty coin deduction
 *   • Correct `total` in all combinations
 *   • Edge: empty cart, zero-price items, coupon > subtotal
 *
 * Note: pricingService.ts imports supabase for the server-side validateCouponServer
 * function. We mock the module so tests can run without real DB credentials.
 * Only calcPriceSummary (a pure function) is tested here — validateCouponServer
 * requires integration tests with a real or stubbed Supabase client.
 */

import { describe, it, expect, vi } from 'vitest'

// Mock supabase before any module that transitively imports it loads.
// calcPriceSummary is a pure function and never touches the DB itself.
vi.mock('@/lib/supabase', () => ({
  supabase:      { from: vi.fn() },
  getServiceClient: vi.fn(() => ({ from: vi.fn() })),
}))
import { calcPriceSummary } from '@/lib/services/pricingService'
import type { CartItem, AppliedCoupon, SiteSettings } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    productId:    '1',
    variantId:    'v1',
    name:         'Test Product',
    slug:         'test-product',
    image:        null,
    emoji:        null,
    size:         '250g',
    price:        200,
    mrp:          250,
    gstRate:      5,
    qty:          1,
    maxQty:       10,
    isOrganic:    false,
    isHimalayan:  false,
    isBestseller: false,
    ...overrides,
  }
}

function makeSettings(overrides: Partial<SiteSettings> = {}): SiteSettings {
  return {
    store_open:             'true',
    maintenance_message:    '',
    ann_hide:               'false',
    ann_text:               '',
    ticker_hide:            'false',
    ticker_1_text: '', ticker_2_text: '', ticker_3_text: '', ticker_4_text: '', ticker_5_text: '',
    ticker_1_hide: 'false', ticker_2_hide: 'false', ticker_3_hide: 'false',
    ticker_4_hide: 'false', ticker_5_hide: 'false',
    free_shipping_min:      '799',
    flat_shipping_charge:   '99',
    prepaid_discount_pct:   '5',
    whatsapp_number:        '',
    contact_email:          '',
    contact_phone:          '',
    contact_address:        '',
    instagram_url:          '',
    facebook_url:           '',
    youtube_url:            '',
    order_email_enabled:    'false',
    admin_notify_email:     '',
    show_trust_bar:         'true',
    show_best_sellers:      'true',
    show_new_arrivals:      'true',
    show_state_stories:     'true',
    show_brand_story:       'true',
    show_region_story:      'true',
    show_origin_stories:    'true',
    show_life_in_mountains: 'true',
    show_reviews_section:   'true',
    show_newsletter_bar:    'true',
    show_blog_section:      'true',
    show_wishlist:          'true',
    show_reviews_on_pdp:    'true',
    show_related_products:  'true',
    show_track_order_page:  'true',
    show_blog:              'true',
    catalogue_visible:      'true',
    featured_collection_slug: '',
    cod_enabled:            'true',
    cod_max_value:          '3000',
    cod_max_active_orders:  '3',
    ...overrides,
  } as SiteSettings
}

const DEFAULT_SETTINGS = makeSettings()

// ─── Empty cart ───────────────────────────────────────────────────────────────

describe('calcPriceSummary — empty cart', () => {
  it('returns all zeros and adds shipping when below threshold', () => {
    const result = calcPriceSummary([], DEFAULT_SETTINGS, null)
    expect(result.subtotal).toBe(0)
    expect(result.discount).toBe(0)
    expect(result.gstTotal).toBe(0)
    expect(result.prepaidDiscount).toBe(0)
    // 0 < 799 → shipping applied
    expect(result.shipping).toBe(99)
    expect(result.isFreeShipping).toBe(false)
    expect(result.total).toBe(99)
  })
})

// ─── Shipping threshold ───────────────────────────────────────────────────────

describe('calcPriceSummary — free shipping threshold', () => {
  it('charges shipping when subtotal is below threshold', () => {
    const items = [makeItem({ price: 500, qty: 1 })]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    expect(result.isFreeShipping).toBe(false)
    expect(result.shipping).toBe(99)
    expect(result.remainingForFreeShip).toBe(299) // 799 - 500
  })

  it('unlocks free shipping exactly at the threshold', () => {
    const items = [makeItem({ price: 799, qty: 1 })]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    expect(result.isFreeShipping).toBe(true)
    expect(result.shipping).toBe(0)
    expect(result.remainingForFreeShip).toBe(0)
  })

  it('unlocks free shipping above the threshold', () => {
    const items = [makeItem({ price: 1000, qty: 1 })]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    expect(result.isFreeShipping).toBe(true)
    expect(result.shipping).toBe(0)
  })

  it('evaluates free shipping AFTER coupon discount is applied', () => {
    // subtotal=900, flat coupon=200 → afterDiscount=700 < 799 → paid shipping
    const items   = [makeItem({ price: 900, qty: 1 })]
    const coupon: AppliedCoupon = { code: 'SAVE200', discount: 200, type: 'flat' }
    const result  = calcPriceSummary(items, DEFAULT_SETTINGS, coupon)
    expect(result.isFreeShipping).toBe(false)
    expect(result.shipping).toBe(99)
  })

  it('respects a custom free_shipping_min from settings', () => {
    const settings = makeSettings({ free_shipping_min: '499' })
    const items    = [makeItem({ price: 500, qty: 1 })]
    const result   = calcPriceSummary(items, settings, null)
    expect(result.isFreeShipping).toBe(true)
    expect(result.freeShippingMin).toBe(499)
  })
})

// ─── Flat coupon ──────────────────────────────────────────────────────────────

describe('calcPriceSummary — flat coupon', () => {
  it('subtracts the flat discount from subtotal', () => {
    const items  = [makeItem({ price: 500, qty: 1 })]
    const coupon: AppliedCoupon = { code: 'FLAT100', discount: 100, type: 'flat' }
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, coupon)
    expect(result.discount).toBe(100)
    // afterDiscount = 500 - 100 = 400 → shipping 99 → total 499
    expect(result.total).toBe(499)
  })

  it('does not let total go negative when coupon > subtotal', () => {
    const items  = [makeItem({ price: 100, qty: 1 })]
    const coupon: AppliedCoupon = { code: 'MEGA', discount: 500, type: 'flat' }
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, coupon)
    // afterDiscount = max(0, 100 - 500) = 0
    expect(result.total).toBeGreaterThanOrEqual(0)
  })
})

// ─── Percent coupon ───────────────────────────────────────────────────────────

describe('calcPriceSummary — percent coupon', () => {
  it('applies the pre-computed discount amount (not re-derived)', () => {
    // The service receives the already-resolved ₹ discount (computed by validateCouponServer).
    // It treats type:'percent' the same as 'flat' — just uses coupon.discount.
    const items  = [makeItem({ price: 1000, qty: 1 })]
    // 10% of 1000 = 100
    const coupon: AppliedCoupon = { code: 'PCT10', discount: 100, type: 'percent', percent: 10 }
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, coupon)
    expect(result.discount).toBe(100)
    // afterDiscount=900 ≥ 799 → free shipping → total=900
    expect(result.isFreeShipping).toBe(true)
    expect(result.total).toBe(900)
  })
})

// ─── GST total ────────────────────────────────────────────────────────────────

describe('calcPriceSummary — GST aggregation', () => {
  it('sums GST across multiple items with different rates', () => {
    const items = [
      makeItem({ price: 105, qty: 1, gstRate: 5 }),   // GST ≈ 5
      makeItem({ variantId: 'v2', price: 118, qty: 1, gstRate: 18 }), // GST = 18
    ]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    // gstTotal must equal sum of per-item GST
    const expectedGst = Math.round(105 * 5 / 105) + Math.round(118 * 18 / 118)
    expect(result.gstTotal).toBe(expectedGst)
  })

  it('scales GST with quantity — higher qty always yields higher or equal gstTotal', () => {
    // calcGST rounds per item call, so double.gstTotal is not always exactly single*2.
    // Verify monotonicity and that the formula is applied (not zero).
    const single = calcPriceSummary([makeItem({ qty: 1 })], DEFAULT_SETTINGS, null)
    const double = calcPriceSummary([makeItem({ qty: 2 })], DEFAULT_SETTINGS, null)
    expect(double.gstTotal).toBeGreaterThanOrEqual(single.gstTotal)
    expect(double.gstTotal).toBeGreaterThan(0)
    // Exact value: price=200, rate=5, qty=2 → round(200*2*5/105) = round(19.047) = 19
    expect(double.gstTotal).toBe(19)
  })

  it('returns integer GST — no fractional paise', () => {
    const items  = [makeItem({ price: 99, qty: 3, gstRate: 5 })]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    expect(Number.isInteger(result.gstTotal)).toBe(true)
  })
})

// ─── Prepaid discount ─────────────────────────────────────────────────────────

describe('calcPriceSummary — prepaid discount', () => {
  it('applies prepaid discount for razorpay payment', () => {
    const items  = [makeItem({ price: 1000, qty: 1 })]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null, 'razorpay')
    // afterDiscount=1000, prepaidPct=5 → prepaidDiscount=50
    expect(result.prepaidDiscount).toBe(50)
    // isFreeShipping=true, total = 1000 - 50 = 950
    expect(result.total).toBe(950)
  })

  it('applies NO prepaid discount for COD payment', () => {
    const items  = [makeItem({ price: 1000, qty: 1 })]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null, 'cod')
    expect(result.prepaidDiscount).toBe(0)
    expect(result.total).toBe(1000)
  })

  it('calculates prepaid discount AFTER coupon, not on full subtotal', () => {
    const items  = [makeItem({ price: 1000, qty: 1 })]
    const coupon: AppliedCoupon = { code: 'FLAT200', discount: 200, type: 'flat' }
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, coupon, 'razorpay')
    // afterDiscount = 1000 - 200 = 800, prepaid 5% of 800 = 40
    expect(result.prepaidDiscount).toBe(40)
  })

  it('respects custom prepaid_discount_pct from settings', () => {
    const settings = makeSettings({ prepaid_discount_pct: '10' })
    const items    = [makeItem({ price: 1000, qty: 1 })]
    const result   = calcPriceSummary(items, settings, null, 'razorpay')
    expect(result.prepaidDiscount).toBe(100) // 10% of 1000
  })
})

// ─── Loyalty discount ─────────────────────────────────────────────────────────

describe('calcPriceSummary — loyalty coin deduction', () => {
  it('deducts loyalty coins from afterDiscount', () => {
    const items  = [makeItem({ price: 1000, qty: 1 })]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null, 'cod', 50)
    // afterDiscount = 1000 - 50 = 950 → isFreeShipping (950 ≥ 799) → total=950
    expect(result.loyaltyDiscount).toBe(50)
    expect(result.total).toBe(950)
  })

  it('loyalty coins count toward free shipping threshold', () => {
    // subtotal=850, coins=100 → afterDiscount=750 < 799 → paid shipping
    const items  = [makeItem({ price: 850, qty: 1 })]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null, 'cod', 100)
    expect(result.isFreeShipping).toBe(false)
    expect(result.shipping).toBe(99)
  })
})

// ─── Multi-item cart ──────────────────────────────────────────────────────────

describe('calcPriceSummary — multi-item cart', () => {
  it('correctly totals subtotal across items and quantities', () => {
    const items = [
      makeItem({ variantId: 'v1', price: 300, qty: 2 }),  // 600
      makeItem({ variantId: 'v2', price: 200, qty: 1 }),  // 200
    ]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    expect(result.subtotal).toBe(800)
    expect(result.isFreeShipping).toBe(true) // 800 ≥ 799
  })

  it('total equals subtotal + shipping - discount - prepaid when all combined', () => {
    const items  = [makeItem({ price: 2000, qty: 1 })]
    const coupon: AppliedCoupon = { code: 'FLAT100', discount: 100, type: 'flat' }
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, coupon, 'razorpay')
    // afterDiscount = 2000 - 100 = 1900
    // isFreeShipping = true (1900 ≥ 799), shipping = 0
    // prepaid = 5% of 1900 = 95
    // total = 1900 - 95 = 1805
    expect(result.total).toBe(result.subtotal - result.discount - result.prepaidDiscount)
  })
})

// ─── Edge cases not previously covered ────────────────────────────────────────

describe('calcPriceSummary — edge cases', () => {
  it('handles zero-price items — subtotal is 0, still charges shipping', () => {
    const items = [makeItem({ price: 0, qty: 2 })]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    expect(result.subtotal).toBe(0)
    expect(result.gstTotal).toBe(0)
    expect(result.isFreeShipping).toBe(false)
    expect(result.shipping).toBe(99)
    expect(result.total).toBe(99)
  })

  it('loyalty + coupon combined: both deducted from afterDiscount', () => {
    // subtotal=1000, coupon=200, loyalty=100 → afterDiscount=700 → shipping (700<799)
    const items  = [makeItem({ price: 1000, qty: 1 })]
    const coupon: AppliedCoupon = { code: 'C200', discount: 200, type: 'flat' }
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, coupon, 'cod', 100)
    expect(result.discount).toBe(200)
    expect(result.loyaltyDiscount).toBe(100)
    expect(result.isFreeShipping).toBe(false)     // 700 < 799
    expect(result.shipping).toBe(99)
    expect(result.total).toBe(700 + 99)           // afterDiscount + shipping
  })

  it('loyalty + coupon exceeding subtotal: total floored at shipping cost (never negative)', () => {
    // subtotal=100, coupon=80, loyalty=50 → afterDiscount=max(0,100-80-50)=0
    const items  = [makeItem({ price: 100, qty: 1 })]
    const coupon: AppliedCoupon = { code: 'BIG', discount: 80, type: 'flat' }
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, coupon, 'cod', 50)
    expect(result.total).toBeGreaterThanOrEqual(0)
    // afterDiscount=0 → isFreeShipping=false → shipping=99 → total=99
    expect(result.total).toBe(99)
  })

  it('progressBase equals afterDiscount — shipping bar uses same base as isFreeShipping', () => {
    const items  = [makeItem({ price: 1000, qty: 1 })]
    const coupon: AppliedCoupon = { code: 'C100', discount: 100, type: 'flat' }
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, coupon, 'cod', 50)
    // afterDiscount = 1000 - 100 - 50 = 850
    expect(result.progressBase).toBe(850)
    expect(result.isFreeShipping).toBe(true)  // 850 >= 799
  })

  it('remainingForFreeShip is 0 when isFreeShipping is true', () => {
    const items = [makeItem({ price: 1000, qty: 1 })]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    expect(result.isFreeShipping).toBe(true)
    expect(result.remainingForFreeShip).toBe(0)
  })

  it('qty=0 items contribute 0 to subtotal (degenerate input)', () => {
    const items = [makeItem({ price: 200, qty: 0 })]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    expect(result.subtotal).toBe(0)
  })

  it('prepaid discount applied on afterDiscount=0 yields 0 prepaid (no negative discounts)', () => {
    const items  = [makeItem({ price: 100, qty: 1 })]
    const coupon: AppliedCoupon = { code: 'FULL', discount: 100, type: 'flat' }
    // afterDiscount = max(0, 100-100) = 0 → prepaid 5% of 0 = 0
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, coupon, 'razorpay')
    expect(result.prepaidDiscount).toBe(0)
    expect(result.total).toBeGreaterThanOrEqual(0)
  })

  it('gstTotal is always an integer (sum of rounded per-item values)', () => {
    const items = [
      makeItem({ variantId: 'v1', price: 99,  qty: 3, gstRate: 5  }),
      makeItem({ variantId: 'v2', price: 199, qty: 2, gstRate: 12 }),
      makeItem({ variantId: 'v3', price: 499, qty: 1, gstRate: 18 }),
    ]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    expect(Number.isInteger(result.gstTotal)).toBe(true)
  })

  // BUG REGRESSION: if an admin sets prepaid_discount_pct > 100 (e.g. 150),
  // the old formula `total = afterDiscount + shipping - prepaidDiscount` could
  // go negative — e.g. afterDiscount=100, shipping=0, prepaidDiscount=150 →
  // total=-50. A negative total sent to Razorpay as paise causes a cryptic
  // API failure. The fix clamps total to Math.max(0, ...).
  it('clamps total to 0 when prepaid_discount_pct is absurdly high (> 100)', () => {
    const settings = makeSettings({ prepaid_discount_pct: '150', free_shipping_min: '0' })
    const items    = [makeItem({ price: 100, qty: 1 })]
    // afterDiscount=100, shipping=0, prepaidDiscount=round(100*150/100)=150
    // Without the clamp: total = 100 + 0 - 150 = -50  ← BUG
    // With the clamp:    total = max(0, -50) = 0       ← FIX
    const result = calcPriceSummary(items, settings, null, 'razorpay')
    expect(result.prepaidDiscount).toBe(150)
    expect(result.total).toBe(0)
    expect(result.total).toBeGreaterThanOrEqual(0)
  })
})

// UI FEATURE: MRP Total / Discount on MRP — the "was ₹X" product-level
// discount shown above Subtotal in the cart drawer, cart page, and
// checkout summary (distinct from a coupon discount, which is applied on
// top of subtotal separately).
describe('calcPriceSummary — MRP total / discount on MRP', () => {
  it('mrpTotal sums mrp*qty, mrpDiscount is the gap to subtotal', () => {
    // default makeItem: price=200, mrp=250
    const items  = [makeItem({ price: 200, mrp: 250, qty: 2 })]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    expect(result.subtotal).toBe(400)     // 200*2
    expect(result.mrpTotal).toBe(500)     // 250*2
    expect(result.mrpDiscount).toBe(100)  // 500-400
  })

  it('mrpDiscount is 0 when mrp equals price (no product-level discount)', () => {
    const items  = [makeItem({ price: 200, mrp: 200, qty: 1 })]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    expect(result.mrpTotal).toBe(200)
    expect(result.mrpDiscount).toBe(0)
  })

  it('mrpDiscount is never negative even if mrp is (incorrectly) set below price', () => {
    const items  = [makeItem({ price: 200, mrp: 150, qty: 1 })]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    // mrpTotal falls back to price (not the bogus lower mrp), so
    // mrpTotal >= subtotal always holds and mrpDiscount is never negative.
    expect(result.mrpTotal).toBe(200)
    expect(result.mrpDiscount).toBe(0)
  })

  it('sums correctly across a multi-item cart with mixed discounts', () => {
    const items = [
      makeItem({ variantId: 'v1', price: 200, mrp: 250, qty: 2 }), // mrp 500, price 400
      makeItem({ variantId: 'v2', price: 100, mrp: 100, qty: 1 }), // mrp 100, price 100 (no discount)
    ]
    const result = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    expect(result.subtotal).toBe(500)     // 400+100
    expect(result.mrpTotal).toBe(600)     // 500+100
    expect(result.mrpDiscount).toBe(100)
  })

  it('mrpTotal and mrpDiscount do not affect total — additive display fields only', () => {
    const items    = [makeItem({ price: 200, mrp: 250, qty: 1 })]
    const withMrp  = calcPriceSummary(items, DEFAULT_SETTINGS, null)
    const noMrp    = calcPriceSummary([makeItem({ price: 200, mrp: 200, qty: 1 })], DEFAULT_SETTINGS, null)
    // Same subtotal (200) → same total, regardless of what mrp is set to.
    expect(withMrp.total).toBe(noMrp.total)
  })
})

