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
 * Consumed by: useCartPage hook
 */

import { NextRequest, NextResponse } from 'next/server'
import type { RawVariant, RawProduct, RawImage } from '@/types/store-data'
import type { UpsellItem } from '@/types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!

async function sbGet<T>(table: string, query = ''): Promise<T> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`
  const res = await fetch(url, {
    headers: {
      apikey:        SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    next: { revalidate: 30 },
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
    // Fetch narrow variant + product columns — not the full 500-product dump
    const [variants, products, images] = await Promise.all([
      sbGet<RawVariant[]>(
        'product_variants',
        'is_active=eq.true&available_stock=gt.0'
        + '&order=available_stock.desc&limit=80'
        + '&select=id,product_id,is_active,available_stock,price,mrp,size,weight',
      ),
      sbGet<RawProduct[]>(
        'products',
        'status=eq.active&is_deleted=eq.false'
        + '&select=id,name,slug,emoji,gst_rate,state_id'
        + ',badges_organic,badges_bestseller,badges_new',
      ),
      sbGet<RawImage[]>(
        'product_images',
        'select=product_id,image_url&order=product_id.asc,sort_order.asc',
      ),
    ])

    // Build lookup maps
    const prodMap = Object.fromEntries(products.map(p => [p.id, p]))
    const imgMap: Record<string, string> = {}
    images.forEach(img => {
      if (!imgMap[img.product_id]) imgMap[img.product_id] = img.image_url
    })

    // Deduplicate by product, skip cart items, take top 6
    const seenProducts = new Set<string>()
    const upsells: UpsellItem[] = variants
      .filter(v =>
        !excludedVariantIds.has(v.id) &&
        !excludedProductIds.has(v.product_id),
      )
      .filter(v => {
        if (seenProducts.has(v.product_id)) return false
        seenProducts.add(v.product_id)
        return true
      })
      .slice(0, 6)
      .map(v => {
        const p = prodMap[v.product_id] ?? {}
        const badge = p.badges_bestseller ? 'Bestseller'
          : p.badges_organic              ? 'Organic'
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
