// ─────────────────────────────────────────────────────────────────────────────
// lib/pricing/linePricing.ts
//
// Pure, dependency-free pricing rules shared by createOrder() (orderService) and
// validateCartLines() (lib/server/cartValidation) so the two can never drift apart.
//
// This file MUST NOT import 'server-only' or anything that does: orderService.ts is
// also bundled into client components (account page → useOrders → fetchOrders), and
// importing a server-only module there fails the build. Keep it free of I/O.
// ─────────────────────────────────────────────────────────────────────────────

export interface VariantRow { id: unknown; product_id: unknown; price?: unknown; original_price?: unknown; compare_at_price?: unknown; is_active?: unknown; available_stock?: unknown }
export interface ProductRow {
  id: unknown; name?: unknown; is_deleted?: unknown; status?: unknown
  selling_price?: unknown; price?: unknown; mrp?: unknown; available_stock?: unknown
}

// products.price is a legacy column nothing writes to; selling_price is the real one.

/** Unit price for a line backed by a real variant. */
export function variantLinePrice(v: VariantRow | undefined, p: ProductRow | undefined): number {
  return Number(v?.price) || Number(p?.selling_price ?? p?.price) || 0
}
/**
 * The MRP a customer should see struck through next to a variant's selling price.
 *
 * Oct 2026 audit (P1): this used to read `original_price`, which is the EX-GST base price
 * (e.g. 370.04 for a ₹388.54 variant), so MRP was always BELOW the selling price and no
 * discount ever displayed. Indian retail (Legal Metrology) and the large marketplaces use a
 * tax-inclusive MRP that is >= the selling price; the discount is measured against what the
 * customer actually pays. Rules, in order:
 *   1. variant.compare_at_price (tax-inclusive MRP) when it exceeds the selling price
 *   2. products.mrp ("Legal MRP printed on package" in the admin) for the variant that IS the
 *      product's headline price (variant price == products.selling_price) when it exceeds it
 *   3. otherwise the selling price itself  nothing is struck through, no discount shown
 * It can therefore never be below the selling price and never invents a discount.
 */
export function variantDisplayMrp(v: VariantRow | undefined, p: ProductRow | undefined): number {
  const price = Number(v?.price) || 0
  if (price <= 0) return 0
  const cmp = Number(v?.compare_at_price)
  if (Number.isFinite(cmp) && cmp > price) return cmp
  const prodMrp = Number(p?.mrp)
  const headline = Number(p?.selling_price ?? p?.price)
  if (Number.isFinite(prodMrp) && prodMrp > price && headline > 0 && Math.abs(headline - price) < 0.01) return prodMrp
  return price
}
export function variantLineMrp(v: VariantRow | undefined, p: ProductRow | undefined): number {
  return variantDisplayMrp(v, p) || Number(p?.mrp) || Number(v?.price) || 0
}
/** Unit price for a no-variant line (priced from the products table). */
export function productLinePrice(p: ProductRow | undefined): number {
  return Number(p?.selling_price ?? p?.price) || 0
}
export function productLineMrp(p: ProductRow | undefined): number {
  return Number(p?.mrp) || Number(p?.selling_price ?? p?.price) || 0
}
