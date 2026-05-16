// ── src/lib/pricing/money.js ──────────────────────────────────────────────────
// Money primitives: paise conversion + display formatting.
// ⚠️  RULE: ALL financial arithmetic must stay in integer paise.
//     toRupees() is DISPLAY ONLY — never feed its result back into arithmetic.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safe number coercion — the ONLY way to convert external input to a number
 * inside the pricing engine. Never use Number() or parseFloat() directly
 * on values that come from API responses or form fields.
 *
 * Returns fallback (default 0) for: null, undefined, '', 'abc', NaN, Infinity.
 * This prevents NaN propagation through CM1/CM2/CM3/margin calculations.
 *
 * Usage:
 *   safeNum(f.damage_pct)        → 0 for any bad input
 *   safeNum(f.gst_rate, 5)       → 5 if gst_rate is missing
 *   safeNum(f.platform_pct, 0)   → 0 if undefined
 */
export function safeNum(v, fallback = 0) {
  const n = Number(v);
  return (isFinite(n) && !isNaN(n)) ? n : fallback;
}

/** Rupees → paise (integer). Safe for any input type. */
export function toPaise(rupees) {
  return Math.round(safeNum(rupees) * 100);
}

/**
 * Paise → rupees (float, 2dp).
 * ⚠️  DISPLAY ONLY — never use result in arithmetic.
 * Wrong:   toRupees(x) * 1.18   ← float drift returns!
 * Correct: addGst(x, 18)        ← stay in paise
 */
export function toRupees(paise) {
  return Math.round(paise) / 100;
}

/** Round to 2dp — display only, never for arithmetic */
export function r(n)    { return Math.round(safeNum(n) * 100) / 100; }
/** Round to integer */
export function ri(n)   { return Math.round(safeNum(n)); }
/** Format integer with Indian locale commas */
export function fmtN(n) { return ri(n).toLocaleString('en-IN'); }
/** Format as ₹ with Indian locale commas */
export function fmtR(n) { return '\u20B9' + fmtN(n); }

// ── Safe input parsing ────────────────────────────────────────────────────────

/**
 * Parse a user-input string to a clean float for validation purposes.
 * Returns NaN if the input is not numeric — callers must guard with isNaN().
 * ⚠️  Result must NEVER be fed directly into arithmetic. Pass through toPaise().
 *
 * Handles locale commas: "1,250.50" → 1250.50
 */
export function parseInputFloat(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return NaN;
  return parseFloat(String(rawValue).replace(/,/g, '').trim());
}

/**
 * Parse a unit/size string (e.g. "250g", "1kg", "500ml") to a float.
 * Handles European-style decimal commas: "1,5kg" → 1500g.
 * This is intentionally parseFloat — unit strings are not money.
 * Only used for ratio calculations, never for price arithmetic.
 */
export function parseUnitFloat(unitString) {
  // Normalise European decimal comma → dot before parsing
  const normalised = String(unitString).trim().replace(/,(\d)$/, '.$1');
  return parseFloat(normalised);
}
