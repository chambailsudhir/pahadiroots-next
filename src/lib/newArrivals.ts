import type { Product } from '@/types'

// ── "New Arrival" definition ─────────────────────────────────────────────
// Big storefronts (Amazon "New Releases", Nykaa "New Launches", Myntra
// "New Arrivals") define this two ways at once: an editorially curated flag
// PLUS a rolling recency window, so the collection never goes stale even if
// nobody remembers to un-flag old stock, and never stays empty just because
// nobody has manually tagged anything yet.
//
// Curated:  product.badges includes 'new' (set from the admin panel)
// Automatic: product.created_at falls within the last NEW_ARRIVAL_WINDOW_DAYS
//
// A product qualifies if EITHER is true.
export const NEW_ARRIVAL_WINDOW_DAYS = 45

export function isNewArrival(p: Product, now: number = Date.now()): boolean {
  const badges = Array.isArray(p.badges) ? p.badges : []
  if (p.badges_new || badges.includes('new')) return true
  if (!p.created_at) return false
  const created = new Date(p.created_at).getTime()
  if (Number.isNaN(created)) return false
  const ageDays = (now - created) / (1000 * 60 * 60 * 24)
  return ageDays >= 0 && ageDays <= NEW_ARRIVAL_WINDOW_DAYS
}

export function filterNewArrivals(products: Product[], now: number = Date.now()): Product[] {
  return products.filter(p => isNewArrival(p, now))
}

// "Just added" sub-highlight — a tighter window (7 days) used for a small
// "added this week" strip, matching the "just landed" framing e-commerce
// new-arrival pages typically layer on top of the full listing.
export const JUST_ADDED_WINDOW_DAYS = 7

export function isJustAdded(p: Product, now: number = Date.now()): boolean {
  if (!p.created_at) return false
  const created = new Date(p.created_at).getTime()
  if (Number.isNaN(created)) return false
  const ageDays = (now - created) / (1000 * 60 * 60 * 24)
  return ageDays >= 0 && ageDays <= JUST_ADDED_WINDOW_DAYS
}
