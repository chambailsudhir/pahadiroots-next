// ── src/lib/pricing/variants/snapshots.js ────────────────────────────────────
// Immutable order price snapshots.
//
// WHY THIS EXISTS:
//   Product prices change. An order placed at ₹499 must always show ₹499,
//   even if the product is later repriced to ₹549.
//   buildOrderSnapshot() captures every price-relevant field at checkout time.
//   These values are written to order_items and must NEVER be recomputed
//   from live product/variant data after the order is created.
//
// RULE: Call buildOrderSnapshot() exactly once per order line — at the moment
//   the customer confirms the order. Never call it on order reads/updates.
// ─────────────────────────────────────────────────────────────────────────────

import { toPaise, toRupees, safeNum } from '../money.js';
import { gstSplit }          from '../gst.js';

/**
 * Build an immutable price snapshot for one order_items row.
 *
 * @param {object} product  - full product record from DB
 * @param {object} variant  - full variant record (must have .price, .sku, etc.)
 * @param {number} gstRate  - GST % at time of order (from product.gst_rate)
 * @param {number} [qty=1]  - quantity ordered (used for line total)
 * @returns {object}        - all snapshot fields for the order_items row
 */
export function buildOrderSnapshot(product, variant, gstRate, qty = 1) {
  const sp_p  = toPaise(variant.price || product.selling_price || product.mrp || 0);
  const split = gstSplit(sp_p, gstRate);

  // Line totals
  const line_total_p = sp_p * qty;
  const line_cgst_p  = split.cgst_paise * qty;
  const line_sgst_p  = split.sgst_paise * qty;

  return {
    // ── Identity ─────────────────────────────────────────────────────────
    product_id:              product.id,
    variant_id:              variant.id,

    // ── Immutable name/variant snapshots ─────────────────────────────────
    product_name_snapshot:   product.name,
    variant_value_snapshot:  variant.variant_value,
    sku_snapshot:            variant.sku,

    // ── Immutable price snapshots ─────────────────────────────────────────
    price_snapshot:          toRupees(sp_p),          // selling price incl GST
    mrp_snapshot:            product.mrp,
    cost_price_snapshot:     product.cost_price,
    gst_rate_snapshot:       gstRate,

    // ── GST split (prevents CGST+SGST drift bug) ──────────────────────────
    cgst_snapshot:           toRupees(split.cgst_paise),
    sgst_snapshot:           toRupees(split.sgst_paise),
    igst_snapshot:           0,    // always 0 for intra-state; set to sgst+cgst for inter-state

    // ── Quantity + line totals ─────────────────────────────────────────────
    quantity:                qty,
    line_total:              toRupees(line_total_p),
    line_cgst:               toRupees(line_cgst_p),
    line_sgst:               toRupees(line_sgst_p),

    // ── Full variant JSON (for returns/disputes — the complete record) ─────
    variant_snapshot: JSON.stringify({
      variant_type:    variant.variant_type,
      variant_value:   variant.variant_value,
      price:           toRupees(sp_p),
      original_price:  variant.original_price,
      sku:             variant.sku,
      gst_rate:        gstRate,
    }),
  };
}

/**
 * Build snapshots for an entire cart (array of { product, variant, qty }).
 * Returns an array of order_items rows, one per cart line.
 *
 * @param {Array<{product: object, variant: object, qty: number}>} cartLines
 * @returns {object[]}
 */
export function buildCartSnapshots(cartLines) {
  return cartLines.map(({ product, variant, qty }) =>
    buildOrderSnapshot(product, variant, product.gst_rate || 5, qty)
  );
}

/**
 * Verify a snapshot is internally consistent (CGST + SGST = GST total).
 * Use in tests and in the reconciliation worker — never in the hot path.
 *
 * @param {object} snap - a row from order_items
 * @returns {{ ok: boolean, drift: number }}
 */
export function verifySnapshot(snap) {
  // Recompute expected total GST from the snapshot price and rate
  const sp_p        = toPaise(snap.price_snapshot);
  const base_p      = Math.round(sp_p / (1 + safeNum(snap.gst_rate_snapshot) / 100));
  const expected_gst_p = sp_p - base_p;

  const cgst_p      = toPaise(snap.cgst_snapshot);
  const sgst_p      = toPaise(snap.sgst_snapshot);
  const actual_gst_p = cgst_p + sgst_p;

  // Accept ≤1 paise drift (integer rounding between toPaise and toRupees is unavoidable)
  const drift = Math.abs(actual_gst_p - expected_gst_p);
  return { ok: drift <= 1, drift };
}
