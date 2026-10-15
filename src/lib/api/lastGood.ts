/**
 * lib/api/lastGood.ts — "serve the last good answer if the database stalls".
 *
 * WHY (Oct 2026): the Supabase free-tier compute intermittently stalls for
 * 5–12 s even under tiny load, which turned /api/v1/cart-settings,
 * /coupon-hints and /cart-upsells into 4 s timeouts → HTTP 500 → a cart/checkout
 * with no shipping/COD settings. For READ-ONLY display data it is strictly
 * better to show the last value we successfully read (bounded age) than an
 * error.
 *
 * SCOPE / SAFETY
 *  • Per server instance, in memory. Fluid compute reuses warm instances, so
 *    this covers exactly the situation it exists for: an instance that has
 *    been serving traffic when the DB hiccups. A cold instance with nothing
 *    remembered still fails the same way as before (HTTP 500).
 *  • Bounded age (maxAgeMs). Older than that → treated as "nothing remembered".
 *  • Display only. Order creation, payment and the Razorpay webhook all
 *    re-read settings fresh server-side (getFreshSiteSettings) and recompute
 *    every total themselves, so a stale cart display can never change what a
 *    customer is actually charged.
 *  • Bounded memory: at most MAX_ENTRIES keys (oldest evicted).
 */

interface Entry { value: unknown; at: number }

const store = new Map<string, Entry>()
const MAX_ENTRIES = 50

export function rememberGood<T>(key: string, value: T): void {
  store.delete(key) // re-insert so Map order == recency
  store.set(key, { value, at: Date.now() })
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

export function recallGood<T>(key: string, maxAgeMs: number): { value: T; ageMs: number } | null {
  const e = store.get(key)
  if (!e) return null
  const ageMs = Date.now() - e.at
  if (ageMs > maxAgeMs) { store.delete(key); return null }
  return { value: e.value as T, ageMs }
}

/** Test helper — not used by app code. */
export function _clearLastGood(): void { store.clear() }
