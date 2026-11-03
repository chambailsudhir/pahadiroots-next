import type { CartItem, AppliedCoupon, SiteSettings } from '@/types'
import { calcGST, asNumber } from '@/lib/utils'
import { FALLBACK_FREE_SHIPPING_MIN, FALLBACK_FLAT_SHIPPING } from '@/lib/siteSettingsHelpers'
import { getServiceClient } from '@/lib/supabase'
import { countPriorCouponUse, couponReuseProblem } from '@/lib/couponHistory'

export interface PriceSummary {
  subtotal:        number   // sum of (price * qty)
  mrpTotal:        number   // sum of (mrp * qty) — pre-discount "was" price
  mrpDiscount:     number   // mrpTotal - subtotal — product-level discount, distinct from a coupon
  discount:        number   // coupon discount
  shipping:        number   // 0 or flat charge
  gstTotal:        number   // total GST included in items
  prepaidDiscount: number   // additional % off for prepaid
  codSurcharge:    number   // flat COD handling fee -- folded into total, not shown as its own line at checkout
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
  // F-02: ONE fallback source (siteSettingsHelpers) shared with getSiteSettings DEFAULTS, the
  // cart hooks and every piece of shipping copy — they previously disagreed (₹500 here, 0 in
  // DEFAULTS, ₹799 in marketing text). Fallbacks only apply when the admin row is missing/blank.
  const freeShippingMin  = Math.max(0, asNumber(settings.free_shipping_min, FALLBACK_FREE_SHIPPING_MIN))
  const flatShipping     = Math.max(0, asNumber(settings.flat_shipping_charge, FALLBACK_FLAT_SHIPPING))
  const prepaidPct       = asNumber(settings.prepaid_discount_pct, 5)
  const codSurchargeAmt  = asNumber(settings.cod_surcharge_amount, 0)

  // F-16 (Oct 2026 audit) — ROUNDING POLICY, deliberate and shared by client and server:
  //   • Line prices may carry paise (e.g. ₹209.52). The order is priced in WHOLE RUPEES: the subtotal
  //     is the sum of exact line amounts rounded once. Coupons, loyalty, shipping and the prepaid
  //     discount are all whole-rupee amounts, so `total` is always an integer and the Razorpay amount
  //     (total × 100) is exact — no paise drift between what is shown, charged and stored.
  //   • Free shipping is tested AFTER coupon and loyalty discounts (`afterDiscount`): the customer's
  //     payable goods value, not the pre-discount cart, decides the threshold.
  // Changing either rule alters what customers pay — it is a business/accounting decision, not a
  // code fix. The invariant below is locked by pricingInvariants.test.ts.
  const subtotal = Math.round(items.reduce((sum, item) => sum + item.price * item.qty, 0))

  // MRP Total / Discount on MRP — the product-level "was ₹X, now ₹Y" discount,
  // distinct from a coupon discount. mrp is already on CartItem for every item
  // (falls back to price itself for items with no mrp set, so mrpDiscount is
  // never negative and mrpTotal is never less than subtotal).
  const mrpTotal    = Math.round(items.reduce((sum, item) => sum + Math.max(item.mrp, item.price) * item.qty, 0))
  const mrpDiscount = Math.max(0, mrpTotal - subtotal)

  const discount = coupon ? coupon.discount : 0

  const afterDiscount = Math.max(0, subtotal - discount - loyaltyDiscount)

  const isFreeShipping = afterDiscount >= freeShippingMin
  const shipping       = isFreeShipping ? 0 : flatShipping

  const prepaidDiscount = paymentMethod === 'razorpay'
    ? Math.round(afterDiscount * prepaidPct / 100)
    : 0

  // CART-001 (Nov 2026 audit) — GST is charged on the value AFTER the seller's own discounts.
  // CGST Act 2017 s.15(3)(a): a discount given before or at the time of supply, and recorded on the invoice, is not part of the
  // value of supply. The coupon (and the prepaid % discount) are exactly that, so the GST-inclusive prices are first reduced by
  // them — spread across the lines in proportion to each line's value — and only then is the GST carved out. Before this the
  // GST line ignored the coupon (₹700 cart, ₹50 coupon, ₹650 payable still showed GST on ₹700).
  // Deliberately NOT reduced: loyalty-coin redemption (coins are consideration for the supply, not a price reduction) — the
  // conservative reading; the owner's CA may revisit. This function also feeds orders.tax and therefore the invoice, so the cart,
  // checkout, stored order and invoice all agree.
  const grossLines   = items.reduce((sum, item) => sum + item.price * item.qty, 0)
  const taxableCut   = grossLines > 0 ? Math.min(grossLines, Math.max(0, discount) + prepaidDiscount) : 0
  const cutFraction  = grossLines > 0 ? taxableCut / grossLines : 0

  // Flat COD handling fee — folded into `total`. Shown as its own "COD
  // Charges" line in the cart drawer, cart page, and checkout summary (see
  // CartDrawer.tsx / CartSummary.tsx / OrderSummary.tsx) — no longer a
  // hidden add-on; it's itemized like everything else.
  const codSurcharge = paymentMethod === 'cod' ? Math.round(codSurchargeAmt) : 0

  // GST (Nov 2026 — owner decision "do it like the big marketplaces", researched against the CGST Act):
  //  • Shipping and the COD handling fee are charged by the seller together with the goods, so they are PART OF THE VALUE OF THE
  //    SUPPLY (CGST Act s.15(2)(c): any amount charged for anything done in respect of the supply at or before delivery) and, being a
  //    composite supply, follow the rate of the goods. With several rates in one cart the fee is shared across the lines in
  //    proportion to their value (the usual marketplace practice), so each part carries its own line's rate. Before this the GST
  //    line ignored both fees entirely.
  //  • Rounding is done ONCE per invoice (CGST Act s.170: tax amounts to the nearest rupee), on the exact paise-level sum — not per
  //    line, which drifted by up to 50 paise per line in either direction.
  //  The customer's TOTAL is unchanged: prices and fees are GST-inclusive, only the tax carved out of them changes.
  const lineGst = (value: number, rate: number) => {
    const r = Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : 0
    return (value * r) / (100 + r)
  }
  const lineValues  = items.map(item => ({ v: item.price * item.qty * (1 - cutFraction), r: item.gstRate }))
  const goodsValue  = lineValues.reduce((s, l) => s + l.v, 0)
  const feeValue    = shipping + codSurcharge
  const gstExact    = lineValues.reduce(
    (s, l) => s + lineGst(l.v, l.r) + (goodsValue > 0 ? lineGst(feeValue * (l.v / goodsValue), l.r) : 0), 0)
  const gstTotal    = Math.round(gstExact)

  // BUG FIX: total could go negative if an admin sets prepaid_discount_pct > 100
  // (e.g. 150%). afterDiscount=100, prepaidDiscount=150 → total=-50.
  // A negative total is passed to Razorpay as a negative paise amount which
  // causes the API call to fail with a cryptic error. Clamp to 0.
  const total = Math.max(0, afterDiscount + shipping + codSurcharge - prepaidDiscount)

  return {
    subtotal,
    mrpTotal,
    mrpDiscount,
    discount,
    loyaltyDiscount,
    shipping,
    gstTotal,
    prepaidDiscount,
    codSurcharge,
    total,
    freeShippingMin,
    isFreeShipping,
    remainingForFreeShip: Math.max(0, freeShippingMin - afterDiscount),
    // afterDiscount is what isFreeShipping actually compares — expose it so the
    // progress bar uses the same base value and can never disagree with the engine.
    progressBase: afterDiscount,
  }
}

/** Who is asking, as far as the caller knows. All optional: the cart page knows nothing for a guest, checkout adds phone + address. */
export interface CouponAsker {
  phone?:      string
  /** Verified (signed-in) customer id, resolved server-side from the session — never from the request body. */
  customerId?: string | number | null
  pincode?:    string
  /** House / flat + area as typed. */
  address?:    string
  /** Cart lines (product + line amount) — lets a category-limited coupon be previewed on its eligible lines only. */
  lines?:      Array<{ productId: string | number; amount: number }>
}

// Server-side: validate coupon code against DB
export async function validateCouponServer(
  code: string,
  subtotal: number,
  // A bare string is the phone (legacy call shape).
  asker?: string | CouponAsker,
): Promise<{ valid: boolean; coupon?: AppliedCoupon; error?: string }> {
  const who: CouponAsker = typeof asker === 'string' ? { phone: asker } : (asker ?? {})
  const customerPhone = who.phone
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

  // NOV 2026 — "one person / one address, one time only". This is the EARLY warning (cart / checkout) so a customer who already used a
  // one-time coupon is told before they reach Place Order; createOrder is still the authoritative gate. What is known grows as the
  // customer goes: nothing for a guest on the cart page (the check is then skipped), the signed-in account from the session, then the
  // phone and delivery address once typed at checkout. History is rebuilt from the orders behind each use (guest uses carry no customer
  // id) and matched on the PERSON or the ADDRESS — see lib/couponHistory.ts. Fails open here (a read problem must not block a
  // customer at the cart); the order path fails closed.
  const needsHistory = data.user_limit != null || data.first_order_only
  if (needsHistory) {
    try {
      const customerIds = new Set<string>()
      if (who.customerId != null) customerIds.add(String(who.customerId))
      const normalizedPhone = (customerPhone ?? '').replace(/\D/g, '').slice(-10)
      if (normalizedPhone.length === 10) {
        const { data: byPhone } = await db.from('customers').select('id').eq('normalized_phone', normalizedPhone).limit(25)
        for (const r of (byPhone ?? []) as Array<{ id: number | string }>) customerIds.add(String(r.id))
      }
      const haveAddress = /^\d{6}$/.test(who.pincode ?? '')
      if (customerIds.size > 0 || haveAddress) {
        if (data.user_limit != null) {
          const prior = await countPriorCouponUse(db, data.id, { customerIds: Array.from(customerIds), pincode: who.pincode, addressLine: who.address })
          const reuse = couponReuseProblem(prior, Number(data.user_limit))
          if (reuse) return { valid: false, error: reuse }
        }
        if (data.first_order_only) {
          // a customer with an earlier paid / COD-placed, non-cancelled order cannot use it (same rule as createOrder)
          if (customerIds.size > 0) {
            const { data: priorOrders } = await db
              .from('orders').select('id').in('customer_id', Array.from(customerIds))
              .in('payment_status', ['paid', 'cod_pending', 'refund_pending', 'refunded'])
              .neq('order_status', 'cancelled').limit(1)
            if (priorOrders && priorOrders.length > 0) return { valid: false, error: 'This coupon is valid on your first order only' }
          }
        }
      }
    } catch {
      // history unreadable → let the customer continue; the order itself re-checks and refuses if needed
    }
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
  // category_ids: the coupon applies only to lines whose product is in those categories (createOrder does the same, authoritatively).
  let discountBase = subtotal
  const rawCats: unknown = data.category_ids
  const allowedCategories: string[] = (Array.isArray(rawCats) ? rawCats : typeof rawCats === 'string' ? rawCats.split(',') : []).map(x => String(x).trim()).filter(Boolean)
  if (allowedCategories.length > 0 && who.lines?.length) {
    try {
      const ids = Array.from(new Set(who.lines.map(l => String(l.productId))))
      const { data: prods, error: pErr } = await db.from('products').select('id, category_id').in('id', ids)
      if (!pErr && prods) {
        const catOf = new Map((prods as Array<{ id: unknown; category_id: unknown }>).map(p => [String(p.id), String(p.category_id)]))
        discountBase = who.lines.reduce((sum, l) => allowedCategories.includes(catOf.get(String(l.productId)) ?? '') ? sum + l.amount : sum, 0)
        if (discountBase <= 0) return { valid: false, error: 'This coupon does not apply to the items in your cart' }
      }
    } catch { /* category lookup failed → whole-cart preview; createOrder re-checks */ }
  }
  const discount = data.type === 'percent'
    ? Math.min(Math.round(discountBase * data.value / 100), data.max_discount ?? discountBase)
    // round flat values — DB may store non-integer (e.g. 49.99); never more than the eligible value
    : Math.min(Math.round(data.value), discountBase)

  return {
    valid: true,
    coupon: {
      code:     data.code,
      discount: Math.round(discount),
      type:     data.type,
      percent:  data.type === 'percent' ? data.value : undefined,
      oneTimeUse: data.user_limit != null || !!data.first_order_only ? true : undefined,
    },
  }
}
