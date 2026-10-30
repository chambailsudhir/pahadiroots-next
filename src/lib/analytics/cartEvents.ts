import { ga4AddToCart } from './ga4'
import { trackAddToCart } from './track'

/**
 * Reports an add-to-cart that happened OUTSIDE the product page (homepage cards, region cards, quick view).
 *
 * BUG FIX (audit HOME-032): only the product page reported add_to_cart. Every card-level "Add to Cart" on the
 * homepage went straight to the cart store, so GA4 (add_to_cart / checkout funnel) and the in-house
 * analytics_events table never saw them — the funnel started at "view_item" for people who bought via a card.
 *
 * Analytics must never break a purchase: everything is wrapped so a blocked/failed tracker is silent.
 * (ga4Event itself only sends when gtag exists and the visitor's consent allows analytics.)
 */
export function reportCardAddToCart(
  p: { id: number; name: string; price: number; variantId?: number | string | null },
  source: string,
): void {
  try { ga4AddToCart({ productId: p.id, variantId: p.variantId ?? undefined, name: p.name, price: p.price, quantity: 1 }) } catch { /* never block the cart */ }
  try {
    const v = p.variantId == null ? undefined : Number(p.variantId)
    trackAddToCart(p.id, v !== undefined && Number.isFinite(v) ? v : undefined, source)
  } catch { /* never block the cart */ }
}
