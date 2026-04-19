import { supabase } from '@/lib/supabase'
import { normalizeProducts } from '@/lib/normalizeProduct'
import ProductCard from './ProductCard'
import type { Product } from '@/types'

interface Props { categoryId: string | number; excludeId: string | number }

export default async function RelatedProducts({ categoryId, excludeId }: Props) {
  let products: Product[] = []
  try {
    const { data } = await supabase
      .from('products')
      .select(`
        id, name, slug, emoji, price, mrp, available_stock, gst_rate,
        image_url, unit_label, badges, category_id,
        is_deleted, status,
        categories:categories(id, name, slug),
        product_variants(id, price, mrp, variant_value, available_stock, is_active)
      `)
      .eq('category_id', categoryId)
      .eq('is_deleted', false)
      .eq('status', 'active')
      .neq('id', excludeId)
      .limit(4)
    products = normalizeProducts(data ?? [])