// ── src/lib/pricing/variants/units.js ────────────────────────────────────────
// Unit string parsing: "250g" → 250, "1kg" → 1000, "500ml" → 500.
//
// parseFloat is intentional — unit strings are not money.
// Values used for ratios only, never for price arithmetic.
// ─────────────────────────────────────────────────────────────────────────────

// BUG #7 FIX: Normalise European decimal comma before parsing.
// "1,5kg" → 1500 (not 1000 from parseFloat("1,5") === 1)
// Only replaces a comma that is followed by digits and then end of string
// (so "1,500g" bulk format is left alone — it means one thousand five hundred).
function normaliseDecimalComma(s) {
  // Pattern: digit, comma, 1-2 digits, then a unit letter or end
  // "1,5kg" → "1.5kg"    "1,500g" → "1,500g" (unchanged — that's 1500g already)
  return s.replace(/(\d),(\d{1,2})([a-zA-Z]|$)/, '$1.$2$3');
}

/**
 * Parse a unit string to grams (or ml, treated equivalently for ratio math).
 * Returns a safe positive number — NEVER 0 or NaN.
 * Falls back to 250 if unparseable.
 *
 * BUG #2 FIX: Returns minimum 1, never 0, so callers dividing by this
 * value (ratio = sizeGrams / baseGrams) can never produce Infinity or NaN.
 *
 * Examples:
 *   "250g"  → 250      "1kg"   → 1000
 *   "500ml" → 500      "1L"    → 1000
 *   "1,5kg" → 1500     "100"   → 100
 *   ""      → 250      "abc"   → 250
 *   "0g"    → 250      "-1g"   → 250  (non-positive → fallback)
 */
export function parseGrams(unit) {
  const raw = String(unit || '').toLowerCase().trim();
  if (!raw) return 250;

  const s = normaliseDecimalComma(raw);
  let result;

  if (s.includes('kg'))                     result = parseFloat(s) * 1000;
  else if (s.includes('ml'))                result = parseFloat(s);
  else if (s.endsWith('l') && !s.includes('ml')) result = parseFloat(s) * 1000;
  else if (s.includes('g'))                 result = parseFloat(s);
  else                                      result = parseFloat(s);

  // Guard: NaN, Infinity, zero, and negatives all fall back to 250
  return (isFinite(result) && result > 0) ? result : 250;
}

/**
 * Derive display-friendly unit type from a unit string.
 * Returns 'weight' | 'liquid' | 'piece'.
 */
export function unitType(unit) {
  const s = String(unit || '').toLowerCase().trim();
  if (s.includes('ml') || (s.includes('l') && !s.includes('ml'))) return 'liquid';
  if (s.includes('g')  || s.includes('kg')) return 'weight';
  return 'piece';
}
