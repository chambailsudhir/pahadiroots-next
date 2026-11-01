import type { Product } from '@/types'
import { getEffectivePrice, getBaseVariant } from '@/lib/normalizeProduct'

interface CatLike { id: number | string; slug?: string | null }

const inStock = (p: Product) => (getBaseVariant(p)?.available_stock ?? p.available_stock ?? 0) > 0

/**
 * "From ₹X" for a hero slide, taken from the real catalogue: the lowest current price among in-stock products behind the
 * slide's link — /collections/<slug> (that category) or /products/<slug> (that product). Returns null for any other link or
 * when nothing is priced/in stock, so the slide simply shows no price rather than a made-up one.
 */
export function heroFromPrice(link: string | undefined | null, categories: CatLike[], products: Product[]): number | null {
  const m = /^\/(collections|products)\/([^/?#]+)/.exec((link ?? '').trim())
  if (!m) return null
  const [, kind, slug] = m
  let pool: Product[]
  if (kind === 'products') {
    pool = products.filter(p => p.slug === slug)
  } else {
    const cat = categories.find(c => c.slug === slug)
    if (!cat) return null
    pool = products.filter(p => String((p as any).category_id) === String(cat.id))
  }
  const prices = pool.filter(inStock).map(getEffectivePrice).filter(n => Number.isFinite(n) && n > 0)
  return prices.length ? Math.min(...prices) : null
}
