import { getServiceClient } from '@/lib/supabase'

export interface StockCheckItem {
  variantId: string
  qty: number
}

export interface StockCheckResult {
  ok: boolean
  failedItems: Array<{ variantId: string; requested: number; available: number }>
}

// Check stock for multiple items before order creation
// Does NOT deduct — deduction happens via DB trigger after order confirm
export async function checkStockAvailability(
  items: StockCheckItem[]
): Promise<StockCheckResult> {
  const db = getServiceClient()
  const failedItems: StockCheckResult['failedItems'] = []

  // Batch fetch all variant stocks
  const ids = items.map(i => i.variantId)
  const { data: variants, error } = await db
    .from('product_variants')
    .select('id, available_stock, is_active')
    .in('id', ids.map((id: string) => isNaN(Number(id)) ? id : Number(id)))

  if (error) throw new Error('Stock check failed: ' + error.message)

  const stockMap = new Map(
    (variants || []).map(v => [String(v.id), v])
  )

  for (const item of items) {
    const variant = stockMap.get(String(item.variantId))
    if (!variant || !variant.is_active) {
      failedItems.push({ variantId: item.variantId, requested: item.qty, available: 0 })
      continue
    }
    if (variant.available_stock < item.qty) {
      failedItems.push({
        variantId: item.variantId,
        requested: item.qty,
        available: variant.available_stock,
      })
    }
  }

  return { ok: failedItems.length === 0, failedItems }
}

// Atomic stock deduction — ONLY call after payment confirmed
// Uses conditional UPDATE to prevent race conditions (audit #A4)
// Returns false if stock insufficient (someone else bought last unit)
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
    await db.rpc('restore_stock', {
      p_variant_id: item.variantId,
      p_qty: item.qty,
    })
  }
}

