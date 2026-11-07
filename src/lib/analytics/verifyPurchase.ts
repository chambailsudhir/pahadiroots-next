// H2-3 (Nov 2026): server-side check for analytics `purchase` events (see src/app/api/v1/analytics/track/route.ts).
import { sbAdmin } from '@/lib/api/serverUtils'
import { captureError } from '@/lib/logger'

type Row = Record<string, unknown>
const PURCHASE_MAX_AGE_MS = 48 * 60 * 60 * 1000

/** Drops purchase rows that do not match a real, recent, paid / confirmed-COD order; sets their value from the order. */
export async function verifyPurchaseRows(rows: Row[]): Promise<Row[]> {
  const refs = [...new Set(rows.filter(r => r.event_type === 'purchase').map(r => {
    const m = r.metadata as Record<string, unknown> | null
    return typeof m?.order_id === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(m.order_id) ? m.order_id : null
  }).filter((x): x is string => !!x))].slice(0, 5)
  let orders: Array<{ order_number: string; total_amount: number | string | null; payment_status: string | null; payment_method: string | null; order_status: string | null; created_at: string; is_deleted?: boolean | null }> = []
  if (refs.length) {
    try {
      orders = await sbAdmin('GET', `/rest/v1/orders?order_number=in.(${refs.map(encodeURIComponent).join(',')})&select=order_number,total_amount,payment_status,payment_method,order_status,created_at,is_deleted`)
    } catch (err) {
      captureError(err, { action: 'analytics_purchase_verify_failed' })
      orders = []                                   // cannot verify → drop the purchase rows, keep the rest
    }
  }
  const now = Date.now()
  const valid = new Map<string, number>()
  for (const o of Array.isArray(orders) ? orders : []) {
    const age = now - Date.parse(o.created_at)
    const live = o.is_deleted !== true && o.order_status !== 'cancelled' && Number.isFinite(age) && age >= 0 && age <= PURCHASE_MAX_AGE_MS
    const paidOrCod = o.payment_status === 'paid' || (o.payment_method === 'cod' && o.order_status === 'confirmed')
    if (live && paidOrCod) valid.set(o.order_number, Number(o.total_amount) || 0)
  }
  return rows.flatMap(r => {
    if (r.event_type !== 'purchase') return [r]
    const m = (r.metadata ?? {}) as Record<string, unknown>
    const ref = typeof m.order_id === 'string' ? m.order_id : null
    if (!ref || !valid.has(ref)) return []
    return [{ ...r, dedupe_key: `purchase:${ref}`, metadata: { ...m, value: valid.get(ref) } }]
  })
}
