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

export const BADGE_CLASS: Record<string,string> = {
  pending:'badge-pending',confirmed:'badge-confirmed',processing:'badge-confirmed',
  packed:'badge-packed',shipped:'badge-shipped',delivered:'badge-delivered',
  cancelled:'badge-cancelled',returned:'badge-returned',
  return_requested:'badge-return_requested',return_approved:'badge-return_approved',
  return_received:'badge-return_received',refunded:'badge-refunded',
  refund_initiated:'badge-refund_initiated',refund_completed:'badge-refund_completed',
  return_rejected:'badge-return_rejected',
}

export const STATUS_LABEL: Record<string,string> = {
  pending:'Pending',confirmed:'Confirmed',processing:'Processing',
  packed:'Packed',shipped:'Shipped',delivered:'Delivered',
  cancelled:'Cancelled',returned:'Returned',
  return_requested:'Return Requested',return_approved:'Return Approved',
  return_received:'Item Received',refunded:'Refund Issued',
  refund_initiated:'Refund Initiated',refund_completed:'Refund Credited',
  return_rejected:'Return Rejected',
}

export const STRIPE_CLASS: Record<string,string> = {
  confirmed:'oc-stripe-confirmed',packed:'oc-stripe-packed',shipped:'oc-stripe-shipped',
  delivered:'oc-stripe-delivered',pending:'oc-stripe-pending',cancelled:'oc-stripe-cancelled',
  processing:'oc-stripe-processing',returned:'oc-stripe-returned',
  return_requested:'oc-stripe-return_requested',return_approved:'oc-stripe-return_approved',
  return_received:'oc-stripe-return_received',refunded:'oc-stripe-refunded',
  refund_initiated:'oc-stripe-refund_initiated',refund_completed:'oc-stripe-refund_completed',
  return_rejected:'oc-stripe-return_rejected',
}

export const ACTIVE_STATUSES   = ['pending','confirmed','processing','packed','shipped']
export const RETURN_STATUSES   = ['return_requested','return_approved','return_received',
  'refunded','refund_initiated','refund_completed','return_rejected','returned']

// ── Return reasons ───────────────────────────────────────────────────────────
// Single source of truth used by both the UI dropdown (OrdersSection.tsx) and
// the API validation (/api/orders/[id]/return/route.ts).  Keeping them in sync
// here prevents silent drift where a reason added to the UI passes the frontend
// but is rejected by the backend (or vice versa).
export const RETURN_REASONS = [
  'Damaged or defective product',
  'Wrong item received',
  'Item not as described',
  'Changed my mind',
  'Other',
] as const

export type ReturnReason = typeof RETURN_REASONS[number]

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
