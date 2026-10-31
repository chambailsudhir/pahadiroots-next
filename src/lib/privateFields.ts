/**
 * privateFields.ts — columns that must NEVER leave the server.
 *
 * The storefront reads products with the service key and `select('*')`, then
 * hands the rows to client components (ProductCard, AddToCartSection, …),
 * which serializes every field into the page / API payload where anyone can
 * read it. These columns are internal: purchase cost and margin, supplier,
 * pricing-engine bookkeeping, and warehouse counters. No customer UI reads
 * them (verified by grep, Oct 2026 audit).
 *
 * Keep in sync with supabase/migrations/050_restrict_internal_columns_from_anon.sql,
 * which blocks the same columns from the anon / authenticated database roles.
 */

export const PRIVATE_PRODUCT_FIELDS = [
  'cost_price',
  'landed_cost',        // STORE-001: purchase cost + inbound GST/freight/handling (admin migration 097)
  'fully_loaded_cost',  // STORE-001: landed cost + packaging/overheads
  'vendor_id',
  'psy_sp_raw',
  'psy_mrp_raw',
  'price_version',
  'engine_version_at_save',
  'last_repriced_at',
  'ai_provider',
  'orders_reserved',
] as const

export const PRIVATE_VARIANT_FIELDS = [
  'cost_price',
  'landed_cost',        // STORE-001
  'margin_pct',
  'reserved_stock',
  'damaged_stock',
  'blocked_stock',
  'orders_reserved',
  'barcode',
] as const

/**
 * STORE-001 safety net. The lists above are a BLOCKLIST, and the storefront reads rows with the service key and
 * `select('*')` (which bypasses the anon column grants), so any NEW internal column is public the moment it is added
 * unless someone remembers to list it here — that is exactly how landed_cost / fully_loaded_cost were missed. Any own key
 * that names a cost, margin, landed, commission or purchase figure is therefore nulled by default. No customer-facing
 * product or variant column matches (checked against the live schema, Oct 2026): price, selling_price, mrp, discount_pct,
 * unit_label, gst_rate… are untouched. If a genuinely public column ever needs one of these words, rename it.
 */
export const COST_LIKE_KEY = /(^|_)(cost|costs|landed|margin|commission|purchase)(_|$)/i

function nullOut<T extends object>(row: T, fields: readonly string[]): T {
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) }
  for (const f of fields) if (f in out) out[f] = null
  for (const k of Object.keys(out)) if (COST_LIKE_KEY.test(k)) out[k] = null
  return out as T
}

/** Copy of a product row with every private field nulled (own keys only). */
export function scrubProduct<T extends object>(p: T): T {
  const out = nullOut(p, PRIVATE_PRODUCT_FIELDS) as T & { product_variants?: unknown }
  if (Array.isArray(out.product_variants)) {
    out.product_variants = out.product_variants.map(v => scrubVariant(v as object))
  }
  return out
}

/** Copy of a variant row with every private field nulled (own keys only). */
export function scrubVariant<T extends object>(v: T): T {
  return nullOut(v, PRIVATE_VARIANT_FIELDS)
}
