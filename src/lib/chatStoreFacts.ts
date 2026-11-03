// Live store facts for the Pahadi_AI assistant: the products that are really for sale, their sizes, prices and stock, and the shipping rule.
//
// The prompt used to carry a hard-coded list of 14 products (saffron, shilajit, tea, mustard oil…) although the shop sells only a handful, and it
// forbade quoting any price — so the assistant advertised things that cannot be bought and could not answer "how much is the honey?".
// Everything here is read from the same cached store data the storefront renders (60 s), and every value is sanitised before it enters a prompt.
import 'server-only'
import { getStoreData, attachVariants } from '@/lib/storeData'
import type { ProductVariant } from '@/types'

const clean = (v: unknown, max = 80): string => String(v ?? '').replace(/[\r\n\t`$<>{}\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')

/** Plain-text block for the system prompt, or '' when the catalogue cannot be read (the assistant then falls back to generic answers). */
export async function buildLiveStoreFacts(): Promise<string> {
  try {
    const data = await getStoreData()
    const settings = data.settings ?? {}
    const products = attachVariants(data.products.filter(p => p.is_active && !p.is_deleted), data.product_variants)
    const lines: string[] = []
    for (const p of products.slice(0, 40)) {
      const vs = ((p as unknown as { product_variants?: ProductVariant[] }).product_variants ?? []).filter(v => v.is_active)
      const sizes = vs.length
        ? vs.map(v => `${clean(v.size || v.variant_value, 20)} ${inr(v.price)}${v.mrp && v.mrp > v.price ? ` (MRP ${inr(v.mrp)})` : ''}${v.available_stock > 0 ? '' : ' — out of stock'}`).join('; ')
        : (p.selling_price ?? p.selling ?? p.price) ? inr(Number(p.selling_price ?? p.selling ?? p.price)) : 'see product page'
      lines.push(`- ${clean(p.name)} (/products/${clean(p.slug, 80)}): ${sizes}`)
    }
    if (lines.length === 0) return ''

    const freeMin = Number(settings.free_shipping_min)
    const flat = Number(settings.flat_shipping_charge)
    let shipping = 'Shipping charges are shown in the cart.'
    if (Number.isFinite(freeMin) && freeMin <= 0) shipping = 'Shipping is FREE on every order right now.'
    else if (Number.isFinite(freeMin) && Number.isFinite(flat)) shipping = `Shipping is ${inr(flat)}, free on orders of ${inr(freeMin)} or more.`
    return [
      'LIVE STORE FACTS (read from the shop just now — the ONLY source for what is for sale, sizes, prices and shipping):',
      ...lines,
      `${shipping} All prices include GST.`,
      'Only these products are for sale. If someone asks about a product that is not listed, say it is not available right now and suggest something from this list. Quote prices and sizes only from this list; if a size or price is not here, point to the product page.',
    ].join('\n')
  } catch {
    return ''
  }
}
