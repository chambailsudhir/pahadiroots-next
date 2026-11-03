/**
 * /api/v1/cart-upsells — returns up to 6 upsell candidates excluding cart items.
 *
 * SRP fix: store-data fetched all ~500 products + all variants just so the cart
 * page could build 6 upsell cards. This endpoint fetches only what it needs:
 *   - Top 80 in-stock variants (sorted by available_stock desc)
 *   - Only the product fields required for the UpsellItem shape
 *   - Excludes variants/products already in the cart (query params)
 *
 * The result is a fraction of the store-data payload and cached for 30 s
 * (fresher than store-data's 60 s — stock levels matter more here).
 *
 * Query params:
 *   variantIds  comma-separated list of variantIds currently in cart
 *   productIds  comma-separated list of productIds currently in cart
 *
 * Bug-fix: ghost upsell items from soft-deleted/inactive products.
 *   The product_variants query only checks is_active=true on the variant. A
 *   product can be soft-deleted (is_deleted=true) or deactivated (status≠active)
 *   while its variants remain active in the DB. Previously such variants would
 *   pass the exclusion filter, but since their product_id was absent from
 *   prodMap they'd render as a ghost card (name="Product", slug=""). This
 *   produces a broken link and a misleading card in the cart.
 *   Fix: added `v.product_id in prodMap` guard before the dedup+slice step so
 *   only variants whose product passed the status=active&is_deleted=false check
 *   can become upsell items.
 *
 * Consumed by: useCartPage hook
 */

import { variantDisplayMrp } from '@/lib/pricing/linePricing'
import { NextRequest, NextResponse } from 'next/server'
import type { Product } from '@/types'
import { getStoreData } from '@/lib/storeData'
import type { UpsellItem } from '@/types'
import { logger }                from '@/lib/logger'
import { rememberGood, recallGood } from '@/lib/api/lastGood'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  // BUG FIX: the query params were split into Sets with no cap on length or
  // format validation.  A malicious request could send a single `variantIds`
  // param containing millions of comma-separated characters, forcing the server
  // to allocate a huge Set and iterate it on every filter step — a cheap DoS.
  //
  // Fixes applied:
  //   1. Raw param length capped at 4 KB before splitting (rejects obvious bombs).
  //   2. Individual ID count capped at MAX_IDS_PER_PARAM (50 — a realistic cart
  //      has at most 30 items per createOrderSchema, so 50 is generous).
  //   3. Each ID filtered to UUID-like characters only (hex digits + hyphens,
  //      ≤ 40 chars) so arbitrary strings cannot be stored or logged.
  const MAX_PARAM_BYTES = 4096
  const MAX_IDS_PER_PARAM = 50
  // UUID v4 = 36 chars; allow up to 40 for any variant format.
  const SAFE_ID_RE = /^[0-9a-f-]{1,40}$/i

  function parseIdParam(raw: string | null): Set<string> {
    if (!raw || raw.length > MAX_PARAM_BYTES) return new Set()
    return new Set(
      raw.split(',')
        .filter(id => id.length > 0 && SAFE_ID_RE.test(id))
        .slice(0, MAX_IDS_PER_PARAM),
    )
  }

  const excludedVariantIds = parseIdParam(searchParams.get('variantIds'))
  const excludedProductIds = parseIdParam(searchParams.get('productIds'))

  // Last-good fallback (see lib/api/lastGood.ts) — keyed by the exact cart
  // contents, because the result excludes items already in the cart. Upsells
  // are cosmetic suggestions; add-to-cart re-validates stock and price.
  const lastGoodKey = 'cart-upsells:'
    + [...excludedVariantIds].sort().join(',') + '|' + [...excludedProductIds].sort().join(',')
  const fallback = recallGood<UpsellItem[]>(lastGoodKey, 30 * 60_000)

  try {
    // Served from the shared, cached catalogue (getStoreData: 60 s Data Cache, one entry for the whole site) instead of three uncached
    // PostgREST round-trips on every cart view (~1.7 s on a cold start → the "Customers Also Buy" rail appeared late). Same rules as before:
    // active, non-deleted products; active in-stock variants, most stock first; one card per product; cart items excluded; top 6.
    const data = await getStoreData()
    const prodMap: Record<string, Product> = {}
    for (const p of data.products) if (p.is_active !== false && !p.is_deleted) prodMap[String(p.id)] = p
    const imgMap: Record<string, string> = {}
    for (const img of data.product_images) {
      const k = String(img.product_id)
      if (!imgMap[k] && img.image_url) imgMap[k] = img.image_url
    }
    const variants = data.product_variants
      .filter(v => v.is_active && Number(v.available_stock) > 0)
      .sort((x, y) => Number(y.available_stock) - Number(x.available_stock))
      .slice(0, 80)

    const seenProducts = new Set<string>()
    const upsells: UpsellItem[] = variants
      .filter(v =>
        !excludedVariantIds.has(String(v.id)) &&
        !excludedProductIds.has(String(v.product_id)) &&
        // a variant of a deleted / inactive product must not render as a ghost card
        String(v.product_id) in prodMap,
      )
      .filter(v => {
        const k = String(v.product_id)
        if (seenProducts.has(k)) return false
        seenProducts.add(k)
        return true
      })
      .slice(0, 6)
      .map(v => {
        const p = prodMap[String(v.product_id)] as Product & { badges?: string[] }
        const badgeArr = Array.isArray(p.badges) ? p.badges : []
        const isBestseller = badgeArr.includes('bestseller')
        const isOrganic    = badgeArr.includes('organic')
        const isNew        = badgeArr.includes('new')
        const badge = isBestseller ? 'Bestseller'
          : isOrganic              ? 'Natural'
          : isNew                  ? 'New Arrival'
          : null
        return {
          id:          String(v.id),
          productId:   String(v.product_id),
          name:        p.name    ?? 'Product',
          slug:        p.slug    ?? '',
          size:        v.variant_value ?? v.size ?? '',
          price:       v.price,
          mrp:         variantDisplayMrp(v as never, p as never),
          emoji:       p.emoji   ?? null,
          image:       imgMap[String(v.product_id)] ?? null,
          gstRate:     p.gst_rate    ?? 5,
          maxQty:      v.available_stock ?? 10,
          badge,
          isOrganic,
          isHimalayan:  !!p.state_id,
          isBestseller,
        }
      })

    rememberGood(lastGoodKey, upsells)
    return NextResponse.json(
      { upsells },
      { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' } },
    )
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    if (fallback) {
      logger.warn('cart_upsells_served_stale', {
        action: 'cart_upsells.stale',
        error:  message,
        ageSec: Math.round(fallback.ageMs / 1000),
      })
      return NextResponse.json(
        { upsells: fallback.value },
        { headers: { 'Cache-Control': 'no-store', 'X-Data-Stale': '1' } },
      )
    }
    logger.error('cart_upsells_fetch_failed', { error: message })
    return NextResponse.json({ upsells: [] }, { status: 500 })
  }
}
