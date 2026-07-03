/**
 * jsonLdOffers.test.ts
 *
 * Covers audit finding #5: structured data was single-Offer-only, unable to
 * represent a multi-size product's price range or per-variant SKU. Verifies
 * the fix follows Google's actual documented guidance (array of Offer
 * objects per variant — NOT AggregateOffer, which Google's docs explicitly
 * say is for multi-seller scenarios, not product variants).
 */

import { describe, it, expect } from 'vitest'
import { buildOffersList, offersListToJsonLdValue } from '@/lib/jsonLdOffers'

const product = { name: 'Mustard Oil', slug: 'mustard-oil', sku: 'MO-BASE' }

describe('buildOffersList', () => {
  it('returns one Offer per active variant, each with its own price/availability/sku', () => {
    const offers = buildOffersList(
      product,
      [
        { size: '500ml', price: 299, available_stock: 10, sku: 'MO-500' },
        { size: '1L',    price: 549, available_stock: 0,  sku: 'MO-1L'  },
      ],
      299,
      true,
    )
    expect(offers).toHaveLength(2)
    expect(offers[0]).toMatchObject({
      '@type': 'Offer', name: 'Mustard Oil - 500ml', price: '299', sku: 'MO-500',
      availability: 'https://schema.org/InStock',
    })
    expect(offers[1]).toMatchObject({
      '@type': 'Offer', name: 'Mustard Oil - 1L', price: '549', sku: 'MO-1L',
      availability: 'https://schema.org/OutOfStock',
    })
  })

  it('never emits an AggregateOffer — Google explicitly disallows it for product variants', () => {
    const offers = buildOffersList(
      product,
      [{ size: '500ml', price: 299, available_stock: 5 }, { size: '1L', price: 549, available_stock: 5 }],
      299,
      true,
    )
    for (const o of offers) expect(o['@type']).toBe('Offer')
    expect(offers.some(o => o['@type'] === 'AggregateOffer')).toBe(false)
  })

  it('omits sku from an offer when the variant has none (never fabricates a value)', () => {
    const offers = buildOffersList(product, [{ size: '500ml', price: 299, available_stock: 5 }], 299, true)
    expect('sku' in offers[0]).toBe(false)
  })

  it('falls back to a single Offer using the base product sku/price when there are no variants', () => {
    const offers = buildOffersList(product, [], 199, true)
    expect(offers).toHaveLength(1)
    expect(offers[0]).toMatchObject({ '@type': 'Offer', price: '199', sku: 'MO-BASE' })
  })

  it('returns [] when there are no variants and no display price (nothing sellable to describe)', () => {
    const offers = buildOffersList(product, [], null, false)
    expect(offers).toEqual([])
  })

  it('every offer carries the canonical product URL, for Merchant Center matching', () => {
    const offers = buildOffersList(product, [{ size: '500ml', price: 299, available_stock: 5 }], 299, true)
    expect(offers[0].url).toBe('https://pahadiroots.com/products/mustard-oil')
  })
})

describe('offersListToJsonLdValue', () => {
  it('collapses a single offer to a bare object (not a 1-element array)', () => {
    const value = offersListToJsonLdValue([{ '@type': 'Offer', price: '199' }])
    expect(Array.isArray(value)).toBe(false)
    expect(value).toEqual({ '@type': 'Offer', price: '199' })
  })

  it('keeps multiple offers as an array', () => {
    const value = offersListToJsonLdValue([
      { '@type': 'Offer', price: '199' },
      { '@type': 'Offer', price: '299' },
    ])
    expect(Array.isArray(value)).toBe(true)
    expect((value as unknown[]).length).toBe(2)
  })

  it('returns undefined for an empty list (so the caller can omit `offers` entirely)', () => {
    expect(offersListToJsonLdValue([])).toBeUndefined()
  })
})
