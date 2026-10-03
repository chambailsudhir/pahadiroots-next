/**
 * /api/v1/search-catalog — the catalogue the search UIs rank client-side.
 *
 * BUG FIX (Issue 7, Oct 2026 audit): /search and the header SearchOverlay used
 * to query `products` straight from the browser with the anon key. That meant:
 *   - no `product_images` join, so search cards used the legacy
 *     `products.image_url` while Browse/home/collections use product_images[0];
 *   - no `state_id`, so ProductCard added search results to the cart with
 *     isHimalayan:false;
 *   - a silent `.limit(500)` ceiling (already removed from storeData);
 *   - a dependence on anon RLS policies for product_variants/product_images.
 * This route serves the SAME server-side normalized catalogue (service key,
 * paginated fetch, images + variants applied) that /products renders from, so
 * a product looks identical in search and in Browse.
 */

import { NextResponse } from 'next/server'
import { getNormalizedProducts } from '@/lib/storeData'
import { toCardProductData } from '@/lib/normalizeProduct'
import { logger } from '@/lib/logger'

export async function GET() {
  try {
    const all = await getNormalizedProducts()
    // Card-sized payload: drop the long AI/description fields search never shows.
    const products = all.map(toCardProductData)
    return NextResponse.json(
      { products },
      {
        headers: {
          // Same freshness window as the Browse listing (60s ISR).
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      },
    )
  } catch (err) {
    logger.error('[search-catalog] failed to load catalogue', {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Search is temporarily unavailable' }, { status: 503 })
  }
}
