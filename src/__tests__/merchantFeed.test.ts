import { describe, it, expect } from 'vitest'
import { buildMerchantFeed } from '@/lib/merchantFeed'

const o = { baseUrl: 'https://www.pahadiroots.com', brand: 'HimVeda', siteName: 'HimVeda', siteDescription: 'x' }
const base = { id: 1, slug: 'mustard-oil', name: 'Mustard & Oil', image_url: 'https://cdn.example/a.jpg', short_description: '<b>Cold</b> pressed' }

describe('buildMerchantFeed', () => {
  it('emits one item per variant with escaped text, absolute links and INR prices', () => {
    const x = buildMerchantFeed([{ ...base, variants: [
      { id: 10, variant_value: '500ml', price: 299, available_stock: 5, sku: 'MO-500' },
      { id: 11, variant_value: '1L', price: 549, available_stock: 0 },
    ] }], o)
    expect(x.match(/<item>/g)).toHaveLength(2)
    expect(x).toContain('<title>Mustard &amp; Oil - 500ml</title>')
    expect(x).toContain('<description>Cold pressed</description>')
    expect(x).toContain('<link>https://www.pahadiroots.com/products/mustard-oil</link>')
    expect(x).toContain('<g:id>MO-500</g:id>')
    expect(x).toContain('<g:id>1-11</g:id>')
    expect(x).toContain('<g:price>299.00 INR</g:price>')
    expect(x).toContain('<g:availability>out_of_stock</g:availability>')
  })
  it('lists MRP as price and the selling price as sale_price when discounted', () => {
    const x = buildMerchantFeed([{ ...base, variants: [{ id: 1, price: 250, compare_at_price: 300, available_stock: 1 }] }], o)
    expect(x).toContain('<g:price>300.00 INR</g:price>')
    expect(x).toContain('<g:sale_price>250.00 INR</g:sale_price>')
  })
  it('strips XML-illegal control characters so one pasted \\x0B cannot make the whole feed unparseable', () => {
    const x = buildMerchantFeed([{ ...base, name: 'Honey\u000B\u0000 Jar', short_description: 'ok\u000Cdesc', variants: [{ id: 1, price: 10, available_stock: 1 }] }], o)
    expect(/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(x)).toBe(false)
    expect(x).toContain('Honey Jar')
  })
  it('only sends valid GTINs, otherwise identifier_exists=no', () => {
    const ok = buildMerchantFeed([{ ...base, variants: [{ id: 1, price: 10, barcode: '8901234567890' }] }], o)
    const bad = buildMerchantFeed([{ ...base, variants: [{ id: 1, price: 10, barcode: 'ABC-12' }] }], o)
    expect(ok).toContain('<g:gtin>8901234567890</g:gtin>')
    expect(bad).toContain('<g:identifier_exists>no</g:identifier_exists>')
    expect(bad).not.toContain('<g:gtin>')
  })
  it('skips products without an image and variants without a price', () => {
    const x = buildMerchantFeed([
      { ...base, image_url: null, variants: [{ id: 1, price: 10 }] },
      { ...base, id: 2, variants: [{ id: 2, price: 0 }] },
    ], o)
    expect(x).not.toContain('<item>')
  })

  // Nov 2026 verification
  it('strips U+FFFE/U+FFFF and lone surrogates, including one left by the 150-char title cut', () => {
    const name = 'a'.repeat(149) + '\u{1F36F}'   // honey-pot emoji: a surrogate pair straddling char 150
    const x = buildMerchantFeed([{ ...base, name, short_description: 'bad￾￿\uD800x\uDC00y', variants: [{ id: 1, price: 10, available_stock: 1 }] }], o)
    expect(/[￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(x)).toBe(false)
    expect(x).toContain(`<title>${'a'.repeat(149)}</title>`)
    expect(x).toContain('<description>badxy</description>')
  })
  it('uses the site MRP rule (variantDisplayMrp): products.mrp strikes through the headline variant, original_price does not', () => {
    const headline = buildMerchantFeed([{ ...base, mrp: 400, selling_price: 250, variants: [{ id: 1, price: 250, available_stock: 1 }] }], o)
    expect(headline).toContain('<g:price>400.00 INR</g:price>')
    expect(headline).toContain('<g:sale_price>250.00 INR</g:sale_price>')
    // original_price alone is not shown struck-through on the site, so it must not invent a sale in the feed either
    const legacy = buildMerchantFeed([{ ...base, variants: [{ id: 1, price: 250, original_price: 999, available_stock: 1 }] }], o)
    expect(legacy).toContain('<g:price>250.00 INR</g:price>')
    expect(legacy).not.toContain('<g:sale_price>')
  })
  it('marks every item out_of_stock while the store is closed', () => {
    const x = buildMerchantFeed([{ ...base, variants: [{ id: 1, price: 10, available_stock: 50 }] }], { ...o, storeClosed: true })
    expect(x).toContain('<g:availability>out_of_stock</g:availability>')
    expect(x).not.toContain('in_stock')
  })
})

