import { getServiceClient } from '@/lib/supabase'
import { captureError } from '@/lib/logger'

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
// BUG FIX (partial-reservation leak): the previous implementation returned
// { ok: false } immediately when any item in the loop failed, leaving items
// 1..N-1 permanently decremented without an order.  Because createOrder()
// throws *before* its try/finally block on stockReservation.ok === false,
// the finally clause (restoreStock) was never reached for these items.
//
// Fix: we now track each successfully reserved item and roll them back inside
// this function before returning failure, so the caller never needs to clean
// up a partial reservation.
// ─────────────────────────────────────────────────────────────────────────────
// StockReservationError
// ─────────────────────────────────────────────────────────────────────────────
// Thrown for genuine INFRASTRUCTURE failures (bad SQL types, connection drop,
// permission error, etc). These are 5xx-class problems and must NEVER be
// presented to the customer as "insufficient stock" — that message is reserved
// exclusively for the case where the DB explicitly told us available_stock < qty.
//
// Postgres error code reference: https://www.postgresql.org/docs/current/errcodes-appendix.html
//   22P02 = invalid_text_representation   (e.g. passing "13" where UUID expected)
//   42883 = undefined_function            (RPC signature mismatch)
//   42P01 = undefined_table
//   28000 = invalid_authorization_specification
//   53300 = too_many_connections
const INFRA_ERROR_CODES = new Set(['22P02', '42883', '42P01', '28000', '53300'])

export class StockReservationError extends Error {
  constructor(public readonly cause: unknown, public readonly itemId: string) {
    super(`Stock reservation infra failure for item ${itemId}`)
    this.name = 'StockReservationError'
  }
}

export async function reserveStockAtomicForOrder(
  items: StockCheckItem[]
): Promise<{ ok: boolean; failedVariantId?: string }> {
  const db = getServiceClient()

  // Track items whose stock has been successfully decremented so we can
  // restore them if a later item in the loop fails.
  const reserved: StockCheckItem[] = []

  for (const item of items) {
    const isNoVariant = item.productId && item.variantId === item.productId
    const rpcName = isNoVariant ? 'reserve_product_stock_at_order' : 'reserve_stock_at_order'
    const params = isNoVariant
      ? { p_product_id: item.productId!, p_qty: item.qty }
      : { p_variant_id: item.variantId, p_qty: item.qty }

    const { data, error } = await db.rpc(rpcName, params)

    if (error) {
      // The database itself errored — this is NOT "out of stock", it's a bug
      // (wrong param type, missing function, RLS/permission issue, etc).
      // Roll back whatever we already reserved, alert loudly, and let the
      // caller surface a 500 — never a stock message — for this case.
      await _restoreReserved(reserved)
      captureError(error, {
        action:  'inventoryService.reserveStockAtomicForOrder',
        rpc:     rpcName,
        item_id: item.variantId,
        pg_code: (error as { code?: string }).code,
        alert:   true,
      })
      throw new StockReservationError(error, item.variantId)
    }

    if (!data) {
      // No error — the RPC's WHERE available_stock >= qty guard genuinely
      // didn't match. This IS a real "insufficient stock" case.
      await _restoreReserved(reserved)
      return { ok: false, failedVariantId: item.variantId }
    }

    // Mark this item as successfully reserved — must happen AFTER the RPC
    // succeeds so we never try to restore an item that was never decremented.
    reserved.push(item)
  }

  return { ok: true }
}

// Internal helper — restores a partial list of already-reserved items.
// Errors are swallowed individually so one failure does not block others;
// all restore errors are logged so ops can fix manually if needed.
async function _restoreReserved(items: StockCheckItem[]): Promise<void> {
  if (items.length === 0) return
  const db = getServiceClient()
  for (const item of items) {
    const isNoVariant = item.productId && item.variantId === item.productId
    if (isNoVariant) {
      // BUILD FIX: the Supabase RPC call returns a `PostgrestFilterBuilder`
      // typed for the "restore_product_stock" RPC. It's PromiseLike (has
      // `.then`) so `await` works, but its TS type does NOT extend `Promise`
      // and has no `.catch` method — chaining `.catch(...)` directly on the
      // builder fails type-checking ("Property 'catch' does not exist...").
      // Fix: await inside try/catch, same error-swallowing behavior as before.
      try {
        await db.rpc('restore_product_stock', {
          p_product_id: item.productId!,
          p_qty:        item.qty,
        })
      } catch (err: unknown) {
        // BUG FIX 22b: captureError with alert:true — stock locked permanently.
        captureError(err, {
          action:     'inventoryService._restoreReserved.product',
          product_id: item.productId,
          qty:        item.qty,
          alert:      true,
        })
      }
    } else {
      try {
        await db.rpc('restore_stock', {
          p_variant_id: item.variantId,
          p_qty:        item.qty,
        })
      } catch (err: unknown) {
        // BUG FIX 22a: use captureError with alert:true — a failed stock restore
        // after a partial reservation means inventory is permanently locked (stock
        // decremented but never restored). Ops must correct manually via the DB.
        captureError(err, {
          action:     'inventoryService._restoreReserved.variant',
          variant_id: item.variantId,
          qty:        item.qty,
          alert:      true,
        })
      }
    }
  }
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

// Restore stock on order cancellation/return or payment failure.
//
// BUG FIX [ERROR HANDLING]: the previous implementation called db.rpc()
// with no error check and no try/catch. If any single item's restore RPC
// failed (transient DB error, variant deleted since order time, connection
// reset), the function threw immediately, leaving every SUBSEQUENT item in
// the list permanently unreserved — a silent stock leak. Unlike the
// internal _restoreReserved helper (which already had per-item try/catch),
// this public function had no protection at all.
//
// Fix: per-item try/catch that logs and continues, mirroring _restoreReserved.
// All restore errors are logged for ops; a single RPC failure no longer
// prevents the remaining items from being restored.
export async function restoreStock(
  items: StockCheckItem[]
): Promise<void> {
  const db = getServiceClient()

  for (const item of items) {
    const isNoVariant = item.productId && item.variantId === item.productId
    if (isNoVariant) {
      try {
        await db.rpc('restore_product_stock', {
          p_product_id: item.productId!,
          p_qty: item.qty,
        })
      } catch (err) {
        // BUG FIX 22c: captureError with alert:true — stock restore failure on
        // cancellation/payment-failure means inventory stays permanently locked.
        captureError(err, {
          action:     'inventoryService.restoreStock.product',
          product_id: item.productId,
          qty:        item.qty,
          alert:      true,
        })
      }
    } else {
      try {
        await db.rpc('restore_stock', {
          p_variant_id: item.variantId,
          p_qty: item.qty,
        })
      } catch (err) {
        // BUG FIX 22d: captureError with alert:true — see above.
        captureError(err, {
          action:     'inventoryService.restoreStock.variant',
          variant_id: item.variantId,
          qty:        item.qty,
          alert:      true,
        })
      }
    }
  }
}
