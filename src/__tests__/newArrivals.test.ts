/**
 * newArrivals.test.ts
 *
 * Covers isNewArrival()/filterNewArrivals() — the shared definition used by
 * both the homepage "New Arrivals" strip and the dedicated /new-arrivals
 * collection page, so the two surfaces can never disagree on what counts as
 * "new" (previously the homepage just took the 4 most-recent products with
 * no age check at all, and "See All" pointed at an unrelated generic
 * /products?sort=newest listing).
 */

import { describe, it, expect } from 'vitest'
import { isNewArrival, filterNewArrivals, isJustAdded, NEW_ARRIVAL_WINDOW_DAYS } from '@/lib/newArrivals'
import type { Product } from '@/types'

const NOW = new Date('2026-07-12T00:00:00Z').getTime()

function daysAgo(n: number): string {
  return new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1, name: 'Test', slug: 'test', emoji: null, sku: null, category_id: 1,
    state_id: null, is_active: true, unit_label: null, gst_rate: 5, price: 100,
    selling: null, mrp: null, cost_price: null, available_stock: 10, initial_stock: 10,
    short_description: null, long_description: null, image_url: null, tags: null,
    badges_bestseller: false, badges_organic: false, badges_new: false, is_deleted: false,
    created_at: daysAgo(0),
    ai_description: null, ai_health_benefits: null, ai_how_to_use: null, ai_storage_tips: null,
    ai_who_should_buy: null, ai_generated_at: null,
    ...overrides,
  } as Product
}

describe('isNewArrival', () => {
  it('qualifies a product created today', () => {
    expect(isNewArrival(makeProduct({ created_at: daysAgo(0) }), NOW)).toBe(true)
  })

  it(`qualifies a product created exactly at the ${NEW_ARRIVAL_WINDOW_DAYS}-day boundary`, () => {
    expect(isNewArrival(makeProduct({ created_at: daysAgo(NEW_ARRIVAL_WINDOW_DAYS) }), NOW)).toBe(true)
  })

  it('excludes a product created just past the window', () => {
    expect(isNewArrival(makeProduct({ created_at: daysAgo(NEW_ARRIVAL_WINDOW_DAYS + 1) }), NOW)).toBe(false)
  })

  it('qualifies a curated "new" badge regardless of age', () => {
    const old = makeProduct({ created_at: daysAgo(400), badges: ['new'] })
    expect(isNewArrival(old, NOW)).toBe(true)
  })

  it('qualifies via the legacy badges_new boolean regardless of age', () => {
    const old = makeProduct({ created_at: daysAgo(400), badges_new: true })
    expect(isNewArrival(old, NOW)).toBe(true)
  })

  it('excludes a product with no created_at and no new badge', () => {
    expect(isNewArrival(makeProduct({ created_at: '' as any }), NOW)).toBe(false)
  })

  it('does not treat a future created_at as new (defensive against bad data)', () => {
    // guards against clock skew / bad seed data producing a negative age
    // that would otherwise slip under the "<= window" check
    const future = makeProduct({ created_at: new Date(NOW + 10 * 86400000).toISOString() })
    expect(isNewArrival(future, NOW)).toBe(false)
  })
})

describe('filterNewArrivals', () => {
  it('returns only qualifying products, preserving order', () => {
    const products = [
      makeProduct({ id: 1, created_at: daysAgo(0) }),
      makeProduct({ id: 2, created_at: daysAgo(1000) }),
      makeProduct({ id: 3, badges: ['new'], created_at: daysAgo(1000) }),
    ]
    const result = filterNewArrivals(products, NOW)
    expect(result.map(p => p.id)).toEqual([1, 3])
  })
})

describe('isJustAdded', () => {
  it('qualifies within the tighter "added this week" window', () => {
    expect(isJustAdded(makeProduct({ created_at: daysAgo(3) }), NOW)).toBe(true)
  })

  it('excludes a product outside the tighter window even if it is still a new arrival', () => {
    const p = makeProduct({ created_at: daysAgo(20) })
    expect(isNewArrival(p, NOW)).toBe(true)
    expect(isJustAdded(p, NOW)).toBe(false)
  })
})
