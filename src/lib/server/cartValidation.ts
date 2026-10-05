// ─────────────────────────────────────────────────────────────────────────────
// lib/server/cartValidation.ts
//
// C1 — live truth for cart lines. The cart lives in localStorage with the price and
// name captured when the item was added; nothing refreshed them, so the number the
// customer confirmed (especially for COD, which has no payment modal showing the real
// amount) could differ from what createOrder() charges from the database.
//
// validateCartLines() answers, per line, with the SAME rules createOrder() enforces:
//   • price: variant price (falling back to the product's selling_price) — the helpers
//     below are shared with createOrder so the two can never drift apart
//   • availability: active variant that belongs to the named product, active product
//   • I3: a "no-variant" line is only valid when the product has no ACTIVE variants. Whether
//     a line with variantId === productId is a no-variant line or a REAL variant that happens
//     to share its product's id (live: product 1 / variant 1) is decided from the database,
//     exactly as createOrder() does — see lib/lineKinds.ts
//   • stock: the number the reservation RPC compares against (NULL counts as 0)
// ─────────────────────────────────────────────────────────────────────────────
import 'server-only'
import type { getServiceClient } from '@/lib/supabase'
import {
  variantLinePrice, variantLineMrp, productLinePrice, productLineMrp,
  type VariantRow, type ProductRow,
} from '@/lib/pricing/linePricing'
import { buildOwnerMap, resolveLine } from '@/lib/lineKinds'

// Re-exported so existing importers keep working. The implementations live in
// lib/pricing/linePricing.ts, which is safe to bundle into client code.
export { variantLinePrice, variantLineMrp, productLinePrice, productLineMrp }

type Db = ReturnType<typeof getServiceClient>

export type LineStatus = 'ok' | 'unavailable' | 'out_of_stock' | 'insufficient_stock'

export interface LiveLine {
  productId: string
  variantId: string
  status:    LineStatus
  name:      string
  price:     number            // current ₹ per unit (0 when unavailable)
  mrp:       number
  available: number            // units that can be ordered right now
}

const asDbId = (id: string): string | number => (Number.isNaN(Number(id)) ? id : Number(id))

export async function validateCartLines(
  db: Db,
  items: Array<{ productId: string; variantId: string; qty: number }>,
): Promise<LiveLine[]> {
  // 1. every variant id the cart names. Lines with variantId === productId are included on
  //    purpose: only the database can say whether that is a real variant or a bare product.
  const variantMap = new Map<string, VariantRow>()
  if (items.length > 0) {
    const { data, error } = await db
      .from('product_variants')
      .select('id, product_id, price, original_price, is_active, available_stock')
      .in('id', Array.from(new Set(items.map(i => i.variantId))).map(asDbId))
    if (error) throw new Error('cart validation: variants lookup failed: ' + error.message)
    for (const v of (data ?? []) as VariantRow[]) variantMap.set(String(v.id), v)
  }

  const ownerByVariantId = buildOwnerMap(Array.from(variantMap.values()))
  const resolutions = items.map(i => resolveLine(i, ownerByVariantId))
  const noVariantLines = items.filter((_, idx) => resolutions[idx].kind === 'product')
  const variantLines   = items.filter((_, idx) => resolutions[idx].kind !== 'product')

  // 2. I3: which no-variant products actually have ACTIVE variants
  const productsWithVariants = new Set<string>()
  if (noVariantLines.length > 0) {
    const { data, error } = await db
      .from('product_variants')
      .select('id, product_id')
      .in('product_id', noVariantLines.map(i => asDbId(i.productId)))
      .eq('is_active', true)
    if (error) throw new Error('cart validation: variant presence lookup failed: ' + error.message)
    for (const v of (data ?? []) as VariantRow[]) productsWithVariants.add(String(v.product_id))
  }

  // 3. products behind every line (named by the client OR by the variant row)
  const productIds = Array.from(new Set([
    ...noVariantLines.map(i => i.productId),
    ...variantLines.map(i => String(variantMap.get(i.variantId)?.product_id ?? i.productId)),
  ]))
  const productMap = new Map<string, ProductRow>()
  if (productIds.length > 0) {
    const { data, error } = await db
      .from('products')
      .select('id, name, is_deleted, status, selling_price, price, mrp, available_stock')
      .in('id', productIds.map(asDbId))
    if (error) throw new Error('cart validation: products lookup failed: ' + error.message)
    for (const p of (data ?? []) as ProductRow[]) productMap.set(String(p.id), p)
  }

  const productLive = (p: ProductRow | undefined) => !!p && !p.is_deleted && p.status === 'active'
  const stock = (n: unknown) => Math.max(0, Number(n) || 0)   // NULL counts as 0: the reserve RPC's `>= qty` is false for NULL

  return items.map((i, idx): LiveLine => {
    const gone = (name = ''): LiveLine =>
      ({ productId: i.productId, variantId: i.variantId, status: 'unavailable', name, price: 0, mrp: 0, available: 0 })

    let name: string, price: number, mrp: number, available: number

    // A stale line whose variant slot holds a DIFFERENT product's variant id is unavailable —
    // the same rule createOrder() applies.
    if (resolutions[idx].kind === 'foreign_variant') return gone(String(productMap.get(i.productId)?.name ?? ''))

    if (resolutions[idx].kind === 'product') {
      const p = productMap.get(i.productId)
      if (!productLive(p) || productsWithVariants.has(i.productId)) return gone(String(p?.name ?? ''))
      name = String(p!.name ?? ''); price = productLinePrice(p); mrp = productLineMrp(p); available = stock(p!.available_stock)
    } else {
      const v = variantMap.get(i.variantId)
      const p = productMap.get(String(v?.product_id ?? i.productId))
      if (!v || !v.is_active || String(v.product_id) !== i.productId || !productLive(p)) return gone(String(p?.name ?? ''))
      name = String(p!.name ?? ''); price = variantLinePrice(v, p); mrp = variantLineMrp(v, p); available = stock(v.available_stock)
    }

    const status: LineStatus =
      available <= 0        ? 'out_of_stock'
      : available < i.qty   ? 'insufficient_stock'
      : 'ok'
    return { productId: i.productId, variantId: i.variantId, status, name, price, mrp, available }
  })
}
