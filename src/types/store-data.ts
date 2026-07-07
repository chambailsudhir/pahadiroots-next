/**
 * Raw shapes returned by the Supabase REST API for the store-data tables.
 *
 * These are intentionally narrow — only the fields that cart consumers
 * actually access. Keeping them here (not in src/types/index.ts) makes
 * the boundary explicit: these are internal API-shape types, not domain
 * types shared across the app.
 *
 * Fix: previously defined inline inside the useEffect body in cart/page.tsx,
 * which hid them from the TypeScript compiler between renders and caused
 * the "interface defined inside function" lint warning.
 */

export interface RawVariant {
  id: string
  product_id: string
  is_active: boolean
  available_stock: number
  price: number
  // BUG FIX (found via production 500s + confirmed via live schema inspection):
  // product_variants has no mrp/size/weight columns at all. The real columns
  // are original_price (MRP — see orderService.ts's identical mapping:
  // "mrp from original_price column") and variant_value (the size/weight
  // label, e.g. "500ml", "1kg"). Querying the old non-existent column names
  // caused every single /api/v1/cart-upsells request to fail.
  original_price: number
  variant_value?: string
}

export interface RawProduct {
  id: string
  name?: string
  slug?: string
  emoji?: string | null
  gst_rate?: number
  state_id?: string | null
  // BUG FIX (found via production 500s): badges_organic/badges_bestseller/
  // badges_new are NOT real columns — they don't exist on products at all.
  // The real column is `badges`, a text array (e.g. ['bestseller','organic']).
  // See storeData.ts's identical derivation: badgeArr.includes('bestseller').
  badges?: string[]
}

export interface RawImage {
  product_id: string
  image_url: string
}
