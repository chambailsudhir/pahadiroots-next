// ─────────────────────────────────────────────────────────────────────────────
// components/cart/cartPaymentMethod.ts  (client-safe, pure)
//
// AUDIT S3-003: the cart drawer and the cart page priced every total as a COD order
// (`calcPriceSummary(..., 'cod')`), so with COD switched off and a non-zero
// cod_surcharge_amount the customer saw a "COD Charges" line and a total that
// checkout never charges — and prepaid customers saw a HIGHER cart total than
// checkout (no 5% prepaid discount). This helper mirrors useCheckoutPage's initial
// payment-method resolution exactly, so cart total === checkout initial total for
// the same inputs: COD is the default only when it is actually available for
// this order; otherwise the order is priced as prepaid (Razorpay).
// ─────────────────────────────────────────────────────────────────────────────
import type { SiteSettings } from '@/types'
import { isCodEnabled, isRazorpayEnabledByAdmin } from '@/lib/siteSettingsHelpers'

export type CartPaymentMethod = 'razorpay' | 'cod'

export const FALLBACK_COD_MAX_VALUE = 3000  // same literal useCheckoutPage uses for cod_max_value

export function likelyPaymentMethod(
  settings: Partial<SiteSettings> | Record<string, string | undefined>,
  subtotal: number,
  /** Razorpay key presence (NEXT_PUBLIC_RAZORPAY_KEY_ID). Defaults to the build-time env. */
  razorpayKeyPresent: boolean = !!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
): CartPaymentMethod {
  const s = settings as Record<string, string | undefined>
  const codMax = parseFloat(s.cod_max_value || String(FALLBACK_COD_MAX_VALUE))
  const codOk  = isCodEnabled(s) && subtotal <= (Number.isFinite(codMax) ? codMax : FALLBACK_COD_MAX_VALUE)
  const razorpayEnabled = razorpayKeyPresent && isRazorpayEnabledByAdmin(s)
  // useCheckoutPage: starts on 'cod'; swaps to 'razorpay' only when COD is unavailable AND Razorpay is on.
  if (!codOk && razorpayEnabled) return 'razorpay'
  return 'cod'
}

/** Whole-rupee subtotal exactly as calcPriceSummary computes it (the value codOk compares against). */
export function cartSubtotal(items: ReadonlyArray<{ price: number; qty: number }>): number {
  return Math.round(items.reduce((sum, i) => sum + i.price * i.qty, 0))
}
