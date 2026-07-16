import { createHash } from 'crypto'

/**
 * Deterministically derives a "welcome" discount coupon code from an email
 * address. Same email always produces the same code, so re-submitting the
 * newsletter signup form (double-click, or resubscribing months later)
 * can't mint unlimited fresh coupons for one person — see the BUG FIX
 * comment in api/v1/actions/route.ts (`subscribe` action) for the full
 * context this was extracted from.
 */
export function generateWelcomeCouponCode(email: string): string {
  const hash = createHash('sha256').update(email.toLowerCase().trim()).digest('hex')
  return 'WELCOME5-' + hash.slice(0, 6).toUpperCase()
}
