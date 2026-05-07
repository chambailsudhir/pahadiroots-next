import type { Product } from '@/types'

/**
 * PRODUCT_SELECT — used for queries that still use the anon supabase client.
 * NOTE: product_images is intentionally NOT joined here because the anon key
 * may be blocked by RLS on that table. Images are resolved via /api/v1/store-data
 * which uses the SERVICE KEY (same as old pahadiroots.com api/store-data.js).
 */
export const PRODUCT_SELECT = `
  id, name, slug, emoji, price, mrp, cost_price, gst_rate, available_stock,
  image_url, unit_label, badges, short_description, tags,
  category_id, state_id, is_deleted, status, created_at,
  categories:categories(id, name, slug),
  product_variants(id, price, mrp, variant_value, available_stock, is_active)
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
  products: any[],
  productImages: { product_id: number | string; image_url: string; sort_order: number }[]
): any[] {
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
export function normalizeProduct(p: any): Product {
  const badges: string[] = Array.isArray(p.badges) ? p.badges : []

  return {
    ...p,
    image_url:         p.image_url || null,
    _images:           p._images   || (p.image_url ? [p.image_url] : []),
    badges_bestseller: badges.includes('bestseller'),
    badges_new:        badges.includes('new'),
    badges_organic:    badges.includes('organic'),
    product_variants: (p.product_variants ?? []).map((v: any) => ({
      ...v,
      size: v.variant_value ?? v.size ?? '',
    })),
  } as Product
}

export function normalizeProducts(data: any[]): Product[] {
  return (data ?? []).map(normalizeProduct)
}
