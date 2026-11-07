/**
 * Round 9 (Nov 2026): an order the shop deleted (orders.is_deleted — test orders, mistakes) is not the customer's any more.
 * #179 hid it from the account list and stats, but every per-order endpoint still found it by id / order number, so a customer
 * could open it, download its invoice, cancel it (the status trigger puts its stock back a second time and coins/coupon are
 * reversed on an order that no longer counts), request a return on it, or leave a "verified purchase" review from it.
 * Every customer-facing orders query must exclude deleted orders. Source-level contract: each listed file reads orders only
 * through queries that carry the filter.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const FILES = [
  'src/app/api/orders/[id]/route.ts',
  'src/app/api/orders/[id]/invoice/route.ts',
  'src/app/api/orders/[id]/cancel/route.ts',
  'src/app/api/orders/[id]/return/route.ts',
  'src/app/api/orders/[id]/return/upload-url/route.ts',
  'src/app/api/v1/orders/lookup/route.ts',
  'src/app/api/v1/orders/track/route.ts',
  'src/lib/server/reviewSubmit.ts',
]

describe('deleted orders are not reachable through customer endpoints', () => {
  for (const f of FILES) {
    it(f, () => {
      const src = readFileSync(path.join(process.cwd(), f), 'utf8')
      const queries = src.match(/\/rest\/v1\/orders\?[^`'"]*/g) ?? []
      expect(queries.length, 'expected at least one orders query').toBeGreaterThan(0)
      for (const q of queries) expect(q, q).toContain('is_deleted=not.is.true')
    })
  }
})
