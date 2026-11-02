// ─────────────────────────────────────────────────────────────────────────────
// lib/pinState.ts  (client-safe, pure)
//
// Nov 2026 checkout audit (CHK-001): the order API accepted ANY six digits as a PIN — `000000`, `999999`
// and a Delhi PIN paired with "Himachal Pradesh" all passed — so undeliverable / mistyped addresses
// reached fulfilment (failed deliveries, RTO, COD losses).
//
// Two rules, both derived from the public India Post PIN structure (first digit = zone, first two digits
// = sorting district / circle):
//   1. A deliverable PIN is six digits, first digit 1–8. `0xxxxx` does not exist; `9xxxxx` is the Army
//      Postal Service, which couriers do not serve.
//   2. The chosen state must be one of the states that own that two-digit prefix.
//
// Rule 2 is intentionally LENIENT: where circles straddle borders (Chandigarh/Punjab/Haryana, NCR,
// Uttarakhand/UP, the North-East, Puducherry's enclaves…) every plausible neighbour is allowed, and a prefix
// we do not list is not blocked on state. The goal is to stop clearly wrong combinations (Delhi PIN + Himachal),
// never to refuse a real customer. Used by the server (addressSchema — authoritative) and the checkout form.
// ─────────────────────────────────────────────────────────────────────────────

export const DELIVERABLE_PIN_REGEX = /^[1-8]\d{5}$/

const NE = ['Assam', 'Meghalaya', 'Arunachal Pradesh', 'Mizoram', 'Manipur', 'Nagaland', 'Tripura', 'Sikkim']

/** First two digits of the PIN → states that may legitimately own it. */
const PREFIX_STATES: Record<string, readonly string[]> = {
  '11': ['Delhi', 'Haryana', 'Uttar Pradesh'],
  '12': ['Haryana', 'Delhi', 'Chandigarh'],
  '13': ['Haryana', 'Delhi', 'Chandigarh'],
  '14': ['Punjab', 'Chandigarh', 'Haryana'],
  '15': ['Punjab', 'Chandigarh', 'Haryana'],
  '16': ['Punjab', 'Chandigarh', 'Haryana'],
  '17': ['Himachal Pradesh', 'Punjab'],
  '18': ['Jammu & Kashmir', 'Ladakh'],
  '19': ['Jammu & Kashmir', 'Ladakh'],
  '20': ['Uttar Pradesh', 'Uttarakhand', 'Delhi', 'Haryana'],
  '21': ['Uttar Pradesh'],
  '22': ['Uttar Pradesh'],
  '23': ['Uttar Pradesh'],
  '24': ['Uttar Pradesh', 'Uttarakhand'],
  '25': ['Uttar Pradesh', 'Uttarakhand'],
  '26': ['Uttar Pradesh', 'Uttarakhand'],
  '27': ['Uttar Pradesh'],
  '28': ['Uttar Pradesh'],
  '30': ['Rajasthan'],
  '31': ['Rajasthan'],
  '32': ['Rajasthan'],
  '33': ['Rajasthan'],
  '34': ['Rajasthan'],
  '36': ['Gujarat', 'Dadra & Nagar Haveli and Daman & Diu'],
  '37': ['Gujarat'],
  '38': ['Gujarat'],
  '39': ['Gujarat', 'Dadra & Nagar Haveli and Daman & Diu'],
  '40': ['Maharashtra', 'Goa'],
  '41': ['Maharashtra'],
  '42': ['Maharashtra'],
  '43': ['Maharashtra'],
  '44': ['Maharashtra'],
  '45': ['Madhya Pradesh', 'Chhattisgarh'],
  '46': ['Madhya Pradesh', 'Chhattisgarh'],
  '47': ['Madhya Pradesh', 'Chhattisgarh'],
  '48': ['Madhya Pradesh', 'Chhattisgarh'],
  '49': ['Chhattisgarh', 'Madhya Pradesh'],
  '50': ['Telangana', 'Andhra Pradesh'],
  '51': ['Andhra Pradesh', 'Telangana'],
  '52': ['Andhra Pradesh', 'Telangana'],
  '53': ['Andhra Pradesh', 'Telangana', 'Puducherry'],
  '56': ['Karnataka'],
  '57': ['Karnataka'],
  '58': ['Karnataka'],
  '59': ['Karnataka'],
  '60': ['Tamil Nadu', 'Puducherry'],
  '61': ['Tamil Nadu', 'Puducherry'],
  '62': ['Tamil Nadu', 'Puducherry'],
  '63': ['Tamil Nadu', 'Puducherry'],
  '64': ['Tamil Nadu', 'Puducherry'],
  '67': ['Kerala', 'Puducherry', 'Lakshadweep'],
  '68': ['Kerala', 'Puducherry', 'Lakshadweep'],
  '69': ['Kerala', 'Tamil Nadu'],
  '70': ['West Bengal', 'Sikkim', 'Andaman & Nicobar Islands'],
  '71': ['West Bengal', 'Sikkim', 'Andaman & Nicobar Islands'],
  '72': ['West Bengal', 'Sikkim', 'Andaman & Nicobar Islands'],
  '73': ['West Bengal', 'Sikkim', 'Andaman & Nicobar Islands'],
  '74': ['West Bengal', 'Sikkim', 'Andaman & Nicobar Islands'],
  '75': ['Odisha'],
  '76': ['Odisha'],
  '77': ['Odisha'],
  '78': NE,
  '79': NE,
  '80': ['Bihar', 'Jharkhand'],
  '81': ['Bihar', 'Jharkhand'],
  '82': ['Bihar', 'Jharkhand'],
  '83': ['Bihar', 'Jharkhand'],
  '84': ['Bihar', 'Jharkhand'],
  '85': ['Bihar', 'Jharkhand'],
}

export function isDeliverablePin(pin: string | null | undefined): boolean {
  return DELIVERABLE_PIN_REGEX.test((pin ?? '').trim())
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * True unless the PIN's prefix is KNOWN to belong to other states. Unknown prefix, blank state or an
 * invalid PIN return true here — those are handled by the format checks, never by this one.
 */
export function pinMatchesState(pin: string | null | undefined, state: string | null | undefined): boolean {
  const p = (pin ?? '').trim()
  const s = norm(state ?? '')
  if (!s || !isDeliverablePin(p)) return true
  const allowed = PREFIX_STATES[p.slice(0, 2)]
  if (!allowed) return true
  return allowed.some(a => norm(a) === s)
}

/** Customer-facing message for a bad PIN/state pair, or null when fine. One source for server and form. */
export function pinProblem(pin: string | null | undefined, state: string | null | undefined): string | null {
  if (!isDeliverablePin(pin)) return 'Enter a valid 6-digit PIN code (it cannot start with 0 or 9)'
  if (!pinMatchesState(pin, state)) {
    return `PIN code ${(pin ?? '').trim()} does not look like it belongs to ${state}. Please check the PIN code or the state.`
  }
  return null
}
