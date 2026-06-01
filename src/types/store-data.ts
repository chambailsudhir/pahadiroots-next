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
  mrp: number
  size?: string
  weight?: string
}

export interface RawProduct {
  id: string
  name?: string
  slug?: string
  emoji?: string | null
  gst_rate?: number
  state_id?: string | null
  badges_organic?: boolean
  badges_bestseller?: boolean
  badges_new?: boolean
}

export interface RawImage {
  product_id: string
  image_url: string
}
