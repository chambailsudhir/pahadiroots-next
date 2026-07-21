import type { CartItem, AppliedCoupon, SiteSettings } from '@/types'
import { calcGST, asNumber } from '@/lib/utils'
import { getServiceClient } from '@/lib/supabase'

export interface PriceSummary {
  subtotal:        number   // sum of (price * qty)
  discount:        number   // coupon discount
  shipping:        number   // 0 or flat charge
  gstTotal:        number   // total GST included in items
  prepaidDiscount: number   // additional % off for prepaid
  loyaltyDiscount: number   // 🪙 coins redemption discount
  total:           number   // final payable
  freeShippingMin:        number
  isFreeShipping:         boolean
  remainingForFreeShip:   number
  // The value compared against freeShippingMin to determine isFreeShipping.
  // Use this — NOT subtotal — for the progress bar so the bar always agrees
  // with the engine (subtotal ignores coupon/loyalty discounts; afterDiscount does not).
  progressBase:           number
}

export function calcPriceSummary(
  items: CartItem[],
  settings: SiteSettings,
  coupon: AppliedCoupon | null,
  paymentMethod: 'razorpay' | 'cod' = 'cod',
  loyaltyDiscount = 0,           // ₹ coins redemption — passed from checkout state
): PriceSummary {
  // NOTE: freeShippingMin fallback — an earlier direct DB query showed
  // '0'; a later admin-panel screenshot showed the real current value is
  // '500'. Both numbers only matter if this setting is ever missing
  // entirely (the live DB row already exists), but kept accurate to
  // avoid the same drift happening a third time. flat_shipping_charge's
  // 99 fallback already matches the confirmed real admin value.
  const freeShippingMin  = asNumber(settings.free_shipping_min, 500)
  const flatShipping     = asNumber(settings.flat_shipping_charge, 99)
  const prepaidPct       = asNumber(settings.prepaid_discount_pct, 5)

  const subtotal = Math.round(items.reduce((sum, item) => sum + item.price * item.qty, 0))

  const discount = coupon ? coupon.discount : 0

  const afterDiscount = Math.max(0, subtotal - discount - loyaltyDiscount)

  const isFreeShipping = afterDiscount >= freeShippingMin
  const shipping       = isFreeShipping ? 0 : flatShipping

  const gstTotal = items.reduce(
    (sum, item) => sum + calcGST(item.price, item.gstRate, item.qty), 0
  )

  const prepaidDiscount = paymentMethod === 'razorpay'
    ? Math.round(afterDiscount * prepaidPct / 100)
    : 0

  // BUG FIX: total could go negative if an admin sets prepaid_discount_pct > 100
  // (e.g. 150%). afterDiscount=100, prepaidDiscount=150 → total=-50.
  // A negative total is passed to Razorpay as a negative paise amount which
  // causes the API call to fail with a cryptic error. Clamp to 0.
  const total = Math.max(0, afterDiscount + shipping - prepaidDiscount)

  return {
    subtotal,
    discount,
    loyaltyDiscount,
    shipping,
    gstTotal,
    prepaidDiscount,
    total,
    freeShippingMin,
    isFreeShipping,
    remainingForFreeShip: Math.max(0, freeShippingMin - afterDiscount),
    // afterDiscount is what isFreeShipping actually compares — expose it so the
    // progress bar uses the same base value and can never disagree with the engine.
    progressBase: afterDiscount,
  }
}

// Server-side: validate coupon code against DB
export async function validateCouponServer(
  code: string,
  subtotal: number
): Promise<{ valid: boolean; coupon?: AppliedCoupon; error?: string }> {
  const db = getServiceClient()

  const { data, error } = await db
    .from('coupons')
    .select('*')
    .eq('code', code.toUpperCase().trim())
    .eq('is_active', true)
    .single()

  if (error || !data) return { valid: false, error: 'Invalid or expired coupon' }

  // Check usage limit
  // BUG FIX: the original check was `if (data.max_uses && ...)`.
  // When an admin sets max_uses = 0 (intended to mean "disable this coupon
  // immediately"), the JS truthiness check treats 0 as falsy and skips the
  // guard entirely — the coupon passes as valid and is applied forever.
  // Fix: use `!= null` (strict null/undefined check) so 0 is treated as a
  // real limit. orderService.ts already uses this pattern correctly.
  if (data.max_uses != null && data.uses_count >= data.max_uses) {
    return { valid: false, error: 'Coupon usage limit reached' }
  }

  // Check min order value
  if (data.min_order && subtotal < data.min_order) {
    return {
      valid: false,
      error: `Minimum order ₹${data.min_order} required for this coupon`,
    }
  }

  // Check expiry
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { valid: false, error: 'Coupon has expired' }
  }

  // Use a safe finite cap instead of Infinity — Math.min(x, Infinity) is valid JS
  // but if data.max_discount is ever null/undefined AND the subtotal is very large,
  // Math.round(Infinity) = Infinity which flows into total as -Infinity.
  // Cap at subtotal (can never discount more than the order value).
  const MAX_DISCOUNT_FALLBACK = subtotal
  const discount = data.type === 'percent'
    ? Math.min(Math.round(subtotal * data.value / 100), data.max_discount ?? MAX_DISCOUNT_FALLBACK)
    : Math.round(data.value)  // round flat values — DB may store non-integer (e.g. 49.99)

  return {
    valid: true,
    coupon: {
      code:     data.code,
      discount: Math.round(discount),
      type:     data.type,
      percent:  data.type === 'percent' ? data.value : undefined,
    },
  }
}
