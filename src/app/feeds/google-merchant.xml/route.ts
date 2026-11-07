import { supabase } from '@/lib/supabase'
import { buildMerchantFeed, type FeedProduct } from '@/lib/merchantFeed'
import { isStoreOpen } from '@/lib/siteSettingsHelpers'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'

// Hourly refresh, same window as sitemap.xml; Merchant Center fetches on its own schedule.
export const revalidate = 3600

// Nov 2026 verification: both queries were plain selects, so Supabase's 1,000-row cap silently truncated the feed (products,
// and — far sooner — variants) once the catalogue grew. Page through like sitemap.ts does. Variant reads are also chunked by
// product id so the `in.(...)` filter never builds an over-long URL.
const PAGE = 1000
const ID_CHUNK = 200
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error?: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

interface ProductRow {
  id: number | string; slug: string; name: string; short_description: string | null; description: string | null
  image_url: string | null; weight_grams: number | null; is_active?: boolean | null
  mrp?: number | null; selling_price?: number | null; price?: number | null
  categories?: { name?: string } | { name?: string }[] | null
}
interface VariantRow {
  id: number | string; product_id: number | string; variant_value: string | null; price: number
  original_price: number | null; compare_at_price: number | null; available_stock: number | null; sku: string | null
}

// Nov 2026 verification: the .xml extension exempts this route from the proxy's store-closed gate, so with the store closed
// Merchant Center kept advertising every item as in_stock. Read the same flag; on a read failure stay fail-open like the proxy.
async function storeClosed(): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('site_settings').select('value').eq('key', 'store_open')
    if (error || !Array.isArray(data) || !data.length) return false
    return !isStoreOpen({ store_open: (data[0] as { value?: string }).value })
  } catch { return false }
}

export async function GET() {
  let productsRaw: ProductRow[]
  try {
    productsRaw = await fetchAll<ProductRow>((from, to) => supabase
      .from('products')
      .select('id, slug, name, short_description, description, image_url, weight_grams, is_active, mrp, selling_price, price, categories(name)')
      .eq('is_deleted', false)
      .eq('status', 'active')
      .order('id')
      .range(from, to) as unknown as PromiseLike<{ data: ProductRow[] | null; error?: unknown }>)
  } catch {
    return new Response('feed unavailable', { status: 503 })
  }
  // SEC-001: a product the owner deactivated (products.is_active=false) must not stay in the merchant feed.
  const products = productsRaw.filter(p => p.is_active !== false)
  // A valid-looking EMPTY feed would delist every product in Merchant Center. If the query returned no rows
  // (RLS / filter / outage) fail loudly so the previously cached feed keeps being served.
  if (products.length === 0) return new Response('feed unavailable: no active products returned', { status: 503 })

  const ids = products.map(p => p.id)
  // `barcode` is a private column (anon cannot SELECT it), so it is not requested here;
  // items go out with identifier_exists=no. Requesting it made this whole query fail.
  const variants: VariantRow[] = []
  try {
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK)
      variants.push(...await fetchAll<VariantRow>((from, to) => supabase
        .from('product_variants')
        .select('id, product_id, variant_value, price, original_price, compare_at_price, available_stock, sku')
        .in('product_id', chunk)
        .eq('is_active', true)
        .order('id')
        .range(from, to) as unknown as PromiseLike<{ data: VariantRow[] | null; error?: unknown }>))
    }
  } catch {
    // Fail loudly: an empty feed that looks valid would silently delist every product.
    return new Response('feed unavailable', { status: 503 })
  }

  const byProduct = new Map<string, VariantRow[]>()
  for (const v of variants) {
    const k = String(v.product_id)
    byProduct.set(k, [...(byProduct.get(k) || []), v])
  }

  const feed: FeedProduct[] = products.map(p => {
    const cat = p.categories
    return {
      id: p.id, slug: p.slug, name: p.name,
      short_description: p.short_description, description: p.description,
      image_url: p.image_url, weight_grams: p.weight_grams,
      mrp: p.mrp, selling_price: p.selling_price, price: p.price,
      categoryName: Array.isArray(cat) ? cat[0]?.name : cat?.name,
      variants: byProduct.get(String(p.id)) || [],
    }
  })

  const closed = await storeClosed()
  const body = buildMerchantFeed(feed, {
    baseUrl: BASE,
    brand: 'HimVeda by Pahadi Roots',
    siteName: 'HimVeda by Pahadi Roots',
    siteDescription: 'Natural Himalayan products from Uttarakhand and Himachal',
    storeClosed: closed,
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // While closed keep the edge copy short so reopening reaches Merchant Center quickly.
      'Cache-Control': closed ? 'public, s-maxage=300' : 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
