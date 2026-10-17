// ─────────────────────────────────────────────────────────────────────────────
// lib/productAttributes.ts
//
// Reads the admin's "Product Attributes" (Shelf Life, Packaging Type, Processing Type, Harvest
// Season, Origin Region, Organic Certified) so the PDP can show REAL values instead of placeholders.
//
// Source of truth = pahadi-admin:
//   • table product_attributes        (id, name, data_type)   — migration 013 documents the live schema
//   • table product_attribute_values  (product_id, attribute_id, value TEXT)
//   • Shelf Life is data_type 'duration' stored as text like "90 Days" / "12 Months" / "2 Years"; the
//     admin's own parseDuration() also accepts a legacy bare number ("90") and treats it as Days.
//     formatShelfLife() below mirrors that so the storefront never disagrees with the admin form.
//
// Pure functions only (no I/O) so they are unit-testable; the Supabase read lives in the page.
// ─────────────────────────────────────────────────────────────────────────────

export interface AttributeDefRow   { id: number | string; name: string | null }
export interface AttributeValueRow { attribute_id: number | string; value: string | null }

/** { shelf_life: '12 Months', packaging_type: 'Glass Jar', … } — empty/blank values are dropped. */
export type ProductAttributeMap = Record<string, string>

const keyOf = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

export function buildAttributeMap(defs: AttributeDefRow[] | null | undefined, values: AttributeValueRow[] | null | undefined): ProductAttributeMap {
  const out: ProductAttributeMap = {}
  if (!defs || !values) return out
  const nameById = new Map<string, string>()
  for (const d of defs) {
    if (d && d.name && d.id != null) nameById.set(String(d.id), d.name)
  }
  for (const v of values) {
    if (!v || v.attribute_id == null) continue
    const name = nameById.get(String(v.attribute_id))
    const val  = typeof v.value === 'string' ? v.value.trim() : ''
    if (!name || !val) continue
    const k = keyOf(name)
    if (k && !(k in out)) out[k] = val
  }
  return out
}

/**
 * "90 Days" → "90 days", "12 months" → "12 months", "1 Year" → "1 year", "90" → "90 days" (legacy, as the admin).
 * Returns null for anything that is not a positive duration, so the caller hides the line instead of guessing.
 */
export function formatShelfLife(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(days?|months?|years?)?$/i)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = (m[2] ? m[2].toLowerCase().replace(/s$/, '') : 'day')
  const label = n === 1 ? unit : `${unit}s`
  return `${m[1]} ${label}`
}
