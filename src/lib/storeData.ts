// ═══════════════════════════════════════════════════════════════
// lib/storeData.ts
// Server-only helper — uses SERVICE KEY (bypasses RLS).
// Mirrors old site's api/store-data.js exactly.
// Call from Server Components and API routes — never from client.
// ═══════════════════════════════════════════════════════════════

import { getServiceClient } from './supabase'
import { applyProductImages } from './normalizeProduct'

export interface StoreData {
  products:         any[]
  product_images:   any[]
  product_variants: any[]
  categories:       any[]
  settings:         Record<string, string>
  states:           any[]
  state_images:     any[]
  coupons:          any[]
}

let _cache: StoreData | null = null
let _cacheAt = 0
const CACHE_TTL = 60_000 // 60 seconds

export async function getStoreData(force = false): Promise<StoreData> {
  const now = Date.now()
  if (!force && _cache && (now - _cacheAt) < CACHE_TTL) return _cache

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
  ;(siteSettings || []).forEach((s: any) => { settings[s.key] = s.value })

  _cache = {
    products:         products         || [],
    product_images:   productImages    || [],
    product_variants: productVariants  || [],
    categories:       categories       || [],
    settings,
    states:           states           || [],
    state_images:     stateImages      || [],
    coupons:          coupons          || [],
  }
  _cacheAt = now
  return _cache
}

// ── Same imgFor() as old site main.js initCollectionImages ───────────────
export function imgFor(cat: any, settings: Record<string, string>): string {
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
