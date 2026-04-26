import type { Product } from '@/types'

/**
 * Exact DB columns for products table (verified from admin catalogue query):
 * id, name, slug, emoji, price, mrp, cost_price, gst_rate, available_stock,
 * is_active(bool), is_deleted(bool), category_id, state_id, unit_label,
 * short_description, long_description, image_url, tags, badges(jsonb array),
 * created_at
 *
 * Does NOT exist in DB: selling, badges_bestseller, badges_new, badges_organic
 * is_active exists but is NOT used for filtering — use status='active' instead
 * product_variants column: variant_value (NOT "size")
 */
export const PRODUCT_SELECT = `
  id, name, slug, emoji, price, mrp, cost_price, gst_rate, available_stock,
  image_url, unit_label, badges, short_description, tags,
  category_id, state_id, is_deleted, status, created_at,
  categories:categories(id, name, slug),
  product_variants(id, price, mrp, variant_value, available_stock, is_active)
`

/**
 * Maps raw Supabase product rows to the shape ProductCard expects:
 * - badges jsonb array → badges_bestseller / badges_new / badges_organic booleans
 * - variant_value → size alias so ProductCard needs zero changes
 */
export function normalizeProduct(p: any): Product {
  const badges: string[] = Array.isArray(p.badges) ? p.badges : []
  return {
    ...p,
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
