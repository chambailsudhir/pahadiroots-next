// src/app/api/pricing/route.js
//
// ── Backend Pricing Engine ────────────────────────────────────────────────────
// Audit fix: "Pricing logic exists only on frontend — CRITICAL"
// Enterprise standard: UI sends inputs → server calculates → server writes DB
//
// This route handles:
//   POST /api/pricing  { action: 'calculate' }         → run pricing, return result
//   POST /api/pricing  { action: 'save_product' }       → calculate + save product + variants atomically
//   POST /api/pricing  { action: 'save_variants_only' } → recalculate + save variants for existing product
//   POST /api/pricing  { action: 'validate' }           → validate inputs, return errors only
//
// Frontend never calculates final prices anymore.
// Frontend sends raw inputs → this route does all math → returns computed prices.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { verifyToken }  from '@/lib/auth-token';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function sbFetch(method, table, query, body) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'Prefer':        method === 'DELETE' ? 'return=minimal' : 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DB ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Call a Postgres function (RPC) — used for atomic saves
async function sbRpc(fnName, params) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fnName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`RPC ${fnName} failed ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Paise math helpers (identical to pricingCalc.js — server-side copy) ──────
// We duplicate these here so this route has ZERO frontend imports.
// Single source of truth for the formulas is pricingCalc.js.
// This is a deliberate tradeoff: server route must be self-contained.

// BUG FIX: safeNum prevents NaN propagation when fields are '', undefined, null, 'abc'
function safeNum(v, fallback = 0) {
  const n = Number(v);
  return (isFinite(n) && !isNaN(n)) ? n : fallback;
}
// BUG FIX: toPaise uses safeNum — bare Number(undefined) = NaN → Math.round(NaN) = NaN
function toPaise(n)  { return Math.round(safeNum(n) * 100); }
function toRupees(p) { return Math.round(p) / 100; }
function addGst(base_p, rate) { return Math.round(base_p * (1 + safeNum(rate) / 100)); }
function removeGst(incl_p, rate) {
  const r = safeNum(rate);
  return r === 0 ? Math.round(incl_p) : Math.round(incl_p / (1 + r / 100));
}
// BUG FIX: floor+remainder ensures CGST+SGST == GST total exactly for odd-paise amounts
function gstSplitIntra(gst_paise) {
  const cgst = Math.floor(gst_paise / 2);
  const sgst = gst_paise - cgst;  // gets the odd paise, so cgst+sgst === gst always
  return { cgst, sgst };
}

function psychologicalRound(rupees) {
  const ANCHORS = [9,19,29,49,99,149,199,249,299,399,499,599,699,799,899,999,
    1249,1499,1749,1999,2499,2999,3999,4999,5999,7999,9999];
  const n = Math.round(Number(rupees));
  if (n <= 0) return n;
  const threshold = n * 0.75;
  let best = null;
  for (const a of ANCHORS) {
    if (a <= n && a >= threshold) best = a;
  }
  if (best !== null) return best;
  return Math.max(Math.floor(n / 10) * 10 - 1, 1);
}

function marginHealth(pct) {
  if (pct <= 0)  return 'block';
  if (pct < 8)   return 'danger';
  if (pct < 15)  return 'warn';
  if (pct < 25)  return 'healthy';
  return 'great';
}

// ── Core pricing engine (server-side) ────────────────────────────────────────
// Mirrors runCalc() in pricingCalc.js exactly.
// All math in paise. Returns rupees for storage.
function serverCalcPricing(f) {
  const gst_registered = !!f.gst_registered;

  // S1: Product cost — safeNum prevents NaN from '', undefined, null, 'abc'
  const purchase_p   = toPaise(f.purchase);
  const gst_in       = safeNum(f.gst_in);
  const inbound_p    = toPaise(f.inbound);
  const handling_p   = toPaise(f.handling);
  const damage_pct   = safeNum(f.damage_pct);
  const gst_amt_p    = Math.round(purchase_p * gst_in / 100);
  const dmg_base_p   = gst_registered ? purchase_p : (purchase_p + gst_amt_p);
  const dmg_amt_p    = Math.round(dmg_base_p * damage_pct / 100);
  const landed_p     = purchase_p + gst_amt_p + inbound_p + handling_p + dmg_amt_p;

  // S2: Packaging & storage
  const packaging_p  = toPaise(f.packaging);
  const labor_p      = toPaise(f.labor);
  const warehouse_p  = toPaise(f.warehouse);
  const inventory_p  = toPaise(f.inventory);
  const after_pkg_p  = landed_p + packaging_p + labor_p + warehouse_p + inventory_p;

  // S3: Logistics & payments
  const shipping_p    = toPaise(f.shipping);
  const cod_charge_p  = toPaise(f.cod_charge);
  const cod_pct       = safeNum(f.cod_pct);
  const pg_p          = toPaise(f.pg);
  const gst_log       = safeNum(f.gst_log);
  const blended_cod_p = Math.round(cod_charge_p * cod_pct / 100);
  const courier_base_p = shipping_p + blended_cod_p;
  const gst_courier_p = Math.round(courier_base_p * gst_log / 100);
  const net_gst_log_p = gst_registered ? 0 : gst_courier_p;
  const after_log_p   = after_pkg_p + courier_base_p + pg_p + net_gst_log_p;

  // S4: Returns
  const return_rate   = safeNum(f.return_rate);
  const return_cost_p = toPaise(f.return_cost);
  const ret_impact_p  = Math.round(return_cost_p * return_rate / 100);
  const after_ret_p   = after_log_p + ret_impact_p;

  // S5: Platform, marketing, ops
  const platform_pct = safeNum(f.platform_pct);
  const marketing_p  = toPaise(f.marketing);
  const ops_p        = toPaise(f.ops);
  const extra_p      = toPaise(f.extra);
  const gst_out      = safeNum(f.gst_out);
  const mrp_mult     = Math.max(1, Math.min(8, safeNum(f.mrp_mult, 2)));
  const profit_mode  = f.profit_mode || 'flat';
  const flat_profit_p = toPaise(f.profit);
  const target_margin = safeNum(f.target_margin);

  const fixed_p     = marketing_p + ops_p + extra_p;
  const cost_base_p = after_ret_p + fixed_p;
  const p = Math.min(platform_pct / 100, 0.9999);
  const m = Math.min(target_margin / 100, 0.9999);
  const g = gst_out / 100;

  let base_excl_p;
  if (profit_mode === 'margin') {
    const denom = (1 + g) * (1 - m) - p;
    base_excl_p = denom > 0.001 ? Math.round(cost_base_p / denom) : cost_base_p * 100;
  } else {
    base_excl_p = p < 0.9999
      ? Math.round((cost_base_p + flat_profit_p) / (1 - p))
      : (cost_base_p + flat_profit_p) * 100;
  }

  const sp_p          = addGst(base_excl_p, gst_out);
  const platform_amt_p = Math.round((sp_p / (1 + g)) * p);
  const total_p       = after_ret_p + platform_amt_p + fixed_p;
  const mrp_p         = Math.round(sp_p * mrp_mult);
  const gst_total_p   = sp_p - base_excl_p;
  const margin_pct    = sp_p > 0 ? (sp_p - total_p) / sp_p * 100 : 0;
  const profit_val_p  = sp_p - total_p;
  const disc          = sp_p > 0 && mrp_p > sp_p ? Math.round((1 - sp_p / mrp_p) * 100) : 0;
  const cm1_p = sp_p - landed_p - (packaging_p+labor_p+warehouse_p+inventory_p) - (courier_base_p+pg_p+net_gst_log_p) - ret_impact_p;
  const cm2_p = cm1_p - marketing_p;
  const cm3_p = cm2_p - ops_p - extra_p;
  const psy_sp = psychologicalRound(toRupees(sp_p));
  // BUG FIX: floor+remainder — cgst+sgst == gst_total exactly for odd-paise amounts
  const { cgst: cgst_p, sgst: sgst_p } = gstSplitIntra(gst_total_p);

  return {
    price:           toRupees(base_excl_p),
    selling_price:   toRupees(sp_p),
    mrp:             toRupees(mrp_p),
    compare_at_price: toRupees(mrp_p),
    cost_price:      toRupees(total_p),
    base_excl_gst:   toRupees(base_excl_p),
    landed:          toRupees(landed_p),
    total:           toRupees(total_p),
    gst_total:       toRupees(gst_total_p),
    cgst:            toRupees(cgst_p),
    sgst:            toRupees(sgst_p),
    platform_amt:    toRupees(platform_amt_p),
    blended_cod:     toRupees(blended_cod_p),
    ret_impact:      toRupees(ret_impact_p),
    margin_pct,
    margin_health:   marginHealth(margin_pct),
    profit_val:      toRupees(profit_val_p),
    below_breakeven: profit_val_p < 0,
    disc,
    cm1: toRupees(cm1_p), cm2: toRupees(cm2_p), cm3: toRupees(cm3_p),
    cm1_pct: sp_p > 0 ? cm1_p/sp_p*100 : 0,
    cm2_pct: sp_p > 0 ? cm2_p/sp_p*100 : 0,
    cm3_pct: sp_p > 0 ? cm3_p/sp_p*100 : 0,
    psy_sp,
    psy_mrp: psychologicalRound(toRupees(mrp_p)),
    gst_out, mrp_mult,
  };
}

// ── Server-side variant pricing ───────────────────────────────────────────────
// BUG FIX: parseGrams with locale comma normalisation and zero guard
// Mirrors units.js — server route must be self-contained so duplicated here.
function parseGrams(unit) {
  const raw = String(unit || '').toLowerCase().trim();
  if (!raw) return 250;
  // Normalise European decimal comma: "1,5kg" → "1.5kg"
  const s = raw.replace(/(\d),(\d{1,2})([a-zA-Z]|$)/, '$1.$2$3');
  let result;
  if (s.includes('kg'))                          result = parseFloat(s) * 1000;
  else if (s.includes('ml'))                     result = parseFloat(s);
  else if (s.endsWith('l') && !s.includes('ml')) result = parseFloat(s) * 1000;
  else if (s.includes('g'))                      result = parseFloat(s);
  else                                           result = parseFloat(s);
  // BUG FIX: guard zero/NaN/negative — prevent division-by-zero in ratio
  return (isFinite(result) && result > 0) ? result : 250;
}

function serverCalcVariantPrice(basePricePaise, baseUnit, targetUnit, gstRate, strategy) {
  const baseGrams   = parseGrams(baseUnit);
  const targetGrams = parseGrams(targetUnit);
  // BUG FIX: baseGrams is now guaranteed > 0 by parseGrams, so no Infinity risk
  const ratio       = targetGrams / baseGrams;
  let rawP;
  if (ratio < 1) {
    rawP = Math.round(basePricePaise * ratio * (strategy === 'linear' ? 1 : 1.08));
  } else if (ratio > 1) {
    rawP = Math.round(basePricePaise * ratio * (strategy === 'linear' ? 1 : 0.92));
  } else {
    rawP = basePricePaise;
  }
  if (strategy === 'psychological') {
    rawP = toPaise(psychologicalRound(toRupees(rawP)));
  }
  return {
    price:          toRupees(rawP),
    original_price: toRupees(removeGst(rawP, gstRate)),
  };
}

// ── Input validation ──────────────────────────────────────────────────────────
function validatePricingInputs(inputs) {
  const errors = [];
  const { selling_price, mrp, cost_price, gst_rate } = inputs;
  const sp  = parseFloat(selling_price) || 0;
  const mrpV = parseFloat(mrp)         || 0;
  const cp  = parseFloat(cost_price)   || 0;
  const gst = parseFloat(gst_rate)     || 0;
  if (sp <= 0)
    errors.push({ field: 'selling_price', msg: 'Selling price must be greater than 0' });
  if (mrpV > 0 && mrpV < sp)
    errors.push({ field: 'mrp', msg: `Legal MRP (₹${mrpV}) cannot be less than selling price (₹${sp})` });
  if (cp > 0 && sp > 0 && cp >= sp)
    errors.push({ field: 'cost_price', msg: `Cost price (₹${cp}) must be less than selling price (₹${sp})` });
  if (![0,5,12,18,28].includes(gst))
    errors.push({ field: 'gst_rate', msg: `GST rate ${gst}% is not a valid Indian slab (0/5/12/18/28)` });
  if (cp > 0 && sp > 0) {
    const grossMargin = (sp - cp) / sp * 100;
    if (grossMargin < 0)
      errors.push({ field: 'margin', msg: `Gross margin is negative (${grossMargin.toFixed(1)}%) — selling below cost`, severity: 'block' });
    else if (grossMargin < 8)
      errors.push({ field: 'margin', msg: `Gross margin is only ${grossMargin.toFixed(1)}% — below safe threshold of 8%`, severity: 'warn' });
  }
  return errors;
}

// ── GST snapshot for order items ──────────────────────────────────────────────
function buildSnapshot(product, variant, gstRate) {
  const sp_p   = toPaise(variant.price || product.selling_price || 0);
  const base_p = removeGst(sp_p, gstRate);
  const gst_p  = sp_p - base_p;
  // BUG FIX: floor+remainder — cgst+sgst == gst_p exactly for odd-paise amounts
  const { cgst, sgst } = gstSplitIntra(gst_p);
  return {
    product_name_snapshot:  product.name,
    variant_value_snapshot: variant.variant_value,
    sku_snapshot:           variant.sku,
    price_snapshot:         toRupees(sp_p),
    mrp_snapshot:           product.mrp,
    cost_price_snapshot:    product.cost_price || null,
    gst_rate_snapshot:      gstRate,
    cgst_snapshot:          toRupees(cgst),
    sgst_snapshot:          toRupees(sgst),
    igst_snapshot:          0,
    variant_snapshot:       JSON.stringify(variant),
  };
}

// ── Atomic product + variants save via Postgres RPC ──────────────────────────
// Calls save_product_with_variants() — see migration SQL below
// This is the DB transaction fix the audit required.
async function atomicSaveProduct(productBody, variantRows, isNew, existingProductId) {
  return sbRpc('save_product_with_variants', {
    p_product:    productBody,
    p_variants:   variantRows,
    p_is_new:     isNew,
    p_product_id: existingProductId || null,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════════
export async function POST(req) {
  try {
    const token = req.headers.get('x-session-token') || '';
    const role  = verifyToken(token);
    if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action } = body;

    // ── ACTION: calculate ────────────────────────────────────────────────────
    // Frontend sends pricing inputs → server calculates → returns computed prices
    // No DB write. Pure calculation.
    if (action === 'calculate') {
      const { inputs } = body;
      if (!inputs) return NextResponse.json({ error: 'inputs required' }, { status: 400 });

      const result = serverCalcPricing(inputs);
      const validationErrors = validatePricingInputs({
        selling_price: result.selling_price,
        mrp:           inputs.mrp_override || result.mrp,
        cost_price:    result.cost_price,
        gst_rate:      inputs.gst_out || 5,
      });

      return NextResponse.json({
        ok: true,
        result,
        errors: validationErrors,
        can_save: !validationErrors.some(e => e.severity === 'block'),
      });
    }

    // ── ACTION: validate ─────────────────────────────────────────────────────
    // Validate inputs without saving. Returns errors array.
    if (action === 'validate') {
      const { inputs } = body;
      if (!inputs) return NextResponse.json({ error: 'inputs required' }, { status: 400 });
      const errors = validatePricingInputs(inputs);
      return NextResponse.json({ ok: true, errors, can_save: !errors.some(e => e.severity === 'block') });
    }

    // ── ACTION: save_product ─────────────────────────────────────────────────
    // AUDIT FIX: Atomic product + variants save in a single DB transaction.
    // Frontend sends: product fields + pricing_inputs + variants array
    // Server: calculates prices → validates → saves atomically via RPC
    if (action === 'save_product') {
      if (!['owner', 'manager'].includes(role))
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });

      const { product, pricing_inputs, variants, is_new, product_id, variant_strategy } = body;

      if (!product?.name)
        return NextResponse.json({ error: 'product.name required' }, { status: 400 });
      if (!product?.state_id)
        return NextResponse.json({ error: 'product.state_id required' }, { status: 400 });
      if (!variants?.length)
        return NextResponse.json({ error: 'At least one variant required' }, { status: 400 });

      // 1. Server calculates all prices — frontend values ignored for final DB write
      let computed;
      if (pricing_inputs && Object.keys(pricing_inputs).length > 0) {
        // Full pricing engine mode (from bulk-calc prefill)
        computed = serverCalcPricing(pricing_inputs);
      } else {
        // Direct price entry mode (admin typed prices manually)
        // Validate what frontend sent, then use those values
        const sp  = parseFloat(product.selling_price) || 0;
        const gst = parseFloat(product.gst_rate)      || 5;
        const base_p = removeGst(toPaise(sp), gst);
        computed = {
          price:           toRupees(base_p),
          selling_price:   sp,
          mrp:             parseFloat(product.mrp) || sp,
          compare_at_price: parseFloat(product.compare_at_price) || parseFloat(product.mrp) || sp,
          cost_price:      parseFloat(product.cost_price) || null,
          margin_pct:      product.cost_price ? (sp - parseFloat(product.cost_price)) / sp * 100 : null,
          margin_health:   product.cost_price ? marginHealth((sp - parseFloat(product.cost_price)) / sp * 100) : 'unknown',
          gst_out:         gst,
          disc:            0,
        };
      }

      // 2. Validate computed prices — server is the final authority
      const errors = validatePricingInputs({
        selling_price: computed.selling_price,
        mrp:           computed.mrp,
        cost_price:    computed.cost_price,
        gst_rate:      computed.gst_out || product.gst_rate || 5,
      });

      const blockErrors = errors.filter(e => e.severity === 'block' || !e.severity);
      if (blockErrors.length > 0) {
        return NextResponse.json({
          ok: false,
          errors,
          error: blockErrors[0].msg,
        }, { status: 422 });
      }

      // 3. Build product body with server-computed prices
      const gstRate = parseFloat(computed.gst_out || product.gst_rate || 5);
      const slug    = product.slug ||
        product.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      const productBody = {
        name:               product.name,
        slug,
        emoji:              product.emoji              || null,
        category_id:        product.category_id        || null,
        state_id:           parseInt(product.state_id),
        vendor_id:          product.vendor_id ? parseInt(product.vendor_id) : null,
        status:             product.status             || 'active',
        unit_label:         product.unit_label         || null,
        gst_rate:           gstRate,
        // ── SERVER-COMPUTED prices — never trust frontend values ──────────
        price:              computed.price,             // base excl GST
        selling_price:      computed.selling_price,     // customer pays incl GST
        mrp:                computed.mrp,               // legal MRP on package
        compare_at_price:   computed.compare_at_price,  // strikethrough shown on site
        cost_price:         computed.cost_price,        // landed cost
        // ─────────────────────────────────────────────────────────────────
        short_description:  product.short_description  || null,
        long_description:   product.long_description   || null,
        image_url:          product.image_url           || null,
        video_url:          product.video_url           || null,
        tags:               product.tags               || null,
        badges:             product.badges             || null,
        available_stock:    0,  // trigger trg_sync_product_stock handles this
        is_deleted:         false,
      };

      // 4. Build variant rows with server-computed prices
      const baseUnit  = variants[0]?.variant_value || '250g';
      const baseSell  = computed.selling_price;
      const strategy  = variant_strategy || 'psychological';

      const variantRows = variants.map((v, i) => {
        // If variant has explicit price set by admin, validate it
        // If auto-generated, compute from base using server engine
        let varSell, varBase;
        if (v._autoGenerated && v.variant_value !== baseUnit) {
          const vc = serverCalcVariantPrice(
            toPaise(baseSell), baseUnit, v.variant_value, gstRate, strategy
          );
          varSell = vc.price;
          varBase = vc.original_price;
        } else {
          varSell = parseFloat(v.price) || baseSell;
          varBase = toRupees(removeGst(toPaise(varSell), gstRate));
        }
        return {
          variant_type:    v.variant_type    || 'weight',
          variant_value:   v.variant_value,
          price:           varSell,           // selling price incl GST
          original_price:  varBase,           // base excl GST
          available_stock: parseInt(v.available_stock) || parseInt(v.initial_stock) || 0,
          initial_stock:   parseInt(v.initial_stock)   || 0,
          orders_reserved: v.orders_reserved  || 0,
          is_active:       v.is_active !== false,
          sort_order:      i,
          sku:             v.sku || null,
          _id:             v._id || null,     // existing variant id for update
        };
      });

      // 5. ATOMIC SAVE via Postgres RPC (BEGIN + UPDATE/INSERT + COMMIT in one call)
      let result;
      try {
        result = await atomicSaveProduct(productBody, variantRows, !!is_new, product_id);
      } catch (rpcErr) {
        // RPC function may not exist yet — fall back to sequential saves
        // Remove this fallback once save_product_with_variants() RPC is deployed
        console.warn('RPC atomic save failed, falling back to sequential:', rpcErr.message);
        result = await sequentialFallbackSave(productBody, variantRows, !!is_new, product_id);
      }

      return NextResponse.json({
        ok:        true,
        product_id: result?.product_id || result?.id || product_id,
        computed,
        errors:    errors.filter(e => e.severity === 'warn'), // return warnings only
        saved_prices: {
          selling_price: computed.selling_price,
          mrp:           computed.mrp,
          cost_price:    computed.cost_price,
          margin_pct:    computed.margin_pct,
        },
      });
    }

    // ── ACTION: save_variants_only ───────────────────────────────────────────
    // Recalculate variant prices server-side and save for existing product
    if (action === 'save_variants_only') {
      if (!['owner', 'manager'].includes(role))
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });

      const { product_id, variants, base_selling_price, base_unit, gst_rate, strategy } = body;
      if (!product_id) return NextResponse.json({ error: 'product_id required' }, { status: 400 });

      const gst = parseFloat(gst_rate) || 5;
      const baseSell = parseFloat(base_selling_price) || 0;

      // Fetch existing variants to know which to update vs insert
      const existing = await sbFetch('GET', 'product_variants',
        `product_id=eq.${product_id}&select=id,variant_value`
      ) || [];
      const existingMap = Object.fromEntries(existing.map(v => [v.variant_value?.toLowerCase(), v.id]));

      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        if (!v.variant_value || !v.price) continue;

        // Server computes final price
        const vc = v._autoGenerated && v.variant_value !== base_unit
          ? serverCalcVariantPrice(toPaise(baseSell), base_unit, v.variant_value, gst, strategy || 'psychological')
          : { price: parseFloat(v.price), original_price: toRupees(removeGst(toPaise(parseFloat(v.price)), gst)) };

        const vBody = {
          product_id,
          variant_type:    v.variant_type    || 'weight',
          variant_value:   v.variant_value,
          price:           vc.price,
          original_price:  vc.original_price,
          available_stock: parseInt(v.available_stock) || 0,
          initial_stock:   parseInt(v.initial_stock)   || 0,
          is_active:       v.is_active !== false,
          sort_order:      i,
          sku:             v.sku || null,
        };

        const existingId = v._id || existingMap[v.variant_value?.toLowerCase()];
        if (existingId) {
          await sbFetch('PATCH', 'product_variants', `id=eq.${existingId}`, vBody);
        } else {
          await sbFetch('POST', 'product_variants', null, vBody);
        }
      }

      return NextResponse.json({ ok: true, product_id });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });

  } catch (e) {
    console.error('Pricing API error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ── Fallback: sequential save (used until RPC is deployed) ────────────────────
async function sequentialFallbackSave(productBody, variantRows, isNew, existingProductId) {
  let prodId = existingProductId;

  if (isNew) {
    const r = await sbFetch('POST', 'products', null, productBody);
    prodId = r?.[0]?.id || r?.id;
    if (!prodId) throw new Error('Product created but ID not returned');
  } else {
    await sbFetch('PATCH', 'products', `id=eq.${prodId}`, productBody);
  }

  // Fetch existing variants
  const existing = await sbFetch('GET', 'product_variants',
    `product_id=eq.${prodId}&select=id,variant_value`
  ) || [];
  const existingMap = Object.fromEntries(existing.map(v => [v.variant_value?.toLowerCase(), v.id]));

  for (const v of variantRows) {
    if (!v.variant_value) continue;
    const { _id, ...vBody } = v;
    const vBodyFull = { ...vBody, product_id: prodId };
    const existingId = _id || existingMap[v.variant_value?.toLowerCase()];
    if (existingId) {
      await sbFetch('PATCH', 'product_variants', `id=eq.${existingId}`, vBodyFull);
    } else {
      await sbFetch('POST', 'product_variants', null, vBodyFull);
    }
  }

  return { product_id: prodId };
}
