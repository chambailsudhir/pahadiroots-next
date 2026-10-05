// ─────────────────────────────────────────────────────────────────────────────
// lib/lineKinds.ts — "is this cart line a real variant, or a no-variant product?"
//
// BUG FIX (Oct 2026 audit, found against the live DB): the app encodes "this product
// has no variants" as `variantId === productId`. But variant ids and product ids come
// from two independent sequences, so a REAL variant can have the same number as its own
// product. That is the case in production today: product 1 (Himalayan Wild Manali
// Honey) has a variant whose id is also 1.
//
// With the old id-equality rule that honey was misread as a "no-variant product":
//   • the I3 pre-flight rejected it ("item has multiple options — add it again with a
//     size"), and re-adding sends the same ids, so the product could never be bought;
//   • before I3, it was priced from the products table and its stock was reserved /
//     restored against the PRODUCTS row instead of the variant.
//
// The equality alone can never tell the two cases apart. The database can: an
// ambiguous line is a real variant exactly when a variant with that id exists AND
// belongs to the named product.
//
// Pure (no I/O, no server-only) so it can be unit tested and shared by createOrder(),
// validateCartLines() and the inventory layer.
// ─────────────────────────────────────────────────────────────────────────────

export type LineKind = 'variant' | 'product'

export interface LineIds {
  productId: string
  variantId: string
}

export type LineResolution =
  /** A real product_variants row — priced and stocked from that variant. */
  | { kind: 'variant' }
  /** The "no variant" convention — priced and stocked from the products row. */
  | { kind: 'product' }
  /**
   * variantId === productId, but a variant with that id exists and belongs to a
   * DIFFERENT product. That is a stale or legacy cart line (an old client stored the
   * product id in the variant slot). It must never be attached to someone else's
   * variant, so callers reject it as unavailable.
   */
  | { kind: 'foreign_variant' }

/** True when the ids alone cannot say whether the line is a variant or a bare product. */
export function isAmbiguousLine(i: LineIds): boolean {
  return String(i.variantId) === String(i.productId)
}

/** variant id → owning product id, built from `product_variants` rows. */
export function buildOwnerMap(rows: ReadonlyArray<{ id: unknown; product_id: unknown }> | null | undefined): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of rows ?? []) m.set(String(r.id), String(r.product_id))
  return m
}

export function resolveLine(i: LineIds, ownerByVariantId: ReadonlyMap<string, string>): LineResolution {
  // Different ids can only be a variant line (the server then verifies ownership).
  if (!isAmbiguousLine(i)) return { kind: 'variant' }
  const owner = ownerByVariantId.get(String(i.variantId))
  if (owner === undefined) return { kind: 'product' }
  return owner === String(i.productId) ? { kind: 'variant' } : { kind: 'foreign_variant' }
}
