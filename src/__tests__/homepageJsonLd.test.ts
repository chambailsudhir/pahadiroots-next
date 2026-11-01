import { describe, it, expect } from 'vitest'
import { buildHomeItemListLd, escapeJsonLd } from '@/lib/homepageJsonLd'

const prod = (id: number, o: Record<string, unknown> = {}) => ({ id, name: `P${id}`, slug: `p${id}`, price: 100, selling_price: 100, mrp: 120, available_stock: 4, image_url: `https://img.test/${id}.jpg`, product_variants: [], ...o }) as any

describe('buildHomeItemListLd', () => {
  it('lists the featured products with real price, availability and url — nothing invented', () => {
    const ld: any = buildHomeItemListLd([prod(1), prod(2, { available_stock: 0 })], 'https://www.pahadiroots.com')
    expect(ld['@type']).toBe('ItemList')
    expect(ld.itemListElement).toHaveLength(2)
    expect(ld.itemListElement[0]).toMatchObject({ position: 1, item: { '@type': 'Product', name: 'P1', url: 'https://www.pahadiroots.com/products/p1', offers: { price: 100, priceCurrency: 'INR', availability: 'https://schema.org/InStock' } } })
    expect(ld.itemListElement[1].item.offers.availability).toBe('https://schema.org/OutOfStock')
    expect(JSON.stringify(ld)).not.toMatch(/aggregateRating|review/i)
  })
  it('skips unpriced products, honours the limit, and returns null when nothing qualifies', () => {
    expect(buildHomeItemListLd([prod(1, { price: null, selling_price: null, mrp: null })], 'https://x')).toBeNull()
    expect((buildHomeItemListLd(Array.from({ length: 9 }, (_, i) => prod(i + 1)), 'https://x', 6) as any).itemListElement).toHaveLength(6)
  })
  it('cannot break out of its <script> tag', () => {
    expect(escapeJsonLd({ n: '</script><b>' })).not.toContain('</script>')
  })
})
