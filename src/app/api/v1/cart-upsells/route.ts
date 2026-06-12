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

import { NextRequest, NextResponse } from 'next/server'
import type { RawVariant, RawProduct, RawImage } from '@/types/store-data'
import type { UpsellItem } from '@/types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
// Use anon key for this read-only GET endpoint — service key is reserved for
// mutations. Ensure product_variants, products, product_images RLS allow anon SELECT.
const SUPABASE_KEY  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function sbGet<T>(table: string, query = '', timeoutMs?: number): Promise<T> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`
  const res = await fetch(url, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    next: { revalidate: 30 },
    // Per-request timeout so a slow DB response doesn't block the cart page.
    // AbortSignal.timeout is available in Node 18+ and modern browsers.
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  })
  if (!res.ok) throw new Error(`${table}: ${res.status}`)
  return res.json() as Promise<T>
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  const excludedVariantIds = new Set(
    (searchParams.get('variantIds') ?? '').split(',').filter(Boolean),
  )
  const excludedProductIds = new Set(
    (searchParams.get('productIds') ?? '').split(',').filter(Boolean),
  )

  try {
    // ── Step 1: fetch top-80 in-stock variants ─────────────────────────────
    // This is the cheapest fetch and gives us the candidate product IDs we need
    // to filter the more expensive product + image queries.
    // BUG FIX: the first sbGet call had no timeout — a slow Supabase response
    // would hang this serverless function until Vercel's hard 15-second limit.
    // Added 5 s timeout to match the parallel product+image fetches below.
    const variants = await sbGet<RawVariant[]>(
      'product_variants',
      'is_active=eq.true&available_stock=gt.0'
      + '&order=available_stock.desc&limit=80'
      + '&select=id,product_id,is_active,available_stock,price,mrp,size,weight',
      5000,
    )

    // Determine candidate product IDs (non-cart, deduped) — capped at 20 so the
    // IN filter stays compact while still giving enough candidates for 6 upsells.
    const candidateProductIds = [
      ...new Set(
        variants
          .filter(v => !excludedVariantIds.has(v.id) && !excludedProductIds.has(v.product_id))
          .map(v => v.product_id),
      ),
    ].slice(0, 20)

    if (candidateProductIds.length === 0) {
      return NextResponse.json(
        { upsells: [] },
        { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' } },
      )
    }

    // ── Step 2: fetch products + images filtered to candidate IDs only ─────
    // Previously: fetched ALL products and ALL images (unbounded).
    // Now: each query is bounded to at most 20 product IDs — dramatically
    // smaller payloads regardless of catalog size.
    // Each parallel fetch gets its own 5 s timeout so a slow DB response
    // doesn't block the cart page indefinitely. AbortSignal.timeout is
    // supported in Node 18+ and all modern browsers.
    const idFilter = candidateProductIds.join(',')
    const [products, images] = await Promise.all([
      sbGet<RawProduct[]>(
        'products',
        `id=in.(${idFilter})&status=eq.active&is_deleted=eq.false`
        + '&select=id,name,slug,emoji,gst_rate,state_id'
        + ',badges_organic,badges_bestseller,badges_new',
        5000,
      ),
      sbGet<RawImage[]>(
        'product_images',
        `product_id=in.(${idFilter})&select=product_id,image_url&order=product_id.asc,sort_order.asc`,
        5000,
      ),
    ])

    // Build lookup maps
    const prodMap = Object.fromEntries(products.map(p => [p.id, p]))
    const imgMap: Record<string, string> = {}
    images.forEach(img => {
      if (!imgMap[img.product_id]) imgMap[img.product_id] = img.image_url
    })

    // Deduplicate by product, skip cart items, take top 6.
    // Bug-fix: also skip variants whose product_id is absent from prodMap.
    // The variant query only checks is_active=true on the variant itself; a
    // product can be soft-deleted (is_deleted=true) or deactivated (status≠active)
    // while its variants remain active in the DB. The products query already
    // filters those out with status=eq.active&is_deleted=eq.false, so any
    // variant whose product_id isn't in prodMap belongs to a deleted/inactive
    // product and must be excluded — otherwise it renders as a ghost card with
    // name="Product" and an empty slug, producing a broken link.
    const seenProducts = new Set<string>()
    const upsells: UpsellItem[] = variants
      .filter(v =>
        !excludedVariantIds.has(v.id) &&
        !excludedProductIds.has(v.product_id) &&
        // Only include variants whose product passed the active+non-deleted filter
        v.product_id in prodMap,
      )
      .filter(v => {
        if (seenProducts.has(v.product_id)) return false
        seenProducts.add(v.product_id)
        return true
      })
      .slice(0, 6)
      .map(v => {
        const p = prodMap[v.product_id]  // guaranteed to exist after the filter above
        const badge = p.badges_bestseller ? 'Bestseller'
          : p.badges_organic              ? 'Natural'
          : p.badges_new                  ? 'New Arrival'
          : null
        return {
          id:          v.id,
          productId:   v.product_id,
          name:        p.name    ?? 'Product',
          slug:        p.slug    ?? '',
          size:        v.size ?? v.weight ?? '',
          price:       v.price,
          mrp:         v.mrp ?? v.price,
          emoji:       p.emoji   ?? null,
          image:       imgMap[v.product_id] ?? null,
          gstRate:     p.gst_rate    ?? 5,
          maxQty:      v.available_stock ?? 10,
          badge,
          isOrganic:    !!p.badges_organic,
          isHimalayan:  !!p.state_id,
          isBestseller: !!p.badges_bestseller,
        }
      })

    return NextResponse.json(
      { upsells },
      { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' } },
    )
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('[cart-upsells]', message)
    return NextResponse.json({ upsells: [] }, { status: 500 })
  }
}
