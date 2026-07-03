// ─────────────────────────────────────────────────────────────────────────────
// lib/pincodeZones.ts
//
// BUG FIX (MEDIUM – audit finding #6): PincodeRow previously did nothing but
// validate the PIN format and then hand the customer off to WhatsApp — a
// conversion-flow interruption with zero on-page feedback. There's no courier
// API integration anywhere in this codebase (no serviceability table, no
// Delhivery/Shiprocket credentials), so we deliberately do NOT fabricate a
// precise "delivers by Tuesday" promise — that would be a false claim with
// real customer-trust and legal exposure.
//
// What we *can* do honestly: India Post's postal circles are public,
// well-documented, and deterministic from the first digit of any 6-digit PIN
// (https://www.indiapost.gov.in — PIN code structure). 5 Pahadi Roots ships
// from Himachal Pradesh (postal zone 1 — Delhi/Haryana/Punjab/HP/J&K/Ladakh/
// Chandigarh), so we can give a clearly-labelled ESTIMATE tier based on zone
// distance from origin, and keep WhatsApp as a secondary "confirm exact date"
// action instead of the only action.
// ─────────────────────────────────────────────────────────────────────────────

export const PIN_REGEX = /^[1-9]\d{5}$/ // Indian PINs never start with 0

// India Post's 9 postal zones, keyed by the PIN's first digit. Public,
// standard reference data — not fabricated.
const ZONE_NAMES: Record<string, string> = {
  '1': 'Delhi / Haryana / Punjab / Himachal Pradesh / J&K / Ladakh / Chandigarh',
  '2': 'Uttar Pradesh / Uttarakhand',
  '3': 'Rajasthan / Gujarat / Daman & Diu / Dadra & Nagar Haveli',
  '4': 'Maharashtra / Madhya Pradesh / Chhattisgarh / Goa',
  '5': 'Andhra Pradesh / Telangana / Karnataka',
  '6': 'Tamil Nadu / Kerala / Puducherry / Lakshadweep',
  '7': 'West Bengal / Odisha / North-East India / Sikkim / A&N Islands',
  '8': 'Bihar / Jharkhand',
  '9': 'Army Postal Service',
}

// Warehouse dispatch zone — 5 Pahadi Roots ships from Himachal Pradesh (zone 1).
// If the warehouse ever moves, update this one constant.
const ORIGIN_ZONE = '1'

// Zones adjacent to origin (share a land border / short transit lanes) get the
// middle ETA tier; everything else gets the longer tier.
const ADJACENT_ZONES = new Set(['2', '8'])

export interface DeliveryEstimate {
  zoneLabel: string
  etaLabel:  string
}

/**
 * Returns a clearly-labelled ESTIMATED delivery window from a validated
 * 6-digit Indian PIN code, or null if the PIN is malformed. This is a
 * postal-zone heuristic, not a real-time courier serviceability check.
 */
export function estimateDelivery(pin: string): DeliveryEstimate | null {
  if (!PIN_REGEX.test(pin)) return null

  const zoneDigit = pin[0]
  const zoneLabel = ZONE_NAMES[zoneDigit] || 'your region'

  let etaLabel: string
  if (zoneDigit === ORIGIN_ZONE)      etaLabel = '2-4 business days'
  else if (ADJACENT_ZONES.has(zoneDigit)) etaLabel = '4-6 business days'
  else                                  etaLabel = '5-8 business days'

  return { zoneLabel, etaLabel }
}
