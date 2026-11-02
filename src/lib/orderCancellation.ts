// ─────────────────────────────────────────────────────────────────────────────
// Customer self-service order cancellation (account audit, Nov 2026 — ACC-050).
//
// Rule (matches the published policy: "cancel before dispatch, no fee"):
//   • the customer can cancel on their own ONLY while the order is `pending` or `confirmed`
//     (i.e. nobody has started packing it) AND no money has moved → Cash-on-Delivery orders.
//   • a PREPAID order needs a human: the refund has to be issued, and a late Razorpay capture could
//     land on an order that was just cancelled — those go to support (WhatsApp).
//   • once packing starts (`processing` / `packed` …) or the parcel has a tracking number, cancellation is
//     at our discretion, so it is also a support request.
// The database enforces the real state machine (enforce_order_status_machine) — this is the UX-side mirror.
// ─────────────────────────────────────────────────────────────────────────────

export const SELF_CANCELLABLE_STATUSES = ['pending', 'confirmed'] as const

export const CANCEL_REASONS = [
  { code: 'ordered_by_mistake', label: 'I ordered by mistake' },
  { code: 'wrong_address',      label: 'Wrong address / phone number' },
  { code: 'found_better_price', label: 'Found a better price' },
  { code: 'delivery_too_slow',  label: 'Delivery will take too long' },
  { code: 'changed_mind',       label: 'I changed my mind' },
  { code: 'other',              label: 'Other' },
] as const

export type CancelReasonCode = (typeof CANCEL_REASONS)[number]['code']
export const CANCEL_REASON_CODES: readonly string[] = CANCEL_REASONS.map(r => r.code)

// Fields come straight from a DB row (PostgREST JSON), so they are typed loosely and normalised below.
export interface CancellableOrder {
  order_status:    unknown
  payment_method?: unknown
  payment_status?: unknown
  tracking_number?: unknown
  shipped_at?:     unknown
}

export type CancelEligibility =
  | { allowed: true }
  | { allowed: false; reason: 'not_cancellable' | 'contact_support'; message: string }

export function cancelEligibility(o: CancellableOrder): CancelEligibility {
  const status = String(o.order_status ?? '').toLowerCase()
  const dispatched = !!(o.tracking_number || o.shipped_at)

  if (status === 'cancelled') {
    return { allowed: false, reason: 'not_cancellable', message: 'This order has already been cancelled.' }
  }
  if (dispatched || !(SELF_CANCELLABLE_STATUSES as readonly string[]).includes(status)) {
    return {
      allowed: false, reason: 'contact_support',
      message: 'This order is already being prepared or has been dispatched. Please message us on WhatsApp and we will do our best to help.',
    }
  }
  const isCod = String(o.payment_method ?? '').toLowerCase() === 'cod'
  if (!isCod) {
    return {
      allowed: false, reason: 'contact_support',
      message: 'Prepaid orders are cancelled by our team so your refund is processed correctly. Please message us on WhatsApp.',
    }
  }
  return { allowed: true }
}
