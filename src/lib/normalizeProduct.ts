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

/**
 * normalizeProducts — maps normalizeProduct over an array. This existed
 * before and is used across the whole app (products/page.tsx, home page,
 * regions, collections, wishlist, search, blog) — restored here after an
 * editing slip briefly dropped it while adding toCardProductData below.
 */
export function normalizeProducts(data: NormalizableRow[]): Product[] {
  return (data ?? []).map(normalizeProduct)
}

/**
 * toCardProductData — BUG FIX (performance, found while investigating "the
 * whole /products page feels slow to load, even images"): ProductCard is a
 * Client Component, so every field on the `Product` object passed to it gets
 * serialized into the page's RSC payload — even fields the card never reads.
 * The full Product shape carries `long_description`, `short_description`,
 * `tags`, and five separate AI-generated content fields (`ai_description`,
 * `ai_health_benefits`, `ai_how_to_use`, `ai_storage_tips`,
 * `ai_who_should_buy`) — multi-paragraph text blobs meant for the PDP, not
 * the card. None of them are read anywhere in ProductCard.tsx or
 * QuickViewModal.tsx (verified by grepping every `product.<field>` access in
 * both files). Across a full page of cards, that's a lot of dead text the
 * browser has to download and parse before it can hydrate — which delays
 * everything downstream, including when lazy-loaded images start requesting.
 * This returns the same `Product` shape (so no type changes needed at call
 * sites) with just the unused heavy fields nulled out.
 */
export function toCardProductData(p: Product): Product {
  return {
    ...p,
    short_description: null,
    long_description: null,
    tags: null,
    ai_description: null,
    ai_health_benefits: null,
    ai_how_to_use: null,
    ai_storage_tips: null,
    ai_who_should_buy: null,
    ai_generated_at: null,
  }
}

/**
 * getBaseVariant — the single source of truth for "which variant does this
 * card represent by default": the lowest-priced *active* variant, or null
 * when the product has no variants. getEffectivePrice, getEffectiveStock,
 * and ProductCard all derive from this one selection so they can never
 * disagree with each other about which variant is "the" variant.
 */
export function getBaseVariant(p: Product) {
  const variants = (p.product_variants ?? []).filter(v => v.is_active)
  if (variants.length === 0) return null
  return variants.reduce((min, v) => v.price < min.price ? v : min, variants[0])
}

/**
 * getEffectivePrice — the same price ProductCard actually displays: the
 * lowest active variant's price when variants exist, else the top-level
 * product price. Listing pages must sort by this (not raw product.price),
 * or "Price: Low → High" can visibly disagree with the prices shown on the
 * cards it's sorting.
 */
export function getEffectivePrice(p: Product): number {
  return getBaseVariant(p)?.price ?? p.price ?? 0
}

/**
 * getEffectiveMrp — the MRP counterpart to getEffectivePrice, added for the
 * P2 audit fix to BestSellersClient.tsx's "Best Discount" sort, which
 * compared raw top-level product.mrp/product.price instead of the
 * variant-derived values ProductCard actually renders — for any product
 * with variants, the sort order could visibly disagree with the discount
 * % shown on the cards being sorted. Same reasoning as getEffectivePrice.
 */
export function getEffectiveMrp(p: Product): number {
  return getBaseVariant(p)?.mrp ?? p.mrp ?? 0
}

/**
 * getEffectiveStock — the same stock ProductCard bases its in-stock/out-of-
 * stock display on: the base variant's stock when variants exist, else the
 * top-level product stock. Filtering "In Stock Only" on the raw top-level
 * `product.available_stock` (as the old inline filter did) could show a
 * product as in-stock in the filter while its card renders "Out of Stock",
 * or vice versa, whenever the base variant and the product row disagree.
 */
export function getEffectiveStock(p: Product): number {
  return getBaseVariant(p)?.available_stock ?? p.available_stock ?? 0
}
