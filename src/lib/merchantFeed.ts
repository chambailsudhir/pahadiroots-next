// Google Merchant Center product feed (RSS 2.0 + g: namespace).
// Pure builder so it can be unit-tested; the route handler only fetches rows.
import { variantDisplayMrp } from '@/lib/pricing/linePricing'

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
  // products.mrp / selling_price feed variantDisplayMrp() — the same strike-through rule the site uses.
  mrp?: number | null
  selling_price?: number | null
  price?: number | null
  variants: FeedVariant[]
}

export interface FeedOptions {
  baseUrl: string
  brand: string
  siteName: string
  siteDescription: string
  /** Store closed (site_settings.store_open off): nothing can be bought, so every item goes out as out_of_stock. */
  storeClosed?: boolean
}

// XML 1.0 forbids most control characters: ONE stray \x0B / \x00 (pasted from Word, a PDF ...) makes the whole feed unparseable and
// Merchant Center rejects every item. Strip them before escaping.
//
// Nov 2026 verification: U+FFFE / U+FFFF and lone UTF-16 surrogates are not XML characters either, and the 150-char title
// cut could split an emoji's surrogate pair, leaving a lone half AFTER the old strip ran. clean() now removes all of them
// and runs again after every slice.
const ILLEGAL_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
export const cleanXmlText = (v: string) => v.replace(ILLEGAL_XML, '')
const cut = (v: string, n: number) => cleanXmlText(cleanXmlText(v).slice(0, n))
const xml = (v: string) =>
  cleanXmlText(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const stripHtml = (v: string) => v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const money = (n: number) => `${n.toFixed(2)} INR`
// GTIN-8/12/13/14 only; anything else is not a valid identifier for Google.
const validGtin = (v?: string | null) => (v && /^\d{8}$|^\d{12,14}$/.test(v.trim()) ? v.trim() : null)

export function buildMerchantFeed(products: FeedProduct[], o: FeedOptions): string {
  const items: string[] = []
  for (const p of products) {
    if (!p.image_url || !/^https?:\/\//.test(p.image_url)) continue // Google rejects items without an image
    const desc = cut(stripHtml(String(p.short_description || p.description || p.name)), 4900)
    for (const v of p.variants) {
      if (!(v.price > 0)) continue
      // Nov 2026 verification: was max(compare_at_price, original_price), while the site strikes through
      // variantDisplayMrp() (compare_at_price, else products.mrp for the headline variant) — the feed and the PDP disagreed
      // on whether (and from what) an item is on sale. Same helper now.
      const mrp = variantDisplayMrp(
        { id: v.id, product_id: p.id, price: v.price, compare_at_price: v.compare_at_price, original_price: v.original_price },
        { id: p.id, mrp: p.mrp, selling_price: p.selling_price, price: p.price },
      )
      const onSale = mrp > v.price
      const gtin = validGtin(v.barcode)
      const size = v.variant_value ? ` - ${v.variant_value}` : ''
      const id = v.sku || `${p.id}-${v.id}`
      const lines = [
        `<g:id>${xml(String(id))}</g:id>`,
        `<g:item_group_id>${xml(String(p.id))}</g:item_group_id>`,
        `<title>${xml(cut(p.name + size, 150))}</title>`,
        `<description>${xml(desc)}</description>`,
        `<link>${xml(`${o.baseUrl}/products/${p.slug}`)}</link>`,
        `<g:image_link>${xml(p.image_url)}</g:image_link>`,
        `<g:availability>${!o.storeClosed && Number(v.available_stock ?? 0) > 0 ? 'in_stock' : 'out_of_stock'}</g:availability>`,
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
