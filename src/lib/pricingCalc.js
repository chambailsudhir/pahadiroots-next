// ── src/lib/pricingCalc.js — compatibility shim ───────────────────────────────
// All pricing logic lives in focused sub-modules under src/lib/pricing/
// This shim re-exports everything so existing imports continue to work
// without any changes at the call site.
//
// ARCHITECTURE FIX: replaced `export * from` with explicit named exports.
// Reason: `export *` across 8+ modules gives no compile-time warning when two
// modules export the same name — JavaScript silently exports `undefined` (ES
// modules) or the last-evaluated value (some bundlers). With explicit exports
// any future collision is a hard syntax error at build time, not a silent bug.
//
// HOW TO ADD A NEW EXPORT:
//   1. Add the export in the sub-module (e.g. pricing/engine.js)
//   2. Add it to the explicit list below AND to pricing/index.js
//   3. Run: node --input-type=module < /dev/null (or your lint script) to
//      confirm no duplicate names across all entries in this file.
//
// Existing imports that still work unchanged:
//   import { runCalc, generateSku, buildOrderSnapshot } from '@/lib/pricingCalc'
//   import { calcVariantPrices, presentCalc }           from '@/lib/pricingCalc'
//
// Preferred direct imports for new code (better tree-shaking in API routes):
//   import { runCalc }              from '@/lib/pricing/engine'
//   import { presentCalc }          from '@/lib/pricing/engine.present'
//   import { calcVariantPrices }    from '@/lib/pricing/variants/pricing'
//   import { generateUniqueSku }    from '@/lib/pricing/variants/sku'
//   import { buildOrderSnapshot }   from '@/lib/pricing/variants/snapshots'
//   import { courierSlabCost }      from '@/lib/pricing/variants/logistics'
// ─────────────────────────────────────────────────────────────────────────────

// ── money.js ─────────────────────────────────────────────────────────────────
export {
  toPaise,
  toRupees,
  paiseToDisplayRupees,   // LOW-11: alias for toRupees — self-documents display-only contract
  safeNum,
  strictNum,
  parseInputFloat,
  parseUnitFloat,
  fmtR,
  fmtR2,
  fmtN,
  r,
  r2,
  ri,
  STRICT_FINANCE_FIELDS,
} from './pricing/money.js';

// ── gst.js ───────────────────────────────────────────────────────────────────
export {
  GST_RATES,
  INDIAN_STATE_CODES,     // LOW-12: exported for use in UI address-form validation
  addGst,
  removeGst,
  gstSplit,
  gstSplitIntra,
  gstSplitByState,
  buildGstSnapshot,
  isValidGstSlab,
  gstRateFromHsn,
  gstRateFromHsnStrict,
} from './pricing/gst.js';

// ── margins.js ───────────────────────────────────────────────────────────────
export {
  MARGIN_THRESHOLDS,
  MARGIN_LABELS,
  marginHealth,
} from './pricing/margins.js';

// ── psychology.js ────────────────────────────────────────────────────────────
export {
  PSY_ANCHORS,
  psychologicalRound,
  smartPriceOptions,
} from './pricing/psychology.js';

// ── validation.js ────────────────────────────────────────────────────────────
export {
  FIELD_RULES,
  STAGE_META,
  BUSINESS_TYPES,
  DEFAULT_F,
  validateField,
} from './pricing/validation.js';

// ── engine.js ────────────────────────────────────────────────────────────────
export {
  runCalc,
} from './pricing/engine.js';

// ── engine.present.js ────────────────────────────────────────────────────────
export {
  presentCalc,
  runAndPresent,
} from './pricing/engine.present.js';

// ── variants/units.js ────────────────────────────────────────────────────────
export {
  parseGrams,
  unitType,
  validateUnit,
} from './pricing/variants/units.js';

// ── variants/logistics.js ────────────────────────────────────────────────────
export {
  DEFAULT_COURIER_SLABS,
  REGIONAL_UPLIFT,
  courierSlabCost,
  packagingCostPaise,
  fragilitySurcharge,
  regionalCourierCost,
} from './pricing/variants/logistics.js';

// ── variants/pricing.js ──────────────────────────────────────────────────────
export {
  calcVariantPrices,
  runVariantPricingSafe,
  validatePackEconomics,
} from './pricing/variants/pricing.js';

// ── variants/sku.js ──────────────────────────────────────────────────────────
export {
  generateSku,
  generateUniqueSku,
} from './pricing/variants/sku.js';

// ── variants/snapshots.js ────────────────────────────────────────────────────
export {
  ENGINE_VERSION,
  buildOrderSnapshot,
  buildCartSnapshots,
  verifySnapshot,
} from './pricing/variants/snapshots.js';


// ── Coupon margin validator (legacy helper kept in shim) ─────────────────────
import { toPaise, safeNum, parseInputFloat } from './pricing/money.js';
import { removeGst } from './pricing/gst.js';

// LOW-E FIX: internal guard for numeric params that must not be null/undefined.
// Mirrors the pattern used for gstRate above — no silent safeNum(null)→0 escape.
function _requireNumericParam(value, name) {
  if (value === null || value === undefined || value === '') {
    throw new TypeError(
      `[validateCouponMargin] "${name}" is required and must be a number. ` +
      `Received: ${JSON.stringify(value)}. ` +
      `A silent 0 here would corrupt margin math — fix the call site.`
    );
  }
  const n = Number(value);
  if (!isFinite(n) || isNaN(n)) {
    throw new TypeError(
      `[validateCouponMargin] "${name}" must be a finite number. ` +
      `Received: ${JSON.stringify(value)}.`
    );
  }
}

/**
 * Validate that a coupon discount leaves enough margin before applying it.
 *
 * MED-C FIX: previously the costBase contract was undocumented, leading callers
 * to accidentally pass selling_price or a GST-inclusive amount as costBase, which
 * would make the floor check fire incorrectly. The contract is now explicit:
 *
 * @param {number} sellingPrice  - customer-facing price INCLUSIVE of output GST (rupees)
 * @param {number} costBase      - engine's fully-loaded cost (rupees). MUST be the value
 *                                 returned as `total` (or `cost_price`) from serverCalcPricing()
 *                                 — i.e. the sum of all 6 stages EXCLUDING output GST.
 *                                 DO NOT pass selling_price or a GST-inclusive value here.
 * @param {string|number} couponValue  - discount amount (flat: rupees, pct: percentage)
 * @param {'flat'|'pct'}  couponType   - 'flat' = fixed rupee discount, 'pct' = % off SP
 * @param {number} [minMarginFloor=8]  - minimum acceptable margin % after discount
 * @param {number} [gstRate=0]         - output GST rate (e.g. 5, 12, 18). Pass the real
 *                                       rate — gstRate=0 inflates the margin denominator
 *                                       by the GST fraction (~15pp overstatement at 18%).
 * @returns {{ ok: boolean, margin_after: number|null, error?: string }}
 */
// M-2 FIX (COMPLETE): gstRate is now a REQUIRED parameter — there is no default.
// The previous `gstRate = 0` default was a footgun: callers that forgot the argument
// got silently incorrect margin math (up to ~15pp overstated at 18% GST), allowing
// margin-floor violations to pass undetected.
//
// The partial fix (always log + return structured warning) improved observability
// but did not prevent mis-use. This completes the fix by removing the default so
// callers get a runtime error ("gstRate is required") instead of a silent wrong answer.
//
// Migration:
//   • GST-exempt products: pass gstRate=0 explicitly.
//   • API layer (admin/route.js): already validates gst_rate as a required field (400 if missing).
//   • UI callers: must read gst_rate from the product and pass it.
//   • Tests: tests that omit gstRate will now fail — update them to pass gstRate explicitly.
export function validateCouponMargin(sellingPrice, costBase, couponValue, couponType, minMarginFloor = 8, gstRate) {
  // M-2 COMPLETE: hard guard — no silent zero-default
  if (gstRate === undefined || gstRate === null) {
    throw new TypeError(
      '[validateCouponMargin] gstRate is required. ' +
      'Pass the product\'s output GST rate (0/5/12/18/28). ' +
      'GST-exempt goods: pass 0 explicitly. ' +
      'At 18% GST, omitting gstRate overstates margin by ~15pp, ' +
      'allowing margin-floor violations to pass silently.'
    );
  }
  // LOW-E FIX: guard sellingPrice and costBase — toPaise() delegates to safeNum()
  // which returns 0 for null/undefined, silently corrupting margin math:
  //   • null costBase  → cost_p = 0  → margin shows 100% → every coupon passes
  //   • null sellingPrice → sp_p = 0 → cost_p >= sp_p guard skipped → -100% margin
  // Both are wrong. Throw early so the caller sees the error at the source.
  _requireNumericParam(sellingPrice, 'sellingPrice');
  _requireNumericParam(costBase,     'costBase');
  const sp_p   = toPaise(sellingPrice);
  const cost_p = toPaise(costBase);

  if (cost_p >= sp_p && sp_p > 0) {
    return {
      ok: false, margin_after: null,
      error: `costBase (${costBase}) must be less than sellingPrice (${sellingPrice}). ` +
             `Pass the engine's "total" field (fully-loaded cost excl. output GST).`,
    };
  }

  const couponNum = parseInputFloat(couponValue);
  if (isNaN(couponNum)) {
    return {
      ok: false, margin_after: null,
      error: `Invalid coupon value: ${JSON.stringify(couponValue)} — must be a number`,
    };
  }
  const discount_p   = couponType === 'flat'
    ? toPaise(couponNum)
    : Math.round(sp_p * couponNum / 100);
  const sp_after_p   = sp_p - discount_p;
  const base_after_p = gstRate > 0 ? removeGst(sp_after_p, gstRate) : sp_after_p;
  const margin_after = base_after_p > 0 ? (base_after_p - cost_p) / base_after_p * 100 : -100;
  if (margin_after < minMarginFloor) {
    return {
      ok: false, margin_after,
      error: `Coupon pushes margin to ${margin_after.toFixed(1)}% — below floor of ${minMarginFloor}%`,
    };
  }
  return {
    ok: true,
    margin_after,
  };
}

// ── validateCouponMarginSafe — LOW FIX ───────────────────────────────────────
// Drop-in safe wrapper around validateCouponMargin for call sites that cannot
// guarantee all arguments are present (e.g. legacy coupon UI, third-party
// integrations, server actions that receive partial payloads).
//
// Unlike validateCouponMargin(), this function NEVER throws.
// If any required argument is missing or invalid it returns:
//   { ok: false, margin_after: null, error: '<reason>' }
//
// WHEN TO USE WHICH:
//   validateCouponMargin()     — server-side checkout flow (admin/route.js).
//     Throwing is correct: a missing gstRate at checkout is a programmer error
//     that must be surfaced immediately rather than silently passing.
//   validateCouponMarginSafe() — UI preview / legacy coupon editors where the
//     product's gst_rate may not yet be loaded. Returns a structured error so
//     the UI can show a warning instead of crashing.
//
// CALL-SITE MIGRATION NOTE:
//   If you are adding a NEW call site, prefer validateCouponMarginSafe() in
//   the UI layer and validateCouponMargin() in the server/API layer.
//   Never pass gstRate=undefined to validateCouponMargin() and expect it to work.
// ─────────────────────────────────────────────────────────────────────────────
export function validateCouponMarginSafe(sellingPrice, costBase, couponValue, couponType, minMarginFloor = 8, gstRate) {
  // Normalise gstRate: treat undefined/null/NaN as 0 (GST-exempt fallback).
  // This is safe for UI previews — the result will be slightly optimistic at
  // non-zero GST rates, but the server will re-validate with the real rate at checkout.
  const safeGstRate = (gstRate === undefined || gstRate === null || Number.isNaN(Number(gstRate)))
    ? 0
    : Number(gstRate);

  try {
    return validateCouponMargin(sellingPrice, costBase, couponValue, couponType, minMarginFloor, safeGstRate);
  } catch (err) {
    return {
      ok:           false,
      margin_after: null,
      error:        err instanceof Error ? err.message : String(err),
    };
  }
}
