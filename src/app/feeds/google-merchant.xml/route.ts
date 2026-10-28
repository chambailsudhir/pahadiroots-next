import { supabase } from '@/lib/supabase'
import { buildMerchantFeed, type FeedProduct } from '@/lib/merchantFeed'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'

// Hourly refresh, same window as sitemap.xml; Merchant Center fetches on its own schedule.
export const revalidate = 3600

export async function GET() {
  const { data: products, error } = await supabase
    .from('products')
    .select('id, slug, name, short_description, description, image_url, weight_grams, categories(name)')
    .eq('is_deleted', false)
    .eq('status', 'active')
  if (error || !products) return new Response('feed unavailable', { status: 503 })

  const ids = products.map(p => p.id)
  // `barcode` is a private column (anon cannot SELECT it), so it is not requested here;
  // items go out with identifier_exists=no. Requesting it made this whole query fail.
  const { data: variants, error: vErr } = ids.length
    ? await supabase
        .from('product_variants')
        .select('id, product_id, variant_value, price, original_price, compare_at_price, available_stock, sku')
        .in('product_id', ids)
        .eq('is_active', true)
    : { data: [] as never[], error: null }
  // Fail loudly: an empty feed that looks valid would silently delist every product.
  if (vErr) return new Response('feed unavailable', { status: 503 })

  const byProduct = new Map<string, NonNullable<typeof variants>>()
  for (const v of variants || []) {
    const k = String(v.product_id)
    byProduct.set(k, [...(byProduct.get(k) || []), v])
  }

  const feed: FeedProduct[] = products.map(p => {
    const cat = (p as { categories?: { name?: string } | { name?: string }[] | null }).categories
    return {
      id: p.id, slug: p.slug, name: p.name,
      short_description: p.short_description, description: p.description,
      image_url: p.image_url, weight_grams: p.weight_grams,
      categoryName: Array.isArray(cat) ? cat[0]?.name : cat?.name,
      variants: byProduct.get(String(p.id)) || [],
    }
  })

  const body = buildMerchantFeed(feed, {
    baseUrl: BASE,
    brand: 'HimVeda by Pahadi Roots',
    siteName: 'HimVeda by Pahadi Roots',
    siteDescription: 'Natural Himalayan products from Uttarakhand and Himachal',
  })
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  })
}
