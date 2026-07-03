// ─────────────────────────────────────────────────────────────────────────────
// lib/jsonLdOffers.ts
//
// BUG FIX (MEDIUM – audit finding #5, single-Offer JSON-LD): offers used to
// always be a single Offer at displayPrice (the cheapest variant), so a
// multi-size product like mustard oil had no way to represent its price range
// or per-variant SKU in structured data.
//
// Per Google's Product structured-data docs, AggregateOffer is explicitly NOT
// the right tool for this ("Don't use AggregateOffer to describe a set of
// product variants" — that's for multi-seller offers of the same item). The
// documented approach for size/variant pricing is an array of individual
// Offer objects, one per variant, each with its own price/availability/sku —
// this also solves the "no sku for Merchant Center feed matching" half of the
// finding.
//
// Extracted from app/products/[slug]/page.tsx into a pure function so it's
// unit-testable in isolation (part of closing the "zero PDP test coverage"
// finding — the inline version could only be exercised via a full page render).
// ─────────────────────────────────────────────────────────────────────────────

interface OfferVariant {
  size?:            string | null
  price:            number
  available_stock?: number | null
  sku?:             string | null
}

interface OfferProduct {
  name: string
  slug: string
  sku?: string | null
}

const SELLER = { '@type': 'Organization', name: '5 Pahadi Roots' } as const

function availability(stock: number | null | undefined): string {
  return Number(stock ?? 0) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
}

/**
 * Builds the JSON-LD `offers` value for a Product: an array of per-variant
 * Offer objects when variants exist, a single-element array for a variant-less
 * product with a known price, or [] when there's nothing sellable to describe.
 */
export function buildOffersList(
  product: OfferProduct,
  activeVariants: OfferVariant[],
  displayPrice: number | null | undefined,
  inStock: boolean,
): Record<string, unknown>[] {
  const productUrl = `https://pahadiroots.com/products/${product.slug}`

  if (activeVariants.length > 0) {
    return activeVariants.map(v => ({
      '@type':       'Offer',
      name:          v.size ? `${product.name} - ${v.size}` : product.name,
      priceCurrency: 'INR',
      price:         String(v.price),
      availability:  availability(v.available_stock),
      seller:        SELLER,
      url:           productUrl,
      ...(v.sku ? { sku: v.sku } : {}),
    }))
  }

  if (!displayPrice) return []

  return [{
    '@type':       'Offer',
    priceCurrency: 'INR',
    price:         String(displayPrice),
    availability:  inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    seller:        SELLER,
    url:           productUrl,
    ...(product.sku ? { sku: product.sku } : {}),
  }]
}

/**
 * Collapses an offers list to the JSON-LD `offers` value: a bare object for a
 * single offer (matches the pre-existing shape for single-variant products),
 * an array for more than one, or undefined when there's nothing to offer.
 * Both object and array forms are valid per schema.org's `offers` property.
 */
export function offersListToJsonLdValue(
  offersList: Record<string, unknown>[],
): Record<string, unknown> | Record<string, unknown>[] | undefined {
  if (offersList.length === 0) return undefined
  return offersList.length === 1 ? offersList[0] : offersList
}
