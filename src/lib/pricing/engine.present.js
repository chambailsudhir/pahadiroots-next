// ── src/lib/pricing/engine.present.js ────────────────────────────────────────
// Presentation layer — UI enrichment only.
// below_breakeven is now a raw primitive from runCalc(), not re-derived here.
// ─────────────────────────────────────────────────────────────────────────────

import { marginHealth }                          from './margins.js';
import { psychologicalRound, smartPriceOptions } from './psychology.js';

export function presentCalc(raw) {
  if (!raw) return raw;
  const psyOptions = smartPriceOptions(raw.sp);
  const psyMrp     = psychologicalRound(raw.mrp);
  return {
    ...raw,
    margin_health:   marginHealth(raw.margin_pct),
    // below_breakeven comes from runCalc() — do NOT re-derive here.
    // Re-deriving (raw.profit_val < 0) would duplicate the source of truth
    // and can silently diverge if profit_val rounding changes.
    psy_sp:          psyOptions.psychological,
    psy_mrp:         psyMrp,
    psy_discount:    psyOptions.discount_pct_from_raw,
  };
}

export function runAndPresent(f) {
  const { runCalc } = require('./engine.js');
  return presentCalc(runCalc(f));
}
