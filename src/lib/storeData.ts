// ═══════════════════════════════════════════════════════════════
// lib/storeData.ts
// Server-only helper — uses SERVICE KEY (bypasses RLS).
// Mirrors old site's api/store-data.js exactly.
// Call from Server Components and API routes — never from client.
// ═══════════════════════════════════════════════════════════════

import { unstable_cache } from 'next/cache'
import { getServiceClient } from './supabase'
import { applyProductImages, normalizeProducts } from './normalizeProduct'
import { logger } from './logger'
import { scrubProduct, scrubVariant } from './privateFields'
import type { Product, Category, State } from '@/types'

// Minimal shapes for related tables (not full DB types)
export interface ProductImage   { product_id: number; image_url: string; sort_order: number }
export interface ProductVariant { id: number; product_id: number; price: number; mrp: number | null; variant_value: string | null; size?: string | null; available_stock: number; is_active: boolean; sort_order?: number }
export interface StateImage     { state_id: string; image_url: string; sort_order: number }
export interface SiteSettingRow { key: string; value: string }

export interface StoreData {
  products:         Product[]
  product_images:   ProductImage[]
  product_variants: ProductVariant[]
  categories:       Category[]
  settings:         Record<string, string>
  states:           State[]
  state_images:     StateImage[]
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

// BUG FIX ATTEMPT REVERTED (2026-07 — production build failure): this was
// briefly changed to an explicit column list to reduce payload size (see
// toCardProductData in normalizeProduct.ts for the half of that fix that's
// still in place), but the guessed column list included `sku`, which does
// not exist on the real `products` table in production — Vercel build
// failed with `column products.sku does not exist`. This repo has no
// CREATE/ALTER TABLE statements or generated Supabase types checked in
// anywhere, so there is no reliable way to verify a hand-written column list
// against the actual live schema from a read of the codebase alone. Rather
// than guess again, this reverts to `.select('*')` — correct and safe by
// construction, at the cost of also fetching long_description/tags/AI
// content columns that no listing page reads. If this needs to be narrowed
// again in the future, do it by running the exact query against a real
// staging/prod database first (e.g. via the Supabase SQL editor or `supabase
// gen types`) rather than inferring column names from the Product TS type,
// which — as this incident shows — does not necessarily match the live table.
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

// BUG FIX (found via the "Bestsellers vanishes on hard refresh, reappears
// after a client-side navigation" report): the fetch this powers gets
// wrapped in TWO independent 60s caches — this function's own result via
// unstable_cache('store-data') below, AND the homepage's own
// `export const revalidate = 60` Full Route Cache in page.tsx. A single
// transient hiccup here (Supabase cold-connection latency on a cold Lambda,
// a momentary network blip — anything that would normally just be a rare,
// forgotten one-off retry) doesn't stay transient once it happens to land
// on the request that regenerates either of those caches: whatever this
// function returns (or throws, triggering BestSellers.tsx's fail-safe
// `return null`) gets BAKED IN and re-served as-is to every hard-refresh
// visitor for the next 60 seconds. A client-side navigation to another page
// doesn't hit the same Full Route Cache entry, so it can independently
// trigger a fresh (successful) fetch — hence "goes to /products and back
// fixes it," which is really just a second, uncached attempt succeeding.
//
// Fix: retry transient failures INSIDE the function that actually gets
// cached, before either cache layer ever sees a failure to bake in. Same
// withRetry pattern already used in orderService.ts/profileService.ts.
async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 400): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try { return await fn() } catch (err: unknown) {
      lastErr = err
      if (i < retries - 1) {
        logger.warn('[storeData] fetch attempt failed — retrying', {
          attempt: i + 1, retries, error: err instanceof Error ? err.message : String(err),
        })
        await new Promise(r => setTimeout(r, delayMs * 2 ** i))
      }
    }
  }
  throw lastErr
}

// ── ENTERPRISE CACHE LAYOUT (Oct 2026) ─────────────────────────────────────
// Next's Data Cache silently refuses to store any single entry over 2 MB
// ("Failed to set Next.js data cache, items over 2MB can not be cached") —
// no error, the page just re-queries Supabase on EVERY request. The old
// design put the whole catalog (every product with its long_description and
// five AI text blobs, + variants, images, categories, states) into ONE entry,
// so a growing catalog would quietly stop caching. Large stores avoid this
// with three rules, applied below:
//   1. Cache only what list pages render. Heavy PDP-only text stays out of
//      the shared entry; the PDP fetches it per product (getProductBySlug).
//   2. Split by data domain: the big, fast-changing product bundle and the
//      tiny, slow-changing catalog meta (categories/states/settings) are
//      separate entries with their own tags, so neither can push the other
//      over the limit and each can be invalidated independently.
//   3. Measure: log a warning long before the ceiling is hit instead of
//      discovering it from a Supabase bill.
//
// We can't narrow the SELECT itself (a hand-written column list already
// broke a production build once — see the note above fetchAllActiveProducts),
// so heavy columns are dropped from each row right after fetching, BEFORE the
// result reaches unstable_cache. The cached payload is what the 2 MB limit
// measures.
const CACHE_WARN_BYTES = 1_500_000

/** Columns no list/grid/search page reads. cost_price is also a margin figure
 *  that should never be sitting in a payload that gets near client code. */
function toListProduct(p: Product): Product {
  return {
    ...scrubProduct(p),
    long_description:   null,
    ai_description:     null,
    ai_health_benefits: null,
    ai_how_to_use:      null,
    ai_storage_tips:    null,
    ai_who_should_buy:  null,
    ai_generated_at:    null,
  }
}

function warnIfNearCacheLimit(name: string, value: unknown) {
  try {
    const bytes = JSON.stringify(value).length
    if (bytes > CACHE_WARN_BYTES) {
      logger.warn(`[storeData] "${name}" cache entry is ${(bytes / 1e6).toFixed(2)} MB — Next's Data Cache stops storing entries over 2 MB. Time to paginate or split further.`, { bytes })
    }
  } catch { /* measuring must never break a fetch */ }
}

type CatalogProducts = Pick<StoreData, 'products' | 'product_images' | 'product_variants'>
type CatalogMeta     = Pick<StoreData, 'categories' | 'settings' | 'states' | 'state_images'>

async function _fetchCatalogProductsOnce(): Promise<CatalogProducts> {
  const db = getServiceClient()
  const [products, productImagesRes, productVariantsRes] = await Promise.all([
    fetchAllActiveProducts(db),
    db.from('product_images')
      .select('product_id, image_url, sort_order')
      .order('product_id').order('sort_order'),
    db.from('product_variants')
      .select('*')
      .eq('is_active', true)
      .order('product_id').order('sort_order'),
  ])
  // supabase-js resolves (not rejects) on failure — surface it so withRetry
  // actually retries instead of silently caching an empty list.
  if (productImagesRes.error)   throw productImagesRes.error
  if (productVariantsRes.error) throw productVariantsRes.error

  const result: CatalogProducts = {
    products:         (products || []).map(toListProduct),
    product_images:   productImagesRes.data   || [],
    // Private columns (cost_price, margin_pct, warehouse counters…) never enter the
    // cached catalogue — everything downstream (store-data API, search-catalog,
    // listing pages) derives from this object and ends up in client payloads.
    product_variants: (productVariantsRes.data || []).map(scrubVariant),
  }
  warnIfNearCacheLimit('catalog-products', result)
  return result
}

async function _fetchCatalogMetaOnce(): Promise<CatalogMeta> {
  const db = getServiceClient()
  const [categoriesRes, siteSettingsRes, statesRes, stateImagesRes] = await Promise.all([
    db.from('categories')
      .select('id, name, slug, emoji, description, image_url, sort_order, is_active, show_on_homepage')
      .eq('is_active', true)
      .order('sort_order').order('name'),
    db.from('site_settings').select('key, value'),
    db.from('states').select('*').eq('is_active', true).order('name'),
    db.from('state_images')
      .select('state_id, image_url, sort_order')
      .order('state_id').order('sort_order'),
  ])
  if (categoriesRes.error)    throw categoriesRes.error
  if (siteSettingsRes.error)  throw siteSettingsRes.error
  if (statesRes.error)        throw statesRes.error
  if (stateImagesRes.error)   throw stateImagesRes.error

  // Convert settings array → object (same as old site)
  const settings: Record<string, string> = {}
  ;(siteSettingsRes.data || []).forEach((r: SiteSettingRow) => { settings[r.key] = r.value })

  const result: CatalogMeta = {
    categories:  categoriesRes.data  || [],
    settings,
    states:      statesRes.data      || [],
    state_images: stateImagesRes.data || [],
  }
  warnIfNearCacheLimit('catalog-meta', result)
  return result
}

// BUG FIX (found via production log storm — Vercel logs showed dozens of
// concurrent "getSiteSettings timed out"/500 errors across /regions/* and
// cart-settings/coupon-hints/cart-upsells firing within the same few
// seconds): unstable_cache only avoids re-fetching AFTER its cache is
// populated — it does NOT prevent multiple concurrent callers from all
// missing a cold cache at the same instant and each independently calling
// _fetchStoreData(). A burst of many pages rendering at once (mass ISR
// regeneration after a deploy, or a crawler hitting many /regions/[slug]
// pages within seconds) can trigger dozens of simultaneous, fully-redundant
// 8-query fetches — compounding load on Supabase at exactly the moment
// other routes sharing the same connection pool are also under pressure.
// Fix: single-flight within this process — while a fetch is already in
// progress, every other caller awaits that SAME promise instead of
// starting a new one, regardless of which of the two unstable_cache
// wrappers below they came in through.
// Single-flight per half: concurrent callers share one in-progress fetch.
let _inFlightProducts: Promise<CatalogProducts> | null = null
let _inFlightMeta:     Promise<CatalogMeta>     | null = null

function _fetchCatalogProducts(): Promise<CatalogProducts> {
  if (_inFlightProducts) return _inFlightProducts
  _inFlightProducts = withRetry(() => _fetchCatalogProductsOnce()).finally(() => { _inFlightProducts = null })
  return _inFlightProducts
}
function _fetchCatalogMeta(): Promise<CatalogMeta> {
  if (_inFlightMeta) return _inFlightMeta
  _inFlightMeta = withRetry(() => _fetchCatalogMetaOnce()).finally(() => { _inFlightMeta = null })
  return _inFlightMeta
}

// Shared cross-Lambda cache via Next.js Data Cache (60 s TTL), one entry per
// data domain. Both carry the 'store-data' tag so existing
// revalidateTag('store-data') calls still clear everything; each also has its
// own tag for targeted invalidation.
const _getCachedCatalogProducts = unstable_cache(
  _fetchCatalogProducts, ['catalog-products'],
  { revalidate: 60, tags: ['store-data', 'catalog-products'] },
)
// Categories/states/settings change rarely — a longer TTL cuts Supabase load.
const _getCachedCatalogMeta = unstable_cache(
  _fetchCatalogMeta, ['catalog-meta'],
  { revalidate: 300, tags: ['store-data', 'catalog-meta'] },
)

// BUG FIX (audit, Oct 2026): this used to be a SECOND unstable_cache entry
// ('store-data-fresh') with `revalidate: false`. In Next, `revalidate: false`
// means "cache forever", not "don't cache" — so getStoreData(true) returned
// the same frozen snapshot on every later call, and (because it had no tag)
// nothing could ever clear it. Worse, it never touched the real 'store-data'
// entry the homepage reads, so the admin's "revalidate" call did nothing for
// product/price/stock edits until the 60s TTL lapsed by itself.
// Force now calls the single-flight fetch directly (a true bypass); cache
// invalidation for everyone else is done with revalidateTag('store-data')
// in /api/v1/revalidate.
export async function getStoreData(force = false): Promise<StoreData> {
  const [prod, meta] = force
    ? await Promise.all([_fetchCatalogProducts(), _fetchCatalogMeta()])
    : await Promise.all([_getCachedCatalogProducts(), _getCachedCatalogMeta()])
  return { ...prod, ...meta }
}

/** Categories / states / state images / settings only — the small, slow-moving
 *  half of the catalog. Layout, header and any page that doesn't need products
 *  should call THIS instead of getStoreData() or querying Supabase directly:
 *  it is served from the shared 5-minute Data Cache. */
export async function getCatalogMeta(): Promise<CatalogMeta> {
  return _getCachedCatalogMeta()
}

// ── imgFor() — category card image resolution ────────────────────────────
//
// BUG FIX (data-architecture, confirmed against live DB, not guessed):
// categories.image_url is a real column on the categories table (already
// used by the admin Catalogue tab) — but it sat unused/null while every
// collection-card image actually lived in site_settings under
// coll_img_<key>, where <key> was built from whichever of
// cat.slug / cat.name / cat.name.toLowerCase() / cat.id happened to match
// at save time. Because category names get edited over time (renames,
// recapitalization) but the settings KEY was baked from the name/slug at
// the moment of upload, this drifted: 8 categories still matched by luck,
// but "Himalayan Honey" (slug: himalayan-honey) had its most recent image
// saved under the stale key "coll_img_Himalayan-honey" (capital H) — a
// plain JS object lookup is case-sensitive, so `coll_img_${cat.slug}`
// never found it. The category silently rendered emoji-only.
//
// Fix: categories.image_url is now the single source of truth (migration:
// backfill_category_image_url_from_legacy_settings, run 2026-08-13 —
// verified by upload-timestamp clustering, not guessed). The old
// coll_img_<key> settings lookup is kept ONLY as a legacy fallback for the
// gap between "an admin uploads a new collection image" (still writes
// site_settings, until pahadi-admin-main's Collection Images page is
// migrated to PATCH categories.image_url directly — companion fix) and
// this code deploying. Every time that fallback actually fires, it means
// image_url is out of sync with the last-uploaded image, so it's logged
// (not silent) to make the drift observable instead of it quietly working
// "by luck" again. Once admin's write-path fix has shipped for a while,
// this whole fallback branch can be deleted.
export function imgFor(cat: Category, settings: Record<string, string>): string {
  const primary = (cat.image_url || '').trim()
  if (primary) return primary

  const keysToTry = [
    cat.slug,
    cat.name,
    (cat.name || '').toLowerCase(),
    String(cat.id),
  ].filter(Boolean)
  for (const k of keysToTry) {
    const v = (settings[`coll_img_${k}`] || '').trim()
    if (v) {
      logger.warn('[imgFor] category.image_url missing — served from legacy coll_img_ setting', {
        categoryId: cat.id, categorySlug: cat.slug, matchedKey: `coll_img_${k}`,
      })
      return v
    }
  }
  return ''
}

// ── Build categories with images — same as old site initCollectionImages ─
//
// BUG FIX (data-architecture, companion to imgFor() above): homepage-hide
// state used to live exclusively in coll_hidden_<key> settings — the exact
// same case/rename-drift risk as coll_img_ (30 orphaned coll_hidden_* keys
// found in the DB from past category renames, e.g. coll_hidden_"Wild Honey",
// coll_hidden_"Spices of India" — none currently true, but the mechanism was
// one rename away from silently un-hiding or mis-hiding a category the same
// way images silently broke). categories.show_on_homepage is now the single
// source of truth. Legacy settings kept as a logged fallback for the same
// admin-deploy transition window as imgFor().
export function buildCategories(storeData: StoreData) {
  const { categories, settings } = storeData
  return categories
    .filter(c => {
      if (c.show_on_homepage === false) return false
      if (c.show_on_homepage === true) return true
      // show_on_homepage is null/undefined only for rows the migration
      // didn't touch (shouldn't happen post-migration, but don't assume) —
      // fall back to the legacy key, logged so it's visible if ever hit.
      const legacyHidden = settings[`coll_hidden_${c.slug || c.id}`] === 'true'
      if (legacyHidden) {
        logger.warn('[buildCategories] category.show_on_homepage unset — hidden via legacy coll_hidden_ setting', {
          categoryId: c.id, categorySlug: c.slug,
        })
      }
      return !legacyHidden
    })
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99) || a.name.localeCompare(b.name))
    .map(c => ({ ...c, image_url: imgFor(c, settings) || null }))
}

// BUG FIX (Browse/New Arrivals category list coupled to the homepage flag):
// buildCategories() above hides any category with show_on_homepage === false,
// which is correct for the homepage strip but ALSO fed the /products sidebar,
// the mobile filter drawer, /new-arrivals and ?category= resolution. Hiding a
// collection from the homepage therefore made it vanish from Browse filters,
// and its ?category= URL silently fell through to "All Products".
// buildBrowseCategories() returns every ACTIVE category (the catalog meta
// query already filters is_active) with the same image + ordering treatment,
// and ignores show_on_homepage entirely. Only the homepage uses
// buildCategories().
export function buildBrowseCategories(storeData: StoreData) {
  const { categories, settings } = storeData
  return [...categories]
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99) || a.name.localeCompare(b.name))
    .map(c => ({ ...c, image_url: imgFor(c, settings) || null }))
}

// ── Attach variants to products ──────────────────────────────────────────
// BUG FIX (CRITICAL — data/pricing integrity): storeData.product_variants was
// being fetched on every getStoreData() call but NEVER grouped and merged
// back onto individual products. Every consumer of getProductsWithImages()
// (home page BestSellers/NewArrivals, /products, /regions/[slug], and
// /collections/[slug] which called applyProductImages directly) therefore
// always saw `product.product_variants === undefined`, so ProductCard's
// `baseVariant` was always null and every card silently fell back to the
// top-level product.price/mrp — even for multi-variant products where the
// PDP (which fetches variants directly via getProductBySlug) correctly shows
// the lowest active variant's price. That meant the listing price and the
// PDP price could disagree for the same product.
// Fix: group product_variants by product_id (same `mrp` ← `original_price`
// fallback used everywhere else in this file) and attach before normalizing.
export function attachVariants(
  products: Product[],
  variants: ProductVariant[],
): Product[] {
  if (!variants?.length) return products

  const byProd: Record<string, ProductVariant[]> = {}
  variants.forEach(v => {
    if (!v.product_id || !v.is_active) return
    const pid = String(v.product_id)
    if (!byProd[pid]) byProd[pid] = []
    byProd[pid].push(v)
  })

  return products.map(p => {
    const vs = byProd[String(p.id)]
    if (!vs?.length) return p
    const mapped = vs
      .map(v => ({
        ...v,
        mrp: (v as any).original_price ?? v.mrp ?? v.price,
      }))
      .sort((a, b) => a.price - b.price)
    return { ...p, product_variants: mapped } as Product
  })
}

// ── Products with images + variants applied (same as old site main.js) ──
export function getProductsWithImages(storeData: StoreData) {
  const withImages = applyProductImages(storeData.products, storeData.product_images)
  return attachVariants(withImages, storeData.product_variants)
}

// ═══════════════════════════════════════════════════════════════
// BUG FIX (perf — redundant full-catalog normalize, found while auditing
// /regions): every consumer of the region data (`/regions` listing,
// `/regions/[slug]` × 12 statically-generated pages, and the homepage
// ExploreByRegion widget) was independently calling
// `normalizeProducts(getProductsWithImages(storeData))` — a full O(n) pass
// over the ENTIRE product catalog — even though storeData itself is
// already cached for 60s. During ISR generation/revalidation of the 12
// region pages alone, that's up to 12x redundant normalization of the
// exact same data in the same 60s window, on top of whatever
// /regions and the homepage also trigger.
// Fix: cache the *normalized* result itself, tagged alongside 'store-data'
// so it invalidates together with the raw data. All region consumers now
// call this instead of re-running the pipeline themselves.
// ═══════════════════════════════════════════════════════════════
async function _computeNormalizedProducts(): Promise<Product[]> {
  const storeData = await getStoreData()
  const withImages = getProductsWithImages(storeData)
  return normalizeProducts(withImages) as Product[]
}

const _getCachedNormalizedProducts = unstable_cache(
  _computeNormalizedProducts,
  ['normalized-products'],
  { revalidate: 60, tags: ['store-data'] },
)

export async function getNormalizedProducts(): Promise<Product[]> {
  return _getCachedNormalizedProducts()
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
  product = scrubProduct(product)

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

  // The PDP passes these rows straight into client components, which
  // serializes every field into the page payload — scrub internal columns here,
  // at the single server-side exit point (Oct 2026 audit).
  return {
    product,
    variants: ((variants as ProductVariant[]) || []).map(scrubVariant),
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

  // BUG FIX (Issue C3, Oct 2026 audit): this used to be `.or(...).limit(4)`
  // with NO ordering, so Postgres returned whichever 4 rows it liked — the
  // related set could change between cache refreshes and routinely included
  // sold-out items. We now pull a bounded, deterministically ordered pool,
  // rank it in JS (in stock first → matches BOTH category and state →
  // bestseller → lowest id as a stable tiebreak) and keep `limit`.
  // Ranking only reorders; it never drops a product, so a category whose
  // items are all sold out still shows related cards instead of an empty row.
  const POOL_SIZE = Math.max(limit * 6, 24)

  const db = getServiceClient()
  const { data: rows, error: rowsErr } = await db
    .from('products')
    .select('*')
    .eq('status', 'active')
    .eq('is_deleted', false)
    .neq('id', productId)
    .or(filters.join(','))
    .order('id', { ascending: true })
    .limit(POOL_SIZE)
  if (rowsErr) {
    console.error('[getRelatedProducts] query failed:', rowsErr)
    return []
  }

  const pool = (rows as Product[]) || []
  if (pool.length === 0) return []

  const ids = pool.map(p => p.id)
  const [{ data: imgs, error: imgsErr }, { data: vars, error: varsErr }] = await Promise.all([
    db.from('product_images').select('product_id, image_url, sort_order').in('product_id', ids),
    db.from('product_variants').select('*').in('product_id', ids).eq('is_active', true),
  ])
  if (imgsErr) console.error('[getRelatedProducts] images fetch failed:', imgsErr)
  if (varsErr) console.error('[getRelatedProducts] variants fetch failed:', varsErr)

  const hasStock = (p: Product): boolean => {
    const vs = ((vars as ProductVariant[]) || []).filter(v => v.product_id === p.id)
    // Any active variant with stock makes the product buyable (the PDP lets the
    // customer pick it), so don't judge on the cheapest variant alone.
    if (vs.length > 0) return vs.some(v => (v.available_stock ?? 0) > 0)
    return (p.available_stock ?? 0) > 0
  }
  const isBestseller = (p: Product): boolean => Array.isArray(p.badges) && p.badges.includes('bestseller')
  const relevance = (p: Product): number =>
    (categoryId != null && p.category_id === categoryId ? 1 : 0) +
    (stateId && p.state_id === stateId ? 1 : 0)

  const related = pool
    .map(p => ({ p, stock: hasStock(p) ? 1 : 0, rel: relevance(p), best: isBestseller(p) ? 1 : 0 }))
    .sort((a, b) =>
      b.stock - a.stock ||
      b.rel   - a.rel   ||
      b.best  - a.best  ||
      Number(a.p.id) - Number(b.p.id))
    .slice(0, limit)
    .map(x => x.p)

  return related.map(p => {
    const pImgs = ((imgs as ProductImage[]) || [])
      .filter(i => i.product_id === p.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const pVars = ((vars as ProductVariant[]) || [])
      .filter(v => v.product_id === p.id)
      .map(scrubVariant)
      .map(v => ({
        ...v,
        // BUG FIX (found via manual line-by-line audit): product_variants has
        // no literal mrp column — map it from original_price (the real
        // column), same as every other fix in this pass. Without this,
        // RelatedCard's `baseVariant?.mrp` was always undefined and silently
        // fell back to the product-level mrp for every related-product card.
        mrp: (v as any).original_price ?? v.mrp ?? v.price,
      }))
      .sort((a, b) => a.price - b.price)
    const badgeArr: string[] = Array.isArray(p.badges) ? p.badges : []
    return {
      ...scrubProduct(p),
      badges_bestseller: badgeArr.includes('bestseller'),
      badges_new:        badgeArr.includes('new'),
      badges_organic:    badgeArr.includes('organic'),
      _firstImage:       pImgs[0]?.image_url || p.image_url || '',
      _variants:         pVars,
    }
  })
}
