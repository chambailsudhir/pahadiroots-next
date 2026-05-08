/**
 * storeData.ts — Client-side helpers for fetching and normalising store data.
 * These are used in client components that cannot rely on server-side data fetching.
 */

import { supabase } from './supabase'
import { normalizeProduct, normalizeProducts, PRODUCT_SELECT } from './normalizeProduct'
import type { Product, Category, State } from '@/types'

// ─── Products ─────────────────────────────────────────────────────────────────

/** Fetch a single product by slug */
export async function fetchProductBySlug(slug: string): Promise<Product | null> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('slug', slug)
      .eq('is_deleted', false)
      .eq('status', 'active')
      .single()
    if (error || !data) return null
    return normalizeProduct(data)
  } catch {
    return null
  }
}

/** Fetch active products with optional filters */
export async function fetchProducts(options: {
  categorySlug?: string
  stateId?:      string
  limit?:        number
  orderBy?:      string
} = {}): Promise<Product[]> {
  try {
    let query = supabase
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('is_deleted', false)
      .eq('status', 'active')

    if (options.stateId) {
      query = query.eq('state_id', options.stateId)
    }

    if (options.orderBy) {
      query = query.order(options.orderBy)
    } else {
      query = query.order('created_at', { ascending: false })
    }

    if (options.limit) {
      query = query.limit(options.limit)
    }

    const { data, error } = await query
    if (error || !data) return []
    return normalizeProducts(data)
  } catch {
    return []
  }
}

/** Fetch bestseller products */
export async function fetchBestsellers(limit = 8): Promise<Product[]> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('is_deleted', false)
      .eq('status', 'active')
      .contains('badges', ['bestseller'])
      .limit(limit)
    if (error || !data) return []
    return normalizeProducts(data)
  } catch {
    return []
  }
}

/** Fetch new arrival products */
export async function fetchNewArrivals(limit = 8): Promise<Product[]> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('is_deleted', false)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error || !data) return []
    return normalizeProducts(data)
  } catch {
    return []
  }
}

/** Search products by name or tags */
export async function searchProducts(query: string, limit = 20): Promise<Product[]> {
  if (!query.trim()) return []
  try {
    const { data, error } = await supabase
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('is_deleted', false)
      .eq('status', 'active')
      .or(`name.ilike.%${query}%,tags.ilike.%${query}%,short_description.ilike.%${query}%`)
      .limit(limit)
    if (error || !data) return []
    return normalizeProducts(data)
  } catch {
    return []
  }
}

// ─── Categories ───────────────────────────────────────────────────────────────

/** Fetch all active categories */
export async function fetchCategories(): Promise<Category[]> {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('id, name, slug, description, image_url, is_active')
      .eq('is_active', true)
      .order('sort_order')
    if (error || !data) return []
    return data as Category[]
  } catch {
    return []
  }
}

// ─── States / Regions ─────────────────────────────────────────────────────────

/** Fetch all active states (regions) */
export async function fetchStates(): Promise<State[]> {
  try {
    const { data, error } = await supabase
      .from('states')
      .select('id, name, description, image_path, is_active')
      .eq('is_active', true)
      .order('name')
    if (error || !data) return []
    return (data as any[]).map(s => ({
      ...s,
      slug:      s.id,               // id IS the slug in this schema
      image_url: s.image_path ?? null,
    })) as State[]
  } catch {
    return []
  }
}
