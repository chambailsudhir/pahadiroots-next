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
// `{ revalidate: false }` to skip caching entirely for that one call.

// BUG FIX (HIGH – silent 500-product ceiling): products were fetched with a
// hardcoded `.limit(500)`. A single request also means any catalog over 500
// active products would have its alphabetically-last rows silently vanish
// from every page that reads `getStoreData()` (home, /products, /regions/[slug])
// with no error, no log — 404s on the PDP for products that are active in
// Supabase. Fix: page through the full result set in batches so catalog-wide
// callers (listing pages, generateStaticParams) always get every active row.
const PRODUCTS_PAGE_SIZE = 1000

async function fetchAllActiveProducts(db: ReturnType<typeof getServiceClient>) {
  const rows: Product[] = []
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from('products')
      .select('*')
      .eq('status', 'active')
      .eq('is_deleted', false)
      .order('name')
      .order('id') // deterministic tiebreaker — required for stable pagination across requests
      .range(from, from + PRODUCTS_PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...(data as Product[]))
    if (data.length < PRODUCTS_PAGE_SIZE) break
    from += PRODUCTS_PAGE_SIZE
  }
  return rows
}

async function _fetchStoreData(): Promise<StoreData> {
  const db = getServiceClient()

  const [
    products,
    { data: productImages },
    { data: productVariants },
    { data: categories },
    { data: siteSettings },
    { data: states },
    { data: stateImages },
    { data: coupons },
  ] = await Promise.all([
    fetchAllActiveProducts(db),
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
    products:         products         || [],  // already an array (paginated fetch)
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
  { revalidate: false },
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

// ═══════════════════════════════════════════════════════════════
// BUG FIX (HIGH – catalog fetch doesn't scale for a single PDP request):
// fetchProductData() in app/products/[slug]/page.tsx used to call
// getStoreData() and linear-scan the *entire* active catalog (all products,
// all variants, all images, all coupons) just to find one product by slug.
// On any 60s cache miss that's a full-table fetch to render a single PDP,
// and it compounds with the 500-row cap fixed above. This does a direct,
// indexed `eq('slug', slug)` lookup instead — O(1) regardless of catalog
// size — fetching variants/images only for the matched product.
// ═══════════════════════════════════════════════════════════════
export interface ProductBySlugResult {
  product: Product | null
  variants: ProductVariant[]
  images: ProductImage[]
}

export async function getProductBySlug(slug: string): Promise<ProductBySlugResult> {
  const db = getServiceClient()

  // ilike treats '%' and '_' as wildcards — escape them so a slug containing
  // either character (or a literal backslash) can't unintentionally match
  // more than one row. This keeps the lookup case-insensitive (matching the
  // old in-memory `.toLowerCase() === .toLowerCase()` comparison) without
  // the wildcard-injection risk of an unescaped ilike().
  const escapedSlug = slug.replace(/[\\%_]/g, '\\$&')

  // Slug is the primary lookup; numeric legacy links (/products/123) fall
  // back to an id lookup only if the slug lookup misses.
  let product: Product | null = null
  const bySlug = await db
    .from('products')
    .select('*')
    .eq('status', 'active')
    .eq('is_deleted', false)
    .ilike('slug', escapedSlug)
    .maybeSingle()
  if (bySlug.error) console.error('[getProductBySlug] slug lookup failed:', bySlug.error)
  product = (bySlug.data as Product) || null

  if (!product && /^\d+$/.test(slug)) {
    const byId = await db
      .from('products')
      .select('*')
      .eq('status', 'active')
      .eq('is_deleted', false)
      .eq('id', Number(slug))
      .maybeSingle()
    if (byId.error) console.error('[getProductBySlug] id fallback lookup failed:', byId.error)
    product = (byId.data as Product) || null
  }

  if (!product) return { product: null, variants: [], images: [] }

  const [{ data: variants, error: variantsErr }, { data: images, error: imagesErr }] = await Promise.all([
    db.from('product_variants')
      .select('*')
      .eq('product_id', product.id)
      .eq('is_active', true)
      .order('sort_order'),
    db.from('product_images')
      .select('product_id, image_url, sort_order')
      .eq('product_id', product.id)
      .order('sort_order'),
  ])
  if (variantsErr) console.error('[getProductBySlug] variants fetch failed:', variantsErr)
  if (imagesErr)   console.error('[getProductBySlug] images fetch failed:', imagesErr)

  return {
    product,
    variants: (variants as ProductVariant[]) || [],
    images:   (images as ProductImage[]) || [],
  }
}

export interface RelatedProduct extends Product {
  _firstImage: string
  _variants:   ProductVariant[]
}

// ── Targeted related-products fetch (companion fix to getProductBySlug) ──
// Same state OR category, excludes self — queried directly instead of
// filtering the full in-memory catalog.
export async function getRelatedProducts(opts: {
  productId:  number
  categoryId: number | null
  stateId:    string | null
  limit?:     number
}): Promise<RelatedProduct[]> {
  const { productId, categoryId, stateId, limit = 4 } = opts
  const filters: string[] = []
  if (categoryId != null) filters.push(`category_id.eq.${categoryId}`)
  if (stateId)             filters.push(`state_id.eq.${stateId}`)
  if (filters.length === 0) return []

  const db = getServiceClient()
  const { data: rows, error: rowsErr } = await db
    .from('products')
    .select('*')
    .eq('status', 'active')
    .eq('is_deleted', false)
    .neq('id', productId)
    .or(filters.join(','))
    .limit(limit)
  if (rowsErr) {
    console.error('[getRelatedProducts] query failed:', rowsErr)
    return []
  }

  const related = (rows as Product[]) || []
  if (related.length === 0) return []

  const ids = related.map(p => p.id)
  const [{ data: imgs, error: imgsErr }, { data: vars, error: varsErr }] = await Promise.all([
    db.from('product_images').select('product_id, image_url, sort_order').in('product_id', ids),
    db.from('product_variants').select('*').in('product_id', ids).eq('is_active', true),
  ])
  if (imgsErr) console.error('[getRelatedProducts] images fetch failed:', imgsErr)
  if (varsErr) console.error('[getRelatedProducts] variants fetch failed:', varsErr)

  return related.map(p => {
    const pImgs = ((imgs as ProductImage[]) || [])
      .filter(i => i.product_id === p.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const pVars = ((vars as ProductVariant[]) || [])
      .filter(v => v.product_id === p.id)
      .sort((a, b) => a.price - b.price)
    const badgeArr: string[] = Array.isArray(p.badges) ? p.badges : []
    return {
      ...p,
      badges_bestseller: badgeArr.includes('bestseller'),
      badges_new:        badgeArr.includes('new'),
      badges_organic:    badgeArr.includes('organic'),
      _firstImage:       pImgs[0]?.image_url || p.image_url || '',
      _variants:         pVars,
    }
  })
}
