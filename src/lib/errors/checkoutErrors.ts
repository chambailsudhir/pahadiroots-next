// ─────────────────────────────────────────────────────────────────────────────
// lib/errors/checkoutErrors.ts
//
// Security audit (Nov 2026, error leakage): the order and payment routes used to decide what a
// customer may read by SNIFFING error messages for words like "coupon" or "stock". Any internal
// failure that happened to contain one of those words leaked verbatim with a 409 — e.g.
// `coupon claim failed: <postgres detail>`, `coupon fetch timed out after 8000ms`, or (payments
// route only) `Stock reservation infra failure for item <id>`.
//
// Now the rule is typed: ONLY a CheckoutRejectedError is shown to the customer (409). Its message is
// written by our own code for the customer (it may name a product or an amount, never DB detail).
// Every other error is logged server-side and answered with the route's generic message.
// Kept in its own module (not orderService) so route tests that mock orderService still get the class.
// ─────────────────────────────────────────────────────────────────────────────

export type CheckoutRejectionCode =
  | 'CHECKOUT_REJECTED'
  | 'OUT_OF_STOCK'
  | 'COUPON_INVALID'
  | 'PRODUCT_UNAVAILABLE'
  | 'INVALID_CART'
  | 'PAYMENT_METHOD_UNAVAILABLE'
  | 'COD_LIMIT'
  | 'MIN_ORDER'
  | 'LOYALTY'
  | 'NOT_SERVICEABLE'

/** A customer-actionable refusal from order creation. `message` is customer-safe by construction. */
export class CheckoutRejectedError extends Error {
  readonly code: CheckoutRejectionCode
  constructor(message: string, code: CheckoutRejectionCode = 'CHECKOUT_REJECTED') {
    super(message)
    this.name = 'CheckoutRejectedError'
    this.code = code
  }
}

export function isCheckoutRejectedError(err: unknown): err is CheckoutRejectedError {
  return err instanceof CheckoutRejectedError
}
