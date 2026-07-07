import type { Product } from '@/types'

/**
 * PRODUCT_SELECT — used for queries that still use the anon supabase client.
 * NOTE: product_images is intentionally NOT joined here because the anon key
 * may be blocked by RLS on that table. Images are resolved via /api/v1/store-data
 * which uses the SERVICE KEY (same as old pahadiroots.com api/store-data.js).
 *
 * BUG FIX (found via the same production 500 that broke /api/v1/cart-upsells,
 * confirmed via live schema inspection): product_variants has no `mrp` column
 * at all — the real column is `original_price`. products.mrp (top-level,
 * outside the nested embed) IS a real column and is unaffected. This exact
 * constant is exported but was never actually being used by either of its
 * two importers (wishlist/page.tsx, blog/[slug]/page.tsx) — they each
 * hand-rolled their own duplicate select string with the same bug; both are
 * fixed alongside this one.
 */
export const PRODUCT_SELECT = `
  id, name, slug, emoji, price, mrp, cost_price, gst_rate, available_stock,
  image_url, unit_label, badges, short_description, tags,
  category_id, state_id, is_deleted, status, created_at,
  categories:categories(id, name, slug),
  product_variants(id, price, original_price, variant_value, available_stock, is_active)
`

/**
 * applyProductImages — same logic as old site main.js lines 1110-1134:
 *   - group product_images by product_id
 *   - sort by sort_order
 *   - override product.image_url with urls[0]   ← "always override"
 *   - store all urls in product._images
 *
 * Called after fetching from /api/v1/store-data which uses SERVICE KEY.
 */
export function applyProductImages(
  products: Product[],
  productImages: { product_id: number | string; image_url: string; sort_order: number }[]
): Product[] {
  if (!productImages?.length) return products

  // Group by product_id (exactly as old site does)
  const byProd: Record<string, { image_url: string; sort_order: number }[]> = {}
  productImages.forEach(row => {
    if (!row.product_id || !row.image_url) return
    const pid = String(row.product_id)
    if (!byProd[pid]) byProd[pid] = []
    byProd[pid].push(row)
  })

  return products.map(p => {
    const imgs = byProd[String(p.id)]
    if (!imgs?.length) return p
    const sorted = imgs.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const urls   = sorted.map(r => r.image_url).filter(Boolean)
    if (!urls.length) return p
    return {
      ...p,
      image_url: urls[0],   // always override — product_images is source of truth
      _images:   urls,
    }
  })
}

/**
 * normalizeProduct — maps raw Supabase product row to Product shape.
 * Works with OR without product_images pre-applied.
 */
// Raw Supabase row — a superset of Product with unprocessed fields.
// The index signature [key: string]: unknown is intentionally on a separate
// intersection so that Product (which has no index sig) is still assignable here.
type RawProductRow = {
  id: number | string
  name: string
  slug: string
  image_url?: string | null
  badges?: string[] | null
  badges_bestseller?: boolean
  badges_new?: boolean
  badges_organic?: boolean
  product_variants?: Array<{ id: number; price: number; original_price?: number; mrp?: number; variant_value?: string | null; size?: string | null; available_stock: number; is_active: boolean }>
  [key: string]: unknown
}

// Accept either a raw DB row OR an already-normalized Product (e.g. after applyProductImages)
type NormalizableRow = RawProductRow | Product

export function normalizeProduct(p: NormalizableRow): Product {
  const badges: string[] = Array.isArray((p as RawProductRow).badges)
    ? (p as RawProductRow).badges as string[]
    : []

  return {
    ...p,
    image_url:         p.image_url || null,
    badges_bestseller: (p as Product).badges_bestseller || badges.includes('bestseller'),
    badges_new:        (p as Product).badges_new        || badges.includes('new'),
    badges_organic:    (p as Product).badges_organic    || badges.includes('organic'),
    product_variants: ((p as RawProductRow).product_variants ?? []).map(v => ({
      ...v,
      size: v.variant_value ?? v.size ?? '',
      // BUG FIX: v no longer carries a real `mrp` field (see PRODUCT_SELECT
      // fix above — product_variants has no mrp column). Must explicitly map
      // it from original_price here, same fallback chain as orderService.ts
      // ("mrp from original_price column") and cart-upsells/route.ts —
      // otherwise every consumer that reads variant.mrp (e.g. ProductCard's
      // `baseVariant?.mrp`) would silently see undefined for every wishlist/
      // blog-page product.
      mrp: v.original_price ?? v.mrp ?? v.price,
    })),
  } as Product
}

export function normalizeProducts(data: NormalizableRow[]): Product[] {
  return (data ?? []).map(normalizeProduct)
}
