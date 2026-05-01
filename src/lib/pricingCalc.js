// ── Shared pricing calculation engine ─────────────────────────
// Single source of truth for all 6-stage unit economics.
// Import in any pricing page to get consistent numbers.
//
// v9 fixes:
//  • Exact algebraic platform-fee formula (no more two-pass approximation)
//  • Damage % applied on purchase price only (GST is ITC-reclaimable for registered)
//  • Corrected logistics GST base (courier only, PG excluded from GST re-application)
//  • GST-registered toggle: ITC recovery on logistics & damage
//  • Market-realistic defaults for hill-state D2C (shipping ₹110, COD ₹40, returns ₹180)
//  • mrp_mult clamped to [1.0, 8.0] with validation
//  • profit_val negative flag (below_breakeven)
//  • market_price labelled as ACTUAL selling price (not MRP)
//  • Field validation rules (min/max) for all inputs
//  • Business-type presets (Pahadi, D2C, Marketplace) with calibrated margin thresholds

export const GST_RATES = [0, 5, 12, 18, 28];

// ── Business-type presets ─────────────────────────────────────
export const BUSINESS_TYPES = [
  {
    id: 'pahadi',
    label: 'Pahadi / Hill-state D2C',
    desc: 'Artisan, organic, mountain products shipped from Uttarakhand / HP',
    marginHealthy: 35,
    marginTight: 25,
    defaults: {
      shipping: 110, cod_charge: 40, cod_pct: 65, return_cost: 180,
      return_rate: 12, damage_pct: 2, mrp_mult: 2.0,
    },
  },
  {
    id: 'd2c',
    label: 'General D2C brand',
    desc: 'Direct-to-consumer, own website, no marketplace commission',
    marginHealthy: 30,
    marginTight: 20,
    defaults: {
      shipping: 90, cod_charge: 35, cod_pct: 60, return_cost: 140,
      return_rate: 10, damage_pct: 1.5, mrp_mult: 1.8,
    },
  },
  {
    id: 'marketplace',
    label: 'Marketplace seller',
    desc: 'Amazon, Flipkart, Meesho — high commission, broad reach',
    marginHealthy: 25,
    marginTight: 15,
    defaults: {
      shipping: 65, cod_charge: 30, cod_pct: 70, return_cost: 120,
      return_rate: 15, damage_pct: 1, mrp_mult: 2.5,
    },
  },
];

export const DEFAULT_F = {
  // Stage 1
  purchase: 100, gst_in: 5,
  inbound: 12, handling: 3, damage_pct: 2,
  // Stage 2
  packaging: 20, labor: 8, warehouse: 10, inventory: 5,
  // Stage 3 — hill-state D2C realistic defaults
  shipping: 110, cod_charge: 40, cod_pct: 65, pg: 7, gst_log: 18,
  // Stage 4 — hill-state reverse logistics realistic
  return_rate: 12, return_cost: 180,
  // Stage 5
  platform_pct: 0, marketing: 0, ops: 0, extra: 0,
  // Stage 6
  profit_mode: 'flat', profit: 125, target_margin: 30,
  mrp_mult: 2.0, gst_out: 5,
  // GST registration (affects damage base and logistics ITC recovery)
  gst_registered: false,
  // Competitor ACTUAL selling price (not their MRP). 0 = not set.
  market_price: 0,
  // Active business type preset
  business_type: 'pahadi',
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

// ── Per-field validation rules ────────────────────────────────
export const FIELD_RULES = {
  purchase:      { min: 1,     max: 1000000, label: 'Purchase price' },
  gst_in:        { min: 0,     max: 28,      label: 'Input GST' },
  inbound:       { min: 0,     max: 10000,   label: 'Inbound shipping' },
  handling:      { min: 0,     max: 10000,   label: 'Handling' },
  damage_pct:    { min: 0,     max: 50,      label: 'Transit damage %' },
  packaging:     { min: 0,     max: 10000,   label: 'Packaging material' },
  labor:         { min: 0,     max: 10000,   label: 'Packing labour' },
  warehouse:     { min: 0,     max: 10000,   label: 'Warehouse rent' },
  inventory:     { min: 0,     max: 10000,   label: 'Inventory holding' },
  shipping:      { min: 0,     max: 10000,   label: 'Forward shipping' },
  cod_charge:    { min: 0,     max: 500,     label: 'COD charge' },
  cod_pct:       { min: 0,     max: 100,     label: 'COD order mix' },
  pg:            { min: 0,     max: 500,     label: 'Payment gateway' },
  gst_log:       { min: 0,     max: 28,      label: 'GST on logistics' },
  return_rate:   { min: 0,     max: 100,     label: 'Return rate' },
  return_cost:   { min: 0,     max: 10000,   label: 'Cost per return' },
  platform_pct:  { min: 0,     max: 50,      label: 'Platform fee' },
  marketing:     { min: 0,     max: 100000,  label: 'Marketing / CAC' },
  ops:           { min: 0,     max: 100000,  label: 'Ops & support' },
  extra:         { min: 0,     max: 100000,  label: 'Hidden / extra' },
  profit:        { min: 0,     max: 1000000, label: 'Target profit' },
  target_margin: { min: 1,     max: 90,      label: 'Target margin' },
  mrp_mult:      { min: 1.0,   max: 8.0,     label: 'MRP multiplier' },
  market_price:  { min: 0,     max: 10000000,label: 'Competitor price' },
};

export function validateField(key, rawVal) {
  const rule = FIELD_RULES[key];
  if (!rule) return null;
  const n = parseFloat(rawVal);
  if (isNaN(n)) return `${rule.label} must be a number`;
  if (n < rule.min) return `${rule.label} must be ≥ ${rule.min}`;
  if (n > rule.max) return `${rule.label} must be ≤ ${rule.max}`;
  return null;
}

// ── Core calc — all 6 stages, fully explicit ──────────────────
export function runCalc(f) {
  const gst_registered = !!f.gst_registered;

  // ── Stage 1 — Product cost ────────────────────────────────
  const purchase   = Number(f.purchase)   || 0;
  const gst_in     = Number(f.gst_in)     || 0;
  const inbound    = Number(f.inbound)    || 0;
  const handling   = Number(f.handling)   || 0;
  const damage_pct = Number(f.damage_pct) || 0;

  const gst_amt = purchase * (gst_in / 100);

  // FIX: Damage base is purchase price only for GST-registered sellers
  // (input GST is claimable as ITC; only the ex-GST purchase is a real write-off loss).
  // Unregistered sellers: GST is a sunk cost, so include it in damage base.
  const dmg_base = gst_registered ? purchase : (purchase + gst_amt);
  const dmg_amt  = dmg_base * (damage_pct / 100);

  const s1_add = gst_amt + inbound + handling + dmg_amt;
  const landed  = purchase + s1_add;

  // ── Stage 2 — Packaging & storage ────────────────────────
  const packaging = Number(f.packaging) || 0;
  const labor     = Number(f.labor)     || 0;
  const warehouse = Number(f.warehouse) || 0;
  const inventory = Number(f.inventory) || 0;
  const s2_add    = packaging + labor + warehouse + inventory;
  const after_pkg = landed + s2_add;

  // ── Stage 3 — Logistics & payments ───────────────────────
  // FIX: GST @ 18% applies only to courier services (forward + COD charges).
  // Payment gateway fee is a financial service — gateway quotes are GST-inclusive
  // already (18% embedded). Do NOT apply gst_log to PG fee again.
  // For GST-registered sellers, logistics GST is recoverable ITC → net cost = 0.
  const shipping   = Number(f.shipping)   || 0;
  const cod_charge = Number(f.cod_charge) || 0;
  const cod_pct    = Number(f.cod_pct)    || 0;
  const pg         = Number(f.pg)         || 0;
  const gst_log    = Number(f.gst_log)    || 0;

  const blended_cod    = cod_charge * (cod_pct / 100);
  const courier_base   = shipping + blended_cod;
  const gst_on_courier = courier_base * (gst_log / 100);
  const net_gst_log    = gst_registered ? 0 : gst_on_courier;

  const s3_add   = courier_base + pg + net_gst_log;
  const after_log = after_pkg + s3_add;

  // ── Stage 4 — Returns ─────────────────────────────────────
  const return_rate = Number(f.return_rate) || 0;
  const return_cost = Number(f.return_cost) || 0;
  const ret_impact  = return_cost * (return_rate / 100);
  const after_ret   = after_log + ret_impact;

  // ── Stage 5 — Platform, marketing & ops ──────────────────
  // FIX: Exact closed-form algebraic solution — no two-pass approximation.
  // Platform charges % of SELLING PRICE (as Meesho, Amazon, Flipkart do).
  //
  // Let SP_excl = SP before output GST.
  // Let p = platform_pct/100, m = target_margin/100 (fraction of SP)
  // Let cost_base = after_ret + fixed_costs (marketing + ops + extra)
  //
  // Flat mode:
  //   SP_excl = (cost_base + flat_profit) / (1 - p)
  //   because: platform_amt = SP_excl × p → total_cost = cost_base + SP_excl × p
  //            SP_excl = total_cost + flat_profit → SP_excl(1-p) = cost_base + flat_profit
  //
  // Margin mode:
  //   Gross margin = (SP_excl - total_cost) / SP_excl = m
  //   total_cost = cost_base + SP_excl × p
  //   Substituting: SP_excl - cost_base - SP_excl×p = m×SP_excl
  //   SP_excl(1 - p - m) = cost_base  →  SP_excl = cost_base / (1 - p - m)
  //   Which is identical to: cost_base / ((1-m)(1-p)) only when cross-terms are small.
  //   We use the exact form: cost_base / (1 - p - m).

  const platform_pct = Number(f.platform_pct) || 0;
  const marketing    = Number(f.marketing)    || 0;
  const ops          = Number(f.ops)          || 0;
  const extra        = Number(f.extra)        || 0;
  const gst_out      = Number(f.gst_out)      || 0;
  const mrp_mult     = Math.max(1.0, Math.min(8.0, Number(f.mrp_mult) || 2.0));

  const profit_mode   = f.profit_mode || 'flat';
  const flat_profit   = Number(f.profit)        || 0;
  const target_margin = Number(f.target_margin) || 0;

  const fixed_add = marketing + ops + extra;
  const cost_base = after_ret + fixed_add;

  const p = Math.min(platform_pct / 100, 0.9999);
  const m = Math.min(target_margin / 100, 0.9999);

  let base_excl_gst;
  if (profit_mode === 'margin') {
    // CORRECT formula derivation:
    // margin = (sp - total) / sp = m, where sp = base_excl_gst*(1+g)
    // total = cost_base + base_excl_gst*p (platform on excl-GST base)
    // Solving: base_excl_gst*[(1+g)*(1-m) - p] = cost_base
    // → base_excl_gst = cost_base / [(1+g)*(1-m) - p]
    // NB: when gst_out=0 this reduces to cost_base/(1-m-p) which is the simpler form.
    // The old formula cost_base/(1-p-m) was missing the (1+g) factor, causing
    // actual margin to be ~(target/(1-target))*gst_out percentage points higher.
    const g = gst_out / 100;
    const denom = (1 + g) * (1 - m) - p;
    // Guard: denom must be positive — if platform+margin overwhelm GST-grossed price
    base_excl_gst = denom > 0.001 ? cost_base / denom : cost_base * 100;
  } else {
    base_excl_gst = p < 0.9999 ? (cost_base + flat_profit) / (1 - p) : (cost_base + flat_profit) * 100;
  }

  const sp = base_excl_gst * (1 + gst_out / 100);

  // Back-compute exact platform_amt from final SP
  const platform_amt = (sp / (1 + gst_out / 100)) * p;
  const s5_add       = platform_amt + fixed_add;
  const total        = after_ret + s5_add;

  // ── Stage 6 — Profit & pricing ────────────────────────────
  const mrp             = sp * mrp_mult;
  const margin_pct      = sp > 0 ? (sp - total) / sp * 100 : 0;
  const profit_val      = sp - total;
  const below_breakeven = profit_val < 0;

  const disc       = sp > 0 && mrp > sp ? Math.round((1 - sp / mrp) * 100) : 0;
  const base_price = sp / (1 + gst_out / 100);
  const gst_total  = sp - base_price;

  // Market price gap. Requires competitor ACTUAL SELLING price, not their MRP.
  // Positive = you are cheaper than competitor.
  const market_price     = Number(f.market_price) || 0;
  const market_price_gap = market_price > 0 ? market_price - sp : null;

  return {
    landed, after_pkg, after_log, after_ret, total, sp, mrp, base_price,
    s1_add, s2_add, s3_add, ret_impact, s5_add,
    gst_amt, dmg_amt, blended_cod, platform_amt,
    margin_pct, profit_val, disc, below_breakeven,
    gst_total, cgst: gst_total / 2, sgst: gst_total / 2, base_excl_gst,
    market_price_gap,
    gst_on_courier,
    net_gst_log,
    mrp_mult,
  };
}
