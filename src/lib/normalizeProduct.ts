import type { Product } from '@/types'

/**
 * Correct DB select string for products.
 * - badges  = jsonb array e.g. ['bestseller','organic'] — NOT separate boolean columns
 * - variant_value = the size/weight field in product_variants — NOT "size"
 * - status  = 'active'|'inactive' string on products (is_active doesn't exist on products)
 */
export const PRODUCT_SELECT = `
  id, name, slug, emoji, price, mrp, selling, available_stock, gst_rate,
  image_url, unit_label, badges, short_description, tags,
  category_id, state_id, is_deleted, status, created_at,
  categories:categories(id, name, slug),
  product_variants(id, price, mrp, variant_value, available_stock, is_active)
`

/**
 * Maps raw Supabase product rows to the shape ProductCard expects:
 * - badges array → badges_bestseller / badges_new / badges_organic booleans
 * - variant_value → size alias so no changes needed in ProductCard
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
