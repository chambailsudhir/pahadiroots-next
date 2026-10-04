// ─────────────────────────────────────────────────────────────────────────────
// lib/cartRevalidate.ts — C1 client helper
//
// Asks the server for the live state of the cart and applies it to the store.
// FAILS OPEN: if the check cannot complete (offline, 5xx, timeout) the cart is left as
// is and ok:false is returned — createOrder() re-prices from the database at charge time,
// so a validation outage must never block a customer from checking out.
// ─────────────────────────────────────────────────────────────────────────────
import { useCartStore } from '@/store/cartStore'
import { describeCartChanges, type CartChange, type LiveLineDTO } from '@/lib/cartReconcile'

export interface RevalidationResult {
  ok:       boolean          // false → could not check (cart untouched)
  changes:  CartChange[]
  messages: string[]
}

export async function revalidateCart(opts: { signal?: AbortSignal } = {}): Promise<RevalidationResult> {
  const items = useCartStore.getState().items
  if (items.length === 0) return { ok: true, changes: [], messages: [] }

  try {
    const res = await fetch('/api/v1/cart/validate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ items: items.map(i => ({ productId: String(i.productId), variantId: String(i.variantId), qty: i.qty })) }),
      signal:  opts.signal,
    })
    if (!res.ok) return { ok: false, changes: [], messages: [] }
    const data = await res.json().catch(() => null) as { lines?: LiveLineDTO[] } | null
    if (!data || !Array.isArray(data.lines)) return { ok: false, changes: [], messages: [] }

    // Applied against the cart AS IT IS NOW (not the snapshot sent above), so a quantity
    // the customer edited while the request was in flight is respected.
    const changes = useCartStore.getState().applyLiveLines(data.lines)
    return { ok: true, changes, messages: describeCartChanges(changes) }
  } catch {
    return { ok: false, changes: [], messages: [] }
  }
}
