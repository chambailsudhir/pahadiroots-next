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
}

export function calcPriceSummary(
  items: CartItem[],
  settings: SiteSettings,
  coupon: AppliedCoupon | null,
  paymentMethod: 'razorpay' | 'cod' = 'cod',
  loyaltyDiscount = 0,           // ₹ coins redemption — passed from checkout state
): PriceSummary {
  const freeShippingMin  = asNumber(settings.free_shipping_min, 799)
  const flatShipping     = asNumber(settings.flat_shipping_charge, 99)
  const prepaidPct       = asNumber(settings.prepaid_discount_pct, 5)

  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0)

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

  const total = afterDiscount + shipping - prepaidDiscount

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
  if (data.max_uses && data.uses_count >= data.max_uses) {
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

  const discount = data.type === 'percent'
    ? Math.min(Math.round(subtotal * data.value / 100), data.max_discount || Infinity)
    : data.value

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
