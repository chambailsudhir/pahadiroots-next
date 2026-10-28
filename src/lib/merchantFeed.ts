// Google Merchant Center product feed (RSS 2.0 + g: namespace).
// Pure builder so it can be unit-tested; the route handler only fetches rows.

export interface FeedVariant {
  id: string | number
  variant_value?: string | null
  price: number
  original_price?: number | null
  compare_at_price?: number | null
  available_stock?: number | null
  sku?: string | null
  barcode?: string | null
}

export interface FeedProduct {
  id: string | number
  slug: string
  name: string
  short_description?: string | null
  description?: string | null
  image_url?: string | null
  weight_grams?: number | null
  categoryName?: string | null
  variants: FeedVariant[]
}

export interface FeedOptions {
  baseUrl: string
  brand: string
  siteName: string
  siteDescription: string
}

const xml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const stripHtml = (v: string) => v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const money = (n: number) => `${n.toFixed(2)} INR`
// GTIN-8/12/13/14 only; anything else is not a valid identifier for Google.
const validGtin = (v?: string | null) => (v && /^\d{8}$|^\d{12,14}$/.test(v.trim()) ? v.trim() : null)

export function buildMerchantFeed(products: FeedProduct[], o: FeedOptions): string {
  const items: string[] = []
  for (const p of products) {
    if (!p.image_url || !/^https?:\/\//.test(p.image_url)) continue // Google rejects items without an image
    const desc = stripHtml(String(p.short_description || p.description || p.name)).slice(0, 4900)
    for (const v of p.variants) {
      if (!(v.price > 0)) continue
      const mrp = Math.max(Number(v.compare_at_price) || 0, Number(v.original_price) || 0)
      const onSale = mrp > v.price
      const gtin = validGtin(v.barcode)
      const size = v.variant_value ? ` - ${v.variant_value}` : ''
      const id = v.sku || `${p.id}-${v.id}`
      const lines = [
        `<g:id>${xml(String(id))}</g:id>`,
        `<g:item_group_id>${xml(String(p.id))}</g:item_group_id>`,
        `<title>${xml((p.name + size).slice(0, 150))}</title>`,
        `<description>${xml(desc)}</description>`,
        `<link>${xml(`${o.baseUrl}/products/${p.slug}`)}</link>`,
        `<g:image_link>${xml(p.image_url)}</g:image_link>`,
        `<g:availability>${Number(v.available_stock ?? 0) > 0 ? 'in_stock' : 'out_of_stock'}</g:availability>`,
        `<g:price>${money(onSale ? mrp : v.price)}</g:price>`,
        ...(onSale ? [`<g:sale_price>${money(v.price)}</g:sale_price>`] : []),
        `<g:condition>new</g:condition>`,
        `<g:brand>${xml(o.brand)}</g:brand>`,
        ...(gtin ? [`<g:gtin>${gtin}</g:gtin>`] : ['<g:identifier_exists>no</g:identifier_exists>']),
        `<g:google_product_category>Food, Beverages &amp; Tobacco &gt; Food Items</g:google_product_category>`,
        ...(p.categoryName ? [`<g:product_type>${xml(p.categoryName)}</g:product_type>`] : []),
        ...(p.weight_grams ? [`<g:shipping_weight>${Number(p.weight_grams)} g</g:shipping_weight>`] : []),
      ]
      items.push(`<item>${lines.join('')}</item>`)
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>` +
    `<title>${xml(o.siteName)}</title><link>${xml(o.baseUrl)}</link><description>${xml(o.siteDescription)}</description>` +
    `${items.join('')}</channel></rss>`
}
