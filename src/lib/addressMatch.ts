// ─────────────────────────────────────────────────────────────────────────────
// lib/addressMatch.ts  (pure, client-safe)
//
// Nov 2026: one-time coupons ("one person / one address, one time only") must recognise the SAME delivery address even when it is
// re-typed differently ("12 Main Rd" vs "Flat No. 12, Main Road"). It is a deterrent against casual re-use, not an identity check:
// nobody can prove two strings are the same house, so the rule is deliberately
//   • tolerant of harmless re-typing (case, punctuation, abbreviations, filler words like "near", "flat", "no"),
//   • strict about the house / flat number (neighbours in different flats must NOT match), and
//   • silent when there is too little to compare (a one-word address never matches anything).
// ─────────────────────────────────────────────────────────────────────────────

export interface AddressKey { pincode?: string | null; line?: string | null }

const SYNONYMS: Record<string, string> = {
  rd: 'road', st: 'street', ave: 'avenue', apt: 'apartment', apts: 'apartment', apartments: 'apartment',
  bldg: 'building', blk: 'block', sec: 'sector', ph: 'phase', colony: 'colony', col: 'colony', nagar: 'nagar',
  mkt: 'market', cross: 'cross', lane: 'lane', ln: 'lane', opp: 'opposite', nr: 'near',
}
/** Words that carry no information about WHICH house it is. */
const FILLER = new Set([
  'flat', 'house', 'no', 'number', 'hno', 'h', 'door', 'plot', 'near', 'opposite', 'behind', 'beside', 'next', 'to', 'the', 'at',
  'of', 'and', 'in', 'po', 'p', 'o', 'dist', 'distt', 'district', 'tehsil', 'teh', 'tehsil', 'post', 'office', 'floor', 'fl',
])

export function addressTokens(line: string | null | undefined): string[] {
  const t = String(line ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(w => SYNONYMS[w] ?? w)
    .filter(w => !FILLER.has(w))
  return Array.from(new Set(t))
}

const hasDigit = (s: string) => /\d/.test(s)

/**
 * True when both addresses are in the same PIN code and read as the same place.
 * Needs ≥ 2 meaningful words on each side. If both carry house/flat numbers they must share one.
 */
export function sameDeliveryAddress(a: AddressKey, b: AddressKey): boolean {
  const pa = String(a.pincode ?? '').trim(), pb = String(b.pincode ?? '').trim()
  if (!/^\d{6}$/.test(pa) || pa !== pb) return false

  const ta = addressTokens(a.line), tb = addressTokens(b.line)
  if (ta.length < 2 || tb.length < 2) return false

  const da = ta.filter(hasDigit), db = tb.filter(hasDigit)
  if (da.length > 0 && db.length > 0 && !da.some(x => db.includes(x))) return false   // different house / flat number

  const setB = new Set(tb)
  const inter = ta.filter(x => setB.has(x)).length
  const union = new Set([...ta, ...tb]).size
  return union > 0 && inter / union >= 0.7
}
