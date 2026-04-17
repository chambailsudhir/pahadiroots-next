// ── Shared pricing calculation engine ─────────────────────────
// Single source of truth for all 6-stage unit economics.
// Import in any pricing page to get consistent numbers.

export const GST_RATES = [0, 5, 12, 18, 28];

export const DEFAULT_F = {
  purchase: 100, gst_in: 5,
  inbound: 12, handling: 3, damage_pct: 2,
  packaging: 20, labor: 8, warehouse: 10, inventory: 5,
  shipping: 65, cod_charge: 20, cod_pct: 60, pg: 5, gst_log: 18,
  return_rate: 10, return_cost: 120,
  platform_pct: 0, marketing: 0, ops: 0, extra: 0,
  profit: 125, mrp_mult: 1.6, gst_out: 5,
};

export const STAGE_META = [
  { num: 1, label: 'Product cost',              sub: 'Purchase price landed at warehouse',      color: '#378ADD', tint: 'rgba(55,138,221,0.07)',  badge: '#E6F1FB', badgeText: '#185FA5' },
  { num: 2, label: 'Packaging & storage',       sub: 'Packing, warehouse & inventory holding', color: '#C8820A', tint: 'rgba(200,130,10,0.07)',   badge: '#FAEEDA', badgeText: '#854F0B' },
  { num: 3, label: 'Logistics & payments',      sub: 'Delivery, COD mix & payment gateway',    color: '#1D9E75', tint: 'rgba(29,158,117,0.07)',   badge: '#E1F5EE', badgeText: '#0F6E56' },
  { num: 4, label: 'Returns',                   sub: 'Loss from returned orders per unit',      color: '#E24B4A', tint: 'rgba(226,75,74,0.07)',    badge: '#FCEBEB', badgeText: '#A32D2D' },
  { num: 5, label: 'Platform, marketing & ops', sub: 'Commission, ads & operating cost',       color: '#7F77DD', tint: 'rgba(127,119,221,0.07)',  badge: '#EEEDFE', badgeText: '#534AB7' },
  { num: 6, label: 'Profit & final price',      sub: 'Target margin, output GST & MRP',        color: '#639922', tint: 'rgba(99,153,34,0.07)',    badge: '#EAF3DE', badgeText: '#3B6D11' },
];

export function r(n)    { return Math.round(n * 100) / 100; }
export function ri(n)   { return Math.round(n); }
export function fmtN(n) { return ri(n).toLocaleString('en-IN'); }
export function fmtR(n) { return '\u20B9' + fmtN(n); }

// ── Core calc — all 6 stages, fully explicit ──────────────────
export function runCalc(f) {
  // Stage 1 — Product cost
  const purchase   = Number(f.purchase)   || 0;
  const gst_in     = Number(f.gst_in)     || 0;
  const inbound    = Number(f.inbound)    || 0;
  const handling   = Number(f.handling)   || 0;
  const damage_pct = Number(f.damage_pct) || 0;
  const gst_amt    = purchase * (gst_in / 100);
  const dmg_amt    = (purchase + gst_amt) * (damage_pct / 100);
  const s1_add     = gst_amt + inbound + handling + dmg_amt;
  const landed     = purchase + s1_add;

  // Stage 2 — Packaging & storage
  const packaging = Number(f.packaging) || 0;
  const labor     = Number(f.labor)     || 0;
  const warehouse = Number(f.warehouse) || 0;
  const inventory = Number(f.inventory) || 0;
  const s2_add    = packaging + labor + warehouse + inventory;
  const after_pkg = landed + s2_add;

  // Stage 3 — Logistics & payments
  const shipping    = Number(f.shipping)   || 0;
  const cod_charge  = Number(f.cod_charge) || 0;
  const cod_pct     = Number(f.cod_pct)    || 0;
  const pg          = Number(f.pg)         || 0;
  const gst_log     = Number(f.gst_log)    || 0;
  const blended_cod = cod_charge * (cod_pct / 100);
  const log_raw     = shipping + blended_cod + pg;
  const s3_add      = log_raw * (1 + gst_log / 100);
  const after_log   = after_pkg + s3_add;

  // Stage 4 — Returns (owns ret_impact — NOT bundled into stage 5)
  const return_rate = Number(f.return_rate) || 0;
  const return_cost = Number(f.return_cost) || 0;
  const ret_impact  = return_cost * (return_rate / 100);
  const after_ret   = after_log + ret_impact;

  // Stage 5 — Platform, marketing & ops
  const platform_pct = Number(f.platform_pct) || 0;
  const marketing    = Number(f.marketing)    || 0;
  const ops          = Number(f.ops)          || 0;
  const extra        = Number(f.extra)        || 0;
  const platform_amt = after_log * (platform_pct / 100);
  const s5_add       = platform_amt + marketing + ops + extra;
  const total        = after_ret + s5_add;

  // Stage 6 — Profit & pricing
  const profit        = Number(f.profit)   || 0;
  const gst_out       = Number(f.gst_out)  || 0;
  const mrp_mult      = Number(f.mrp_mult) || 1;
  const base_excl_gst = total + profit;
  const sp            = base_excl_gst * (1 + gst_out / 100);
  const mrp           = sp * mrp_mult;
  const margin_pct    = sp > 0 ? (sp - total) / sp * 100 : 0;
  const profit_val    = sp - total;
  const disc          = sp > 0 && mrp > sp ? Math.round((1 - sp / mrp) * 100) : 0;
  const base_price    = sp / (1 + gst_out / 100);
  const gst_total     = sp - base_price;

  return {
    landed, after_pkg, after_log, after_ret, total, sp, mrp, base_price,
    s1_add, s2_add, s3_add, ret_impact, s5_add,
    gst_amt, dmg_amt, blended_cod, platform_amt,
    margin_pct, profit_val, disc,
    gst_total, cgst: gst_total / 2, sgst: gst_total / 2, base_excl_gst,
  };
}
