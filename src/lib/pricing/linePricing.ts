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

export interface VariantRow { id: unknown; product_id: unknown; price?: unknown; original_price?: unknown; is_active?: unknown; available_stock?: unknown }
export interface ProductRow {
  id: unknown; name?: unknown; is_deleted?: unknown; status?: unknown
  selling_price?: unknown; price?: unknown; mrp?: unknown; available_stock?: unknown
}

// products.price is a legacy column nothing writes to; selling_price is the real one.

/** Unit price for a line backed by a real variant. */
export function variantLinePrice(v: VariantRow | undefined, p: ProductRow | undefined): number {
  return Number(v?.price) || Number(p?.selling_price ?? p?.price) || 0
}
export function variantLineMrp(v: VariantRow | undefined, p: ProductRow | undefined): number {
  return Number(v?.original_price) || Number(p?.mrp) || Number(v?.price) || 0
}
/** Unit price for a no-variant line (priced from the products table). */
export function productLinePrice(p: ProductRow | undefined): number {
  return Number(p?.selling_price ?? p?.price) || 0
}
export function productLineMrp(p: ProductRow | undefined): number {
  return Number(p?.mrp) || Number(p?.selling_price ?? p?.price) || 0
}
