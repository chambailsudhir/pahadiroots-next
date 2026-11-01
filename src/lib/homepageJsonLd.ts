import type { Product } from '@/types'
import { getBaseVariant, getEffectivePrice } from '@/lib/normalizeProduct'

/** JSON.stringify that cannot break out of a <script> tag. */
export const escapeJsonLd = (obj: unknown) => JSON.stringify(obj).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '')

/**
 * ItemList of the products the homepage actually shows, so search engines can connect the page to its featured products
 * (carousel / rich-result eligibility). Only real, priced, in-stock-or-not data is emitted — nothing invented: no ratings,
 * no review counts (the store has none yet).
 */
export function buildHomeItemListLd(products: Product[], siteUrl: string, limit = 6) {
  const items = products
    .filter(p => p.slug && p.name && getEffectivePrice(p) > 0)
    .slice(0, limit)
    .map((p, i) => {
      const price = getEffectivePrice(p)
      const stock = getBaseVariant(p)?.available_stock ?? p.available_stock ?? 0
      return {
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: p.name,
          url: `${siteUrl}/products/${p.slug}`,
          ...(p.image_url ? { image: p.image_url } : {}),
          offers: {
            '@type': 'Offer',
            priceCurrency: 'INR',
            price: Number(price.toFixed(2)),
            availability: stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            url: `${siteUrl}/products/${p.slug}`,
          },
        },
      }
    })
  if (!items.length) return null
  return { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Featured Himalayan products', itemListElement: items }
}
