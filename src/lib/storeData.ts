// ═══════════════════════════════════════════════════════════════
// lib/storeData.ts
// Server-only helper — uses SERVICE KEY (bypasses RLS).
// Mirrors old site's api/store-data.js exactly.
// Call from Server Components and API routes — never from client.
// ═══════════════════════════════════════════════════════════════

import { unstable_cache } from 'next/cache'
import { getServiceClient } from './supabase'
import { applyProductImages } from './normalizeProduct'
import type { Product, Category, State } from '@/types'

// Minimal shapes for related tables (not full DB types)
export interface ProductImage   { product_id: number; image_url: string; sort_order: number }
export interface ProductVariant { id: number; product_id: number; price: number; mrp: number | null; variant_value: string | null; size?: string | null; available_stock: number; is_active: boolean; sort_order?: number }
export interface StateImage     { state_id: string; image_url: string; sort_order: number }
export interface Coupon         { code: string; type: string; value: number; min_order: number | null; max_uses: number | null; uses_count: number; expires_at: string | null; first_order_only: boolean; max_discount: number | null }
export interface SiteSettingRow { key: string; value: string }

export interface StoreData {
  products:         Product[]
  product_images:   ProductImage[]
  product_variants: ProductVariant[]
  categories:       Category[]
  settings:         Record<string, string>
  states:           State[]
  state_images:     StateImage[]
  coupons:          Coupon[]
}

// BUG FIX (HIGH – per-Lambda in-memory cache): the old module-level `let _cache`
// only lives in a single Lambda instance's memory. On Vercel serverless, every cold
// start gets an empty cache, so the 60s TTL was per-instance — a product going OOS
// could stay "In Stock" on warm Lambdas for up to 60 s with no shared invalidation.
//
// Fix: delegate caching to Next.js `unstable_cache`, which writes to the shared
// Data Cache (backed by the same Redis/filesystem layer as `fetch()` cache). Every
// Lambda instance hits the same store, so TTL-based invalidation is global.
// The `force` parameter is kept for API routes that must bypass the cache; it uses
// `{ revalidate: 0 }` to skip caching entirely for that one call.

async function _fetchStoreData(): Promise<StoreData> {
  const db = getServiceClient()

  const [
    { data: products },
    { data: productImages },
    { data: productVariants },
    { data: categories },
    { data: siteSettings },
    { data: states },
    { data: stateImages },
    { data: coupons },
  ] = await Promise.all([
    db.from('products')
      .select('*')
      .eq('status', 'active')
      .eq('is_deleted', false)
      .order('name')
      .limit(500),
    db.from('product_images')
      .select('product_id, image_url, sort_order')
      .order('product_id').order('sort_order'),
    db.from('product_variants')
      .select('*')
      .eq('is_active', true)
      .order('product_id').order('sort_order'),
    db.from('categories')
      .select('id, name, slug, emoji, description, image_url, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order').order('name'),
    db.from('site_settings').select('key, value'),
    db.from('states').select('*').eq('is_active', true).order('name'),
    db.from('state_images')
      .select('state_id, image_url, sort_order')
      .order('state_id').order('sort_order'),
    db.from('coupons')
      .select('code,type,value,min_order,max_uses,uses_count,expires_at,first_order_only,max_discount')
      .eq('is_active', true),
  ])

  // Convert settings array → object (same as old site)
  const settings: Record<string, string> = {}
  ;(siteSettings || []).forEach((s: SiteSettingRow) => { settings[s.key] = s.value })

  return {
    products:         products         || [],
    product_images:   productImages    || [],
    product_variants: productVariants  || [],
    categories:       categories       || [],
    settings,
    states:           states           || [],
    state_images:     stateImages      || [],
    coupons:          coupons          || [],
  }
}

// Shared cross-Lambda cache via Next.js Data Cache (60 s TTL).
const _getCachedStoreData = unstable_cache(
  _fetchStoreData,
  ['store-data'],
  { revalidate: 60, tags: ['store-data'] },
)

// Force-fetch bypasses the shared cache (used by admin/webhook invalidation).
const _getFreshStoreData = unstable_cache(
  _fetchStoreData,
  ['store-data-fresh'],
  { revalidate: 0 },
)

export async function getStoreData(force = false): Promise<StoreData> {
  return force ? _getFreshStoreData() : _getCachedStoreData()
}

// ── Same imgFor() as old site main.js initCollectionImages ───────────────
export function imgFor(cat: Category, settings: Record<string, string>): string {
  const keysToTry = [
    cat.slug,
    cat.name,
    (cat.name || '').toLowerCase(),
    String(cat.id),
  ].filter(Boolean)
  for (const k of keysToTry) {
    const v = (settings[`coll_img_${k}`] || '').trim()
    if (v) return v
  }
  return (cat.image_url || '').trim()
}

// ── Build categories with images — same as old site initCollectionImages ─
export function buildCategories(storeData: StoreData) {
  const { categories, settings } = storeData
  return categories
    .filter(c => settings[`coll_hidden_${c.slug || c.id}`] !== 'true')
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99) || a.name.localeCompare(b.name))
    .map(c => ({ ...c, image_url: imgFor(c, settings) || null }))
}

// ── Products with images applied (same as old site main.js) ─────────────
export function getProductsWithImages(storeData: StoreData) {
  return applyProductImages(storeData.products, storeData.product_images)
}
