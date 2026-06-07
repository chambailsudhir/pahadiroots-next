import { getServiceClient } from '@/lib/supabase'

export interface StockCheckItem {
  variantId: string   // if variantId === productId → no-variant product (use products table)
  productId?: string  // needed to detect no-variant products
  qty: number
}

export interface StockCheckResult {
  ok: boolean
  failedItems: Array<{ variantId: string; requested: number; available: number }>
}

// ─────────────────────────────────────────────────────────────────────────────
// reserveStockAtomicForOrder
// ─────────────────────────────────────────────────────────────────────────────
// Atomically deducts stock at ORDER CREATION time using a PostgreSQL UPDATE
// with a WHERE available_stock >= qty guard.  If 0 rows are updated, stock
// is insufficient and we throw before the order is committed.
//
// This replaces the old read-only checkStockAvailability pattern which had a
// TOCTOU race: two concurrent requests both read "stock=1", both pass the
// check, both create an order → stock goes to -1.
//
// Handles both variant products (product_variants table) and no-variant
// products (products table, where app-layer variantId === productId).
//
// Caller must roll back / delete the order if a subsequent step fails.
// Stock is restored via restoreStock() on cancellation / payment failure.
export async function reserveStockAtomicForOrder(
  items: StockCheckItem[]
): Promise<{ ok: boolean; failedVariantId?: string }> {
  const db = getServiceClient()

  for (const item of items) {
    const isNoVariant = item.productId && item.variantId === item.productId

    if (isNoVariant) {
      // No-variant product: atomically deduct from products.available_stock
      const { data, error } = await db.rpc('reserve_product_stock_at_order', {
        p_product_id: item.productId!,
        p_qty:        item.qty,
      })
      if (error || !data) {
        return { ok: false, failedVariantId: item.variantId }
      }
    } else {
      // Variant product: atomically deduct from product_variants.available_stock
      const { data, error } = await db.rpc('reserve_stock_at_order', {
        p_variant_id: item.variantId,
        p_qty:        item.qty,
      })
      if (error || !data) {
        return { ok: false, failedVariantId: item.variantId }
      }
    }
  }

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// checkStockAvailability (read-only, non-atomic)
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  DEPRECATED for order-creation use — use reserveStockAtomicForOrder().
// Kept for cart-page pre-checks where you want a fast read without committing
// a reservation (e.g. rendering "Out of stock" badges).
export async function checkStockAvailability(
  items: StockCheckItem[]
): Promise<StockCheckResult> {
  const db = getServiceClient()
  const failedItems: StockCheckResult['failedItems'] = []

  // Split: items with a real variant vs no-variant products (variantId === productId)
  const variantItems = items.filter(i => !i.productId || i.variantId !== i.productId)
  const productItems = items.filter(i =>  i.productId && i.variantId === i.productId)

  // --- Check variant stock ---
  const variantStockMap = new Map<string, { available_stock: number; is_active: boolean }>()
  if (variantItems.length > 0) {
    const ids = variantItems.map(i => isNaN(Number(i.variantId)) ? i.variantId : Number(i.variantId))
    const { data: variants, error } = await db
      .from('product_variants')
      .select('id, available_stock, is_active')
      .in('id', ids)
    if (error) throw new Error('Stock check failed: ' + error.message)
    ;(variants || []).forEach(v => variantStockMap.set(String(v.id), v))
  }

  // --- Check product stock (no-variant products) ---
  const productStockMap = new Map<string, { available_stock: number; is_deleted: boolean; status: string }>()
  if (productItems.length > 0) {
    const ids = productItems.map(i => isNaN(Number(i.productId!)) ? i.productId! : Number(i.productId!))
    const { data: prods, error } = await db
      .from('products')
      .select('id, available_stock, is_deleted, status')
      .in('id', ids)
    if (error) throw new Error('Stock check failed (products): ' + error.message)
    ;(prods || []).forEach(p => productStockMap.set(String(p.id), p))
  }

  for (const item of items) {
    if (item.productId && item.variantId === item.productId) {
      const prod = productStockMap.get(String(item.productId))
      if (!prod || prod.is_deleted || prod.status !== 'active') {
        failedItems.push({ variantId: item.variantId, requested: item.qty, available: 0 })
        continue
      }
      if ((prod.available_stock ?? 999) < item.qty) {
        failedItems.push({ variantId: item.variantId, requested: item.qty, available: prod.available_stock ?? 0 })
      }
    } else {
      const variant = variantStockMap.get(String(item.variantId))
      if (!variant || !variant.is_active) {
        failedItems.push({ variantId: item.variantId, requested: item.qty, available: 0 })
        continue
      }
      if (variant.available_stock < item.qty) {
        failedItems.push({ variantId: item.variantId, requested: item.qty, available: variant.available_stock })
      }
    }
  }

  return { ok: failedItems.length === 0, failedItems }
}

// ─────────────────────────────────────────────────────────────────────────────
// deductStockAtomic — ONLY call after payment confirmed
// ─────────────────────────────────────────────────────────────────────────────
// Uses conditional UPDATE to prevent race conditions (audit #A4).
// Returns false if stock insufficient (someone else bought last unit).
export async function deductStockAtomic(
  items: StockCheckItem[]
): Promise<{ ok: boolean; failedVariantId?: string }> {
  const db = getServiceClient()

  for (const item of items) {
    const { data, error } = await db.rpc('deduct_stock_atomic', {
      p_variant_id: item.variantId,
      p_qty: item.qty,
    })

    if (error || !data) {
      return { ok: false, failedVariantId: item.variantId }
    }
  }

  return { ok: true }
}

// Restore stock on order cancellation/return
export async function restoreStock(
  items: StockCheckItem[]
): Promise<void> {
  const db = getServiceClient()

  for (const item of items) {
    const isNoVariant = item.productId && item.variantId === item.productId
    if (isNoVariant) {
      await db.rpc('restore_product_stock', {
        p_product_id: item.productId!,
        p_qty: item.qty,
      })
    } else {
      await db.rpc('restore_stock', {
        p_variant_id: item.variantId,
        p_qty: item.qty,
      })
    }
  }
}
