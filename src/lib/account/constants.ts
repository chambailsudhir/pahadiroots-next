// ─────────────────────────────────────────────────────────────
// Account constants — single source of truth
// ─────────────────────────────────────────────────────────────

export const INDIA_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
  'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Andaman & Nicobar Islands','Chandigarh',
  'Dadra & Nagar Haveli and Daman & Diu','Delhi',
  'Jammu & Kashmir','Ladakh','Lakshadweep','Puducherry',
]

export const ADDRESS_LABELS = ['Home','Office','Parents','Friends','Partner','Warehouse','Other']

// ── Return/refund vocabulary ──────────────────────────────────────────────────
// FIX (Aug 18): this comment previously claimed returns.status has "exactly
// 5 values" and that order_status_enum has no 'processing'/'refund_initiated'/
// 'refund_completed' — both wrong. Re-verified directly against the live
// schema this session: returns.status has 6 real values (requested, approved,
// received, refunded, replaced, rejected — 'replaced' via the Replacement
// workflow), and order_status_enum has 16 values, INCLUDING 'processing',
// 'refund_initiated', and 'refund_completed' (they exist on ORDERS, just
// aren't the vocabulary this file's return_* keys map from — see below).
// Returns are still not reflected in order_status itself — order_status
// stays 'delivered' for the life of a return. The real return lifecycle
// lives entirely in the dedicated `returns` table's `status` column. The
// keys below are prefixed `return_` (mapped from that column by
// /api/orders/route.ts's _displayStatus computation) so they never collide
// with unrelated concepts that happen to share a word — e.g. orders.order_status
// can independently be 'returned', and orders.payment_status can independently
// be 'refunded'.
export const BADGE_CLASS: Record<string,string> = {
  pending:'badge-pending',confirmed:'badge-confirmed',
  // FIX (Aug 18): 'processing' and 'out_for_delivery' are both real, live
  // order_status_enum values (16 total, re-verified directly against
  // pg_enum this session — the comment that used to sit here claiming "7
  // values, no processing" was simply wrong). Left unmapped, both fell
  // through OrderCard.tsx's `BADGE[BADGE_CLASS[ds]] || styles.badgePending`
  // fallback and rendered as a plain "Pending"-styled badge — misleading
  // for 'out_for_delivery' especially, since that means the order is
  // literally on its way to the customer right now. Rather than invent new
  // badge colors (a design decision), reuse the closest existing,
  // semantically-correct style: 'processing' behaves like early-pipeline
  // 'confirmed', 'out_for_delivery' behaves like late-pipeline 'shipped' —
  // both already have real CSS classes in OrderCard.tsx's BADGE/STRIPE maps.
  processing:'badge-confirmed',
  packed:'badge-packed',shipped:'badge-shipped',
  out_for_delivery:'badge-shipped',
  delivered:'badge-delivered',
  cancelled:'badge-cancelled',returned:'badge-returned',
  return_requested:'badge-return_requested',return_approved:'badge-return_approved',
  return_received:'badge-return_received',return_refunded:'badge-return_refunded',
  return_rejected:'badge-return_rejected',
  // BUG FIX: 'replaced' is a real returns.status value (Replacement
  // workflow, migration 041 — admin can mark a return "Replaced" instead
  // of "Refunded"), but none of the storefront's status maps had a
  // matching 'return_replaced' entry (this map, RETURN_STATUS_TO_DISPLAY,
  // STATUS_LABEL, STRIPE_CLASS, and OrderCard.tsx's BADGE/STRIPE lookups
  // all lacked it). A replaced return would have shown the customer's
  // order stuck at the underlying order_status ('delivered') instead of
  // any "Replacement Shipped" indication — the return would appear to
  // have vanished from their perspective.
  return_replaced:'badge-return_replaced',
}

export const STATUS_LABEL: Record<string,string> = {
  pending:'Pending',confirmed:'Confirmed',
  // See BADGE_CLASS fix comment above — same live-enum values, same gap.
  processing:'Processing',
  packed:'Packed',shipped:'Shipped',
  out_for_delivery:'Out for Delivery',
  delivered:'Delivered',
  cancelled:'Cancelled',returned:'Returned',
  return_requested:'Return Requested',return_approved:'Return Approved',
  return_received:'Item Received',return_refunded:'Refund Issued',
  return_rejected:'Return Rejected',
  return_replaced:'Replacement Shipped',
}

export const STRIPE_CLASS: Record<string,string> = {
  confirmed:'oc-stripe-confirmed',
  processing:'oc-stripe-confirmed',
  packed:'oc-stripe-packed',shipped:'oc-stripe-shipped',
  out_for_delivery:'oc-stripe-shipped',
  delivered:'oc-stripe-delivered',pending:'oc-stripe-pending',cancelled:'oc-stripe-cancelled',
  returned:'oc-stripe-returned',
  return_requested:'oc-stripe-return_requested',return_approved:'oc-stripe-return_approved',
  return_received:'oc-stripe-return_received',return_refunded:'oc-stripe-return_refunded',
  return_rejected:'oc-stripe-return_rejected',
  return_replaced:'oc-stripe-return_replaced',
}

// FIX (Aug 18): this comment previously claimed "confirmed against the live
// order_status_enum (7 values, no 'processing')" — that claim was wrong.
// Re-verified directly against pg_enum this session: order_status_enum
// actually has 16 values, and 'processing' and 'out_for_delivery' are both
// real, live values sitting between 'confirmed' and 'delivered' in the
// pipeline. Both were missing here, meaning any order in either status
// would silently drop out of the customer's "Active Orders" filter tab
// (ACTIVE_STATUSES is used directly as the active-tab query and to compute
// the active-orders count in useOrders.ts) even though it's clearly still
// in-flight — 'out_for_delivery' in particular means the order is literally
// on its way to the customer right now. No live order currently sits in
// either status (small dataset, all terminal today), so this hasn't visibly
// fired yet, but the very next order to reach 'processing' or
// 'out_for_delivery' would have vanished from Active until it hit a later
// status. Matches the identical enum-drift bug already found and fixed this
// session in pahadi-admin's PIPELINE_STATUSES/KNOWN_STATUSES.
export const ACTIVE_STATUSES   = ['pending','confirmed','processing','packed','shipped','out_for_delivery']
// Sentinel passed as the `status` query param to /api/orders — the API route
// recognises this and does an inner join against `returns` (i.e. "orders that
// have a linked return row") instead of filtering by order_status, since no
// order_status value ever represents a return.
export const RETURNS_FILTER_SENTINEL = '__has_return__'

// Maps a `returns.status` value (the real 6-value lifecycle: requested,
// approved, received, refunded, replaced, rejected — 'replaced' added by
// migration 041 for the Replacement workflow) to the display-status
// vocabulary above. Single source of truth — used by both
// /api/orders/route.ts and /api/orders/[id]/route.ts so the list and detail
// pages never disagree.
export const RETURN_STATUS_TO_DISPLAY: Record<string, string> = {
  requested: 'return_requested',
  approved:  'return_approved',
  received:  'return_received',
  refunded:  'return_refunded',
  replaced:  'return_replaced',
  rejected:  'return_rejected',
}

// ── Return reasons ───────────────────────────────────────────────────────────
// CROSS-REPO FIX: previously these were free-text sentences ("Damaged or
// defective product") stored directly in returns.reason. Now that the real
// pahadi-admin repo has been reviewed (not just described secondhand), its
// Returns page (src/app/admin/returns/page.jsx) uses a fixed, lowercase
// snake_case vocabulary for `reason` — RETURN_REASONS = ['damaged',
// 'wrong_item', 'not_as_described', 'changed_mind', 'missing_parts', 'other']
// — and drives real behaviour off it: REASON_RESTOCK auto-locks the restock
// toggle per code, and the reason <select> only recognises these exact
// values. A storefront-created return writing a full English sentence into
// the same column would show up in admin as an unrecognised reason — the
// dropdown wouldn't match any option, auto-restock would silently fall back
// to "manual" for every customer-initiated return, and saving the return in
// admin without deliberately touching the reason field would silently
// overwrite the customer's actual reason with whatever the <select>
// defaults to. Fixed by adopting admin's exact codes as the source of
// truth — the storefront UI still shows a friendly label, but only the code
// is ever sent to the API or stored in the DB.
export const RETURN_REASONS = [
  { code: 'damaged',          label: 'Damaged or defective product' },
  { code: 'wrong_item',       label: 'Wrong item received' },
  { code: 'not_as_described', label: 'Item not as described' },
  { code: 'missing_parts',    label: 'Missing parts or accessories' },
  { code: 'changed_mind',     label: 'Changed my mind' },
  { code: 'other',            label: 'Other' },
] as const

export const RETURN_REASON_CODES = RETURN_REASONS.map(r => r.code)
export type ReturnReasonCode = typeof RETURN_REASONS[number]['code']

// ── Replacement resolution ───────────────────────────────────────────────────
// CROSS-REPO: mirrors pahadi-admin's src/lib/returns.js REPLACEMENT_ALLOWED_REASONS
// / canReplace() exactly — same 4 codes, same order. Replacement (shipping a
// working/correct unit instead of refunding) is scoped to genuine quality/
// fulfillment issues only (evidenced against BigBasket's own T&Cs), never
// 'changed_mind' or 'other'. Enforced server-side in
// /api/orders/[id]/return/route.ts (never trust client gating) and mirrored
// by the DB's returns_replace_reason_check constraint (migration 041) — this
// is just the UI/client copy so the two repos can't drift apart.
export const REPLACEMENT_ALLOWED_REASONS: ReturnReasonCode[] = [
  'damaged', 'wrong_item', 'not_as_described', 'missing_parts',
]

export function canReplace(reason: string): boolean {
  return (REPLACEMENT_ALLOWED_REASONS as string[]).includes(reason)
}

// BUG FIX (July 2026): the return-request API route
// (/api/orders/[id]/return/route.ts) enforces a 48-hour window per the
// site's actual Return & Refund Policy (founder-confirmed). The client-side
// eligibility check that decides whether to SHOW the "Return" button
// (useOrders.ts's canReturn()) had its own hardcoded "7 days" that was never
// updated when the policy/route changed to 48 hours — so the button kept
// appearing for orders delivered 2–7 days ago, and clicking it always failed
// with the route's 422 "Return window has closed" error. Single constant now
// imported by both, so they can't drift apart again.
export const RETURNABLE_WINDOW_HOURS = 48

// ── localStorage keys ────────────────────────────────────────────────────────
// Centralised so every consumer refers to the same string literal and a typo
// in one place cannot silently leave stale cache keys behind.
export const CHECKOUT_PROFILE_CACHE_KEY = 'pr_checkout_profile'

// ── Support contact ──────────────────────────────────────────────────────────
// Single source of truth — update here and it reflects everywhere.
export const SUPPORT_WHATSAPP_NUMBER = '919899984895'

// ── Courier tracking URLs ────────────────────────────────────────────────────
// Use {number} as the placeholder for the tracking/AWB number.
// Fall back to Google Search for any courier not listed here.
export const COURIER_TRACKING_MAP: Record<string, string> = {
  bluedart:    'https://www.bluedart.com/ubdrecursive?trackFor=0&field1={number}',
  delhivery:   'https://www.delhivery.com/track/package/{number}',
  dtdc:        'https://www.dtdc.in/tracking/tracking_results.asp?Consignment_No={number}',
  ecom:        'https://ecomexpress.in/tracking/?awb_field={number}',
  xpressbees:  'https://www.xpressbees.com/shipment/tracking?awbNo={number}',
  ekart:       'https://ekartlogistics.com/track?trackingId={number}',
  shadowfax:   'https://tracker.shadowfax.in/?waybill={number}',
  shiprocket:  'https://shiprocket.co/tracking/{number}',
  fedex:       'https://www.fedex.com/fedextrack/?tracknumbers={number}',
  dhl:         'https://www.dhl.com/in-en/home/tracking.html?tracking-id={number}',
}

export const AUTH_ACTIONS = {
  GET_PROFILE:      'get_profile',
  GET_ORDERS:       'get_orders',
  UPDATE_PROFILE:   'update_profile',
  CHANGE_PASSWORD:  'change_password',
  REFRESH_TOKEN:    'refresh_token',
  LOGOUT:           'logout',
} as const
