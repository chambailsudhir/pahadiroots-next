// Public shape of the catalogue served by /api/v1/search-catalog (kept out of the route file: Next.js route modules may only
// export handlers and config).
import { MAX_LINE_QTY } from '@/lib/cartLimits'

// Nov 2026 verification: this public, CDN-cached answer exposed every variant's `sku` and `initial_stock` and the exact stock count
// of every product (187 units of one, 4 of another) to anyone. Variants are now an allow-list of what the cards, quick view and
// listings read, and stock is capped at MAX_LINE_QTY: the UI only ever asks "in stock?", "low stock (< 10)?" and "how many may
// go in the cart (≤ 50)?", so the cap changes nothing a customer sees while the real inventory level stays private.
const PUBLIC_VARIANT_FIELDS = [
  'id', 'product_id', 'size', 'variant_type', 'variant_value', 'price', 'selling_price', 'mrp', 'original_price',
  'compare_at_price', 'available_stock', 'is_active', 'sort_order',
] as const
const PRIVATE_PRODUCT_FIELDS = ['updated_at', 'is_deleted', 'initial_stock', 'sku', 'sku_backup', 'hsn_code', 'hsn_code_id'] as const

export function capStock(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), MAX_LINE_QTY) : 0
}

export function toPublicCatalogProduct(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...p }
  for (const f of PRIVATE_PRODUCT_FIELDS) delete out[f]
  if ('available_stock' in out) out.available_stock = capStock(out.available_stock)
  if (Array.isArray(out.product_variants)) {
    out.product_variants = (out.product_variants as Record<string, unknown>[]).map(v => {
      const pv: Record<string, unknown> = {}
      for (const f of PUBLIC_VARIANT_FIELDS) if (v[f] !== undefined) pv[f] = v[f]
      if ('available_stock' in pv) pv.available_stock = capStock(pv.available_stock)
      return pv
    })
  }
  return out
}
