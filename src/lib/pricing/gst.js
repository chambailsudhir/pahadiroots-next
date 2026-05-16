// ── src/lib/pricing/gst.js ───────────────────────────────────────────────────
// All GST arithmetic. All values in integer paise.
// ─────────────────────────────────────────────────────────────────────────────

import { toPaise, toRupees, safeNum } from './money.js';

export const GST_RATES = [0, 5, 12, 18, 28];

/** Add GST to excl-GST paise amount. Returns integer paise. */
export function addGst(base_paise, gst_rate) {
  return Math.round(base_paise * (1 + safeNum(gst_rate) / 100));
}

/** Strip GST from incl-GST paise amount. Returns integer paise. */
export function removeGst(inclusive_paise, gst_rate) {
  const rate = safeNum(gst_rate);
  if (rate === 0) return Math.round(inclusive_paise);
  return Math.round(inclusive_paise / (1 + rate / 100));
}

/**
 * Full GST split for invoice generation.
 * FIX audit#5: floor+remainder ensures CGST+SGST == GST total exactly.
 * Returns { base_paise, gst_paise, cgst_paise, sgst_paise, igst_paise }
 */
export function gstSplit(inclusive_paise, gst_rate, is_interstate = false) {
  const base = removeGst(inclusive_paise, gst_rate);
  const gst  = inclusive_paise - base;
  const cgst = is_interstate ? 0 : Math.floor(gst / 2);
  const sgst = is_interstate ? 0 : (gst - cgst); // gets odd paise if any
  return {
    base_paise: base,
    gst_paise:  gst,
    cgst_paise: cgst,
    sgst_paise: sgst,
    igst_paise: is_interstate ? gst : 0,
  };
}

/**
 * HSN-aware GST split — determines IGST vs CGST+SGST from supply/delivery states.
 * seller_state_code: e.g. 'UK' (Uttarakhand), 'HP' (Himachal)
 * buyer_state_code:  customer's delivery state code
 */
export function gstSplitByState(inclusive_paise, gst_rate, seller_state_code, buyer_state_code) {
  const is_interstate = !!(
    seller_state_code && buyer_state_code &&
    seller_state_code.toUpperCase() !== buyer_state_code.toUpperCase()
  );
  return gstSplit(inclusive_paise, gst_rate, is_interstate);
}

/**
 * Look up GST rate from HSN code using a rates map.
 * hsnRatesMap: { [hsn_code]: { cgst_rate, sgst_rate, igst_rate } }
 * Returns combined GST % (cgst + sgst for intrastate).
 */
export function gstRateFromHsn(hsnCode, hsnRatesMap, fallbackRate = 5) {
  if (!hsnCode || !hsnRatesMap) return fallbackRate;
  const entry = hsnRatesMap[hsnCode];
  if (!entry) return fallbackRate;
  return Number(entry.cgst_rate || 0) + Number(entry.sgst_rate || 0);
}

/**
 * Build GST snapshot for order_items — immutable at time of order.
 * Call at checkout only, never re-derive from live product data.
 */
export function buildGstSnapshot(inclusive_paise, gst_rate, seller_state, buyer_state) {
  const split = gstSplitByState(inclusive_paise, gst_rate, seller_state, buyer_state);
  return {
    gst_rate_snapshot: gst_rate,
    cgst_snapshot:     toRupees(split.cgst_paise),
    sgst_snapshot:     toRupees(split.sgst_paise),
    igst_snapshot:     toRupees(split.igst_paise),
    base_snapshot:     toRupees(split.base_paise),
  };
}
