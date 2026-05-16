// ── src/lib/pricing/engine.js ────────────────────────────────────────────────
// Core 6-stage pricing engine.
// All arithmetic in integer paise — zero float drift.
//
// ARCHITECTURE: runCalc() returns raw finance primitives only.
// Formatting, UI labels, psychological suggestions → engine.present.js
// ─────────────────────────────────────────────────────────────────────────────

import { toPaise, toRupees, safeNum } from './money.js';
import { addGst, removeGst }          from './gst.js';

export function runCalc(f) {
  const gst_registered = !!f.gst_registered;

  // ── Stage 1: Product cost (COGS) ─────────────────────────────────────────
  // BUG #1 FIX: safeNum() instead of Number() — prevents NaN propagation
  // when API returns '', undefined, null, or 'abc' for any field.
  const purchase_p  = toPaise(f.purchase);
  const gst_in      = safeNum(f.gst_in);
  const inbound_p   = toPaise(f.inbound);
  const handling_p  = toPaise(f.handling);
  const damage_pct  = safeNum(f.damage_pct);

  const gst_amt_p   = Math.round(purchase_p * gst_in / 100);
  const dmg_base_p  = gst_registered ? purchase_p : (purchase_p + gst_amt_p);
  const dmg_amt_p   = Math.round(dmg_base_p * damage_pct / 100);
  const s1_add_p    = gst_amt_p + inbound_p + handling_p + dmg_amt_p;
  const landed_p    = purchase_p + s1_add_p;

  // ── Stage 2: Packaging & storage ─────────────────────────────────────────
  const packaging_p = toPaise(f.packaging);
  const labor_p     = toPaise(f.labor);
  const warehouse_p = toPaise(f.warehouse);
  const inventory_p = toPaise(f.inventory);
  const s2_add_p    = packaging_p + labor_p + warehouse_p + inventory_p;
  const after_pkg_p = landed_p + s2_add_p;

  // ── Stage 3: Logistics & payments ────────────────────────────────────────
  const shipping_p      = toPaise(f.shipping);
  const cod_charge_p    = toPaise(f.cod_charge);
  const cod_pct         = safeNum(f.cod_pct);
  const pg_p            = toPaise(f.pg);
  const gst_log         = safeNum(f.gst_log);

  const blended_cod_p    = Math.round(cod_charge_p * cod_pct / 100);
  const courier_base_p   = shipping_p + blended_cod_p;
  const gst_on_courier_p = Math.round(courier_base_p * gst_log / 100);
  const net_gst_log_p    = gst_registered ? 0 : gst_on_courier_p;
  const fulfilment_p     = courier_base_p + pg_p + net_gst_log_p;
  const s3_add_p         = fulfilment_p;
  const after_log_p      = after_pkg_p + s3_add_p;

  // ── Stage 4: Returns ──────────────────────────────────────────────────────
  const return_rate   = safeNum(f.return_rate);
  const return_cost_p = toPaise(f.return_cost);
  const ret_impact_p  = Math.round(return_cost_p * return_rate / 100);
  const after_ret_p   = after_log_p + ret_impact_p;

  // ── Stage 5: Platform, marketing & ops ───────────────────────────────────
  const platform_pct  = safeNum(f.platform_pct);
  const marketing_p   = toPaise(f.marketing);
  const ops_p         = toPaise(f.ops);
  const extra_p       = toPaise(f.extra);
  const gst_out       = safeNum(f.gst_out);
  const mrp_mult      = Math.max(1.0, Math.min(8.0, safeNum(f.mrp_mult, 2.0)));
  const profit_mode   = f.profit_mode || 'flat';
  const flat_profit_p = toPaise(f.profit);
  const target_margin = safeNum(f.target_margin);

  const fixed_add_p = marketing_p + ops_p + extra_p;
  const cost_base_p = after_ret_p + fixed_add_p;

  const p = Math.min(platform_pct / 100, 0.9999);
  const m = Math.min(target_margin  / 100, 0.9999);
  const g = gst_out / 100;

  // ── SP formula ────────────────────────────────────────────────────────────
  // Margin mode: SP = cost × (1+g) / [(1+g)(1-m) - p]
  let base_excl_gst_p;
  if (profit_mode === 'margin') {
    const denom = (1 + g) * (1 - m) - p;
    base_excl_gst_p = denom > 0.001
      ? Math.round(cost_base_p / denom)
      : cost_base_p * 100;
  } else {
    base_excl_gst_p = p < 0.9999
      ? Math.round((cost_base_p + flat_profit_p) / (1 - p))
      : (cost_base_p + flat_profit_p) * 100;
  }

  const sp_p           = addGst(base_excl_gst_p, gst_out);
  const platform_amt_p = Math.round((sp_p / (1 + g)) * p);
  const s5_add_p       = platform_amt_p + fixed_add_p;
  const total_p        = after_ret_p + s5_add_p;

  // ── Stage 6: Pricing output ───────────────────────────────────────────────
  const mrp_p        = Math.round(sp_p * mrp_mult);
  const margin_pct   = sp_p > 0 ? (sp_p - total_p) / sp_p * 100 : 0;
  const profit_val_p = sp_p - total_p;

  // BUG #3 FIX: Verify final profit after ALL deductions (GST + platform + ops).
  // profit_val_p is the ground truth — it IS the post-all-deduction profit.
  // below_breakeven is exported as a raw primitive so API consumers can check it
  // without importing the presentation layer.
  const below_breakeven = profit_val_p < 0;

  const disc           = sp_p > 0 && mrp_p > sp_p ? Math.round((1 - sp_p / mrp_p) * 100) : 0;
  const gst_total_p    = sp_p - base_excl_gst_p;
  const market_price_p = toPaise(f.market_price);
  const market_price_gap = market_price_p > 0 ? toRupees(market_price_p - sp_p) : null;

  // ── CM1/CM2/CM3 ───────────────────────────────────────────────────────────
  const cm1_p = sp_p - landed_p - s2_add_p - s3_add_p - ret_impact_p;
  const cm2_p = cm1_p - marketing_p;
  const cm3_p = cm2_p - ops_p - extra_p;

  return {
    landed:         toRupees(landed_p),
    after_pkg:      toRupees(after_pkg_p),
    after_log:      toRupees(after_log_p),
    after_ret:      toRupees(after_ret_p),
    total:          toRupees(total_p),
    sp:             toRupees(sp_p),
    mrp:            toRupees(mrp_p),
    base_price:     toRupees(base_excl_gst_p),
    base_excl_gst:  toRupees(base_excl_gst_p),
    s1_add:         toRupees(s1_add_p),
    s2_add:         toRupees(s2_add_p),
    s3_add:         toRupees(s3_add_p),
    ret_impact:     toRupees(ret_impact_p),
    s5_add:         toRupees(s5_add_p),
    gst_amt:        toRupees(gst_amt_p),
    dmg_amt:        toRupees(dmg_amt_p),
    blended_cod:    toRupees(blended_cod_p),
    platform_amt:   toRupees(platform_amt_p),
    gst_total:      toRupees(gst_total_p),
    cgst:           toRupees(Math.floor(gst_total_p / 2)),
    sgst:           toRupees(gst_total_p - Math.floor(gst_total_p / 2)),
    gst_on_courier: toRupees(gst_on_courier_p),
    net_gst_log:    toRupees(net_gst_log_p),
    margin_pct,
    profit_val:     toRupees(profit_val_p),
    below_breakeven,   // BUG #3: raw boolean exported — present layer no longer re-derives it
    disc,
    mrp_mult,
    market_price_gap,
    cm1:     toRupees(cm1_p),
    cm2:     toRupees(cm2_p),
    cm3:     toRupees(cm3_p),
    cm1_pct: sp_p > 0 ? cm1_p / sp_p * 100 : 0,
    cm2_pct: sp_p > 0 ? cm2_p / sp_p * 100 : 0,
    cm3_pct: sp_p > 0 ? cm3_p / sp_p * 100 : 0,
  };
}
