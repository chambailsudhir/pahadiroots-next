// ── src/lib/pricing/variants/pricing.js ──────────────────────────────────────
// Variant price calculation: ratio engine + psychological rounding +
// FMCG margin model.
// ─────────────────────────────────────────────────────────────────────────────

import { toPaise, toRupees, safeNum }              from '../money.js';
import { removeGst }                               from '../gst.js';
import { psychologicalRound }                      from '../psychology.js';
import { parseGrams }                              from './units.js';
import { courierSlabCost, packagingCost,
         fragilitySurcharge, regionalCourierCost } from './logistics.js';

// ── Pricing strategies ────────────────────────────────────────────────────────

function linearPrice(basePaise, ratio) {
  return Math.round(basePaise * ratio);
}

function marginProtectedPrice(basePaise, ratio) {
  if (ratio < 1) return Math.round(basePaise * ratio * 1.08);
  if (ratio > 1) return Math.round(basePaise * ratio * 0.92);
  return basePaise;
}

function psychologicalPrice(basePaise, ratio) {
  const raw = marginProtectedPrice(basePaise, ratio);
  return toPaise(psychologicalRound(toRupees(raw)));
}

const STRATEGIES = {
  linear:             linearPrice,
  'margin-protected': marginProtectedPrice,
  psychological:      psychologicalPrice,
};

// ── FMCG cost model ───────────────────────────────────────────────────────────

function buildFmcgCosts(sizeGrams, rawPaise, fmcgOptions) {
  const pkgType       = fmcgOptions.packagingType || 'standard';
  const slabBase      = courierSlabCost(sizeGrams, fmcgOptions.courierSlabs || null);
  const courierRupees = regionalCourierCost(slabBase, fmcgOptions.regionCode || null);
  const pkgRupees     = packagingCost(sizeGrams, pkgType);
  const extraReturn   = fragilitySurcharge(pkgType);
  const returnImpactP = Math.round(rawPaise * (extraReturn / 100));
  const adjustedCostPaise = toPaise(courierRupees) + toPaise(pkgRupees) + returnImpactP;
  return {
    adjustedCostPaise,
    factors: {
      courier_cost:            courierRupees,
      packaging_cost:          pkgRupees,
      fragility_surcharge_pct: extraReturn,
      return_impact:           toRupees(returnImpactP),
      region_code:             fmcgOptions.regionCode || null,
    },
  };
}

/**
 * Calculate prices for a set of variant sizes from a base size/price.
 *
 * @param {number|string} basePrice   - selling price of base variant (incl GST)
 * @param {string}        baseUnit    - e.g. "250g", "500ml"
 * @param {string[]}      sizes       - e.g. ["100g","500g","1kg"]
 * @param {number}        gstRate     - output GST % (e.g. 5)
 * @param {string}        [strategy]
 * @param {object|null}   [fmcgOptions]
 */
export function calcVariantPrices(
  basePrice, baseUnit, sizes, gstRate,
  strategy = 'psychological',
  fmcgOptions = null,
) {
  // BUG #2 FIX: parseGrams() now returns minimum 1 (never 0 or NaN),
  // so this division can never produce Infinity or NaN.
  // Guard here is belt-and-suspenders in case parseGrams is called externally.
  const baseGrams = parseGrams(baseUnit);
  if (!baseGrams || baseGrams <= 0) {
    // Should not happen after parseGrams fix, but log and return empty
    // rather than propagating Infinity through all variant prices.
    console.error('[pricing/variants] baseUnit parsed to non-positive:', baseUnit, '→', baseGrams);
    return [];
  }

  const basePaise     = toPaise(basePrice);
  const baseExclPaise = removeGst(basePaise, safeNum(gstRate));
  const priceFn       = STRATEGIES[strategy] || STRATEGIES.psychological;

  return sizes.map(size => {
    // BUG #2: Each size also guarded — malformed size string → use baseGrams (ratio=1)
    const sizeGrams = parseGrams(size);
    const ratio     = sizeGrams / baseGrams;  // safe: both > 0

    const rawPaise     = priceFn(basePaise, ratio);
    const sellingPrice = toRupees(rawPaise);
    const baseExcl     = toRupees(removeGst(rawPaise, safeNum(gstRate)));

    const scaledCostP = Math.round(baseExclPaise * ratio);
    let   extraCostP  = 0;
    let   fmcgFactors = null;

    if (fmcgOptions) {
      const { adjustedCostPaise, factors } = buildFmcgCosts(sizeGrams, rawPaise, fmcgOptions);
      extraCostP  = adjustedCostPaise;
      fmcgFactors = factors;
    }

    const totalCostP = scaledCostP + extraCostP;
    const marginPct  = rawPaise > 0 ? (rawPaise - totalCostP) / rawPaise * 100 : 0;

    return {
      variant_value:  size,
      price:          sellingPrice,
      original_price: baseExcl,
      _base:          baseExcl,
      margin_pct:     Math.round(marginPct * 10) / 10,
      fmcg:           fmcgFactors,
    };
  });
}
