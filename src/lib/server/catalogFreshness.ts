// ─────────────────────────────────────────────────────────────────────────────
// lib/server/catalogFreshness.ts
//
// Oct 2026: the homepage moved from force-dynamic to ISR (revalidate = 300) to stop
// burning Fluid Active CPU on every hit. The trade-off is that a card can show stale
// stock for up to 5 minutes. Big retailers accept that on LISTING pages (the cart and
// checkout are the authority and re-check stock), but two moments are worth paying one
// regeneration for, because they flip a card between buyable and not:
//   • an order drives a variant to 0 available
//   • a sweep releases stock (a sold-out variant becomes buyable again)
// The cost is one page regeneration per such event — never per visitor — so the CPU
// saving is kept. Everything here is best-effort and never throws: failing to refresh
// a cache must never fail an order.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath, revalidateTag } from 'next/cache'
import { getServiceClient } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/** Expire the catalog caches and the pages that render product cards. */
export function refreshCatalogPages(): void {
  revalidateTag('store-data', { expire: 0 })
  revalidatePath('/', 'page')
  revalidatePath('/products', 'page')
}

/** After an order reserved stock: refresh only if one of the ordered variants is now sold out. */
export async function refreshCatalogIfSoldOut(variantIds: Array<string | number>): Promise<boolean> {
  try {
    const ids = [...new Set(variantIds.map(String).filter(Boolean))]
    if (ids.length === 0) return false
    const { data, error } = await getServiceClient()
      .from('product_variants')
      .select('id, available_stock')
      .in('id', ids)
    if (error || !Array.isArray(data)) return false
    const soldOut = data.some((v: { available_stock: number | null }) => Number(v.available_stock ?? 0) <= 0)
    if (soldOut) refreshCatalogPages()
    return soldOut
  } catch (e) {
    logger.warn('catalogFreshness: refresh skipped', { action: 'catalog.refresh_skipped', error: e instanceof Error ? e.message : String(e) })
    return false
  }
}
