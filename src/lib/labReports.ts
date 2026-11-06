// ── /lab-reports data loaders ────────────────────────────────────────────────
// Shared by the static /lab-reports page (default list of honey reports) and
// GET /api/v1/lab-reports/batch (the `?batch=` jar lookup, which the page now
// does in the browser so the route itself can be served from the ISR cache —
// PERF FIX F-3). Server-side only: both callers run on the server.
import { supabase } from '@/lib/supabase'

export interface CertRow {
  id: number
  report_url: string
  has_purity: boolean
  has_heavy_metals: boolean
  has_pesticides: boolean
  has_active_ingredients: boolean
}

/** What the storefront shows for a looked-up jar batch (no internal ids). */
export interface BatchInfo {
  batch_no: string
  product_name: string | null
  pack_date: string | null
  best_before: string | null
}

interface BatchRow {
  batch_no: string
  product_id: number | null
  pack_date: string | null
  best_before: string | null
  products: { name: string } | { name: string }[] | null
}

// Same rule as the DB check constraint (batches_batch_no_format) — also stops junk reaching the query.
export const BATCH_RE = /^[A-Z0-9-]{3,32}$/

/** The batch number as typed on the form → the canonical form the DB stores ('' when nothing was typed). */
export function normalizeBatchNo(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase().slice(0, 32) : ''
}

export function ticked(c: CertRow) {
  return [c.has_purity, c.has_heavy_metals, c.has_pesticides, c.has_active_ingredients].filter(Boolean).length
}

// productId: the batch's own product when a batch was looked up (so only THAT product's reports show);
// otherwise every active honey product's reports.
export async function loadReports(productId?: number | null): Promise<CertRow[]> {
  try {
    let ids: number[]
    if (productId) {
      ids = [productId]
    } else {
      const { data: prods } = await supabase
        .from('products')
        .select('id, is_active')
        .eq('is_deleted', false)
        .eq('status', 'active')
        .ilike('name', '%honey%')
        .limit(200)
      ids = (prods ?? []).filter(p => p.is_active !== false).map(p => p.id)
    }
    if (ids.length === 0) return []

    const { data: links } = await supabase
      .from('product_certificates')
      .select('certificate_id')
      .in('product_id', ids)
      .limit(1000)
    const certIds = [...new Set((links ?? []).map(l => l.certificate_id))]
    if (certIds.length === 0) return []

    const { data: certs } = await supabase
      .from('certificates')
      .select('id, report_url, has_purity, has_heavy_metals, has_pesticides, has_active_ingredients')
      .in('id', certIds)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(20)

    const seen = new Set<string>()
    return ((certs ?? []) as CertRow[])
      .filter(c => {
        const ticks = c.has_purity || c.has_heavy_metals || c.has_pesticides || c.has_active_ingredients
        if (!c.report_url || !ticks || seen.has(c.report_url)) return false
        seen.add(c.report_url)
        return true
      })
      // Broadest report first (most ticked parameters), stable otherwise.
      .sort((a, b) => ticked(b) - ticked(a))
  } catch (e) {
    console.error('[lab-reports] fetch failed:', e)
    return []
  }
}

/** Active batch by its printed number, or null. `batchNo` must already pass BATCH_RE. */
export async function loadBatch(batchNo: string): Promise<{ info: BatchInfo; productId: number | null } | null> {
  try {
    const { data } = await supabase
      .from('batches')
      .select('batch_no, product_id, pack_date, best_before, products(name)')
      .eq('batch_no', batchNo)
      .eq('is_active', true)
      .maybeSingle()
    const row = (data as BatchRow | null) ?? null
    if (!row) return null
    const productName = Array.isArray(row.products) ? row.products[0]?.name : row.products?.name
    return {
      info: { batch_no: row.batch_no, product_name: productName ?? null, pack_date: row.pack_date, best_before: row.best_before },
      productId: row.product_id,
    }
  } catch (e) {
    console.error('[lab-reports] batch lookup failed:', e)
    return null
  }
}
