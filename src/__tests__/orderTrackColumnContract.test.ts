/**
 * orderTrackColumnContract.test.ts
 *
 * AUDIT S1-007 / S2-002 — DB-contract guard for /api/v1/orders/track.
 *
 * The route used to filter `orders` on `customer_phone`, a column that does
 * not exist (orders.customer_id → customers.phone). PostgREST answered 400,
 * the route's `.catch(() => null)` converted that into the uniform 404, and
 * every /track lookup "failed closed". The unit test mocked sbAdmin and
 * asserted the same bogus column, so it could never catch the drift.
 *
 * Same category as stockRpcSchemaContract.test.ts, but runnable OFFLINE: it
 * parses the route source for every PostgREST `orders` / `customers` query it
 * builds and checks each referenced column against a list mirrored from the
 * live schema (information_schema.columns, read by the audit lead on
 * 2026-10-26). If a future edit names a column that is not in the list, this
 * fails in CI before PostgREST gets a chance to 400 in production.
 *
 * When the live schema gains a column the route legitimately needs, add it
 * HERE deliberately (after checking the DB) — never widen the regex.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Mirrored from the live `orders` table (public schema). Only columns that
// were confirmed to exist are listed; `customer_phone`, `customer_name` and
// `customer_email` are deliberately absent — they were removed when orders
// moved to the customer_id FK (SETUP.md "Troubleshooting", db_migration.sql:10).
export const LIVE_ORDERS_COLUMNS = [
  'id', 'order_number', 'customer_id', 'total_amount', 'payment_status',
  'order_status', 'payment_method', 'created_at', 'shipping_address',
  'tracking_number', 'courier', 'shipped_at', 'delivered_at',
] as const

// Mirrored from the live `customers` table — only what the track route reads.
export const LIVE_CUSTOMERS_COLUMNS = [
  'id', 'phone', 'first_name', 'last_name', 'email', 'auth_user_id',
] as const

const ROUTE_PATH = path.resolve(__dirname, '../app/api/v1/orders/track/route.ts')

/** Pull every `/rest/v1/<table>?<query>` string out of the source. */
function extractQueries(src: string, table: 'orders' | 'customers'): string[] {
  const re = new RegExp(`/rest/v1/${table}\\?([^\`'"\\n]*)`, 'g')
  const out: string[] = []
  for (const m of src.matchAll(re)) out.push(m[1])
  return out
}

/**
 * Columns referenced by a PostgREST query string: the `select=` list plus
 * every `<col>=<op>.…` filter. Template placeholders (`${…}`) and PostgREST
 * keywords (select/limit/order/or/and) are skipped.
 */
function referencedColumns(query: string): string[] {
  const cols = new Set<string>()
  for (const part of query.split('&')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq)
    const val = part.slice(eq + 1)
    if (key === 'select') {
      // Inline template constants are resolved by the caller before this runs.
      for (const c of val.split(',')) {
        const name = c.trim()
        if (name && !name.startsWith('${')) cols.add(name)
      }
      continue
    }
    if (['limit', 'order', 'or', 'and', 'offset'].includes(key)) continue
    if (key.startsWith('${')) continue
    cols.add(key)
  }
  return [...cols]
}

/** Inline `${TRACK_SELECT}` / `${TRACK_FETCH_SELECT}` with their literal values. */
function inlineSelectConstants(src: string): string {
  const consts = new Map<string, string>()
  for (const m of src.matchAll(/const\s+([A-Z_]+)\s*=\s*(['`])([^'`]*)\2/g)) {
    let value = m[3]
    // one level of nesting: `${TRACK_SELECT},customer_id,...`
    value = value.replace(/\$\{([A-Z_]+)\}/g, (_, name) => consts.get(name) ?? '')
    consts.set(m[1], value)
  }
  return src.replace(/\$\{([A-Z_]+)\}/g, (whole, name) => consts.get(name) ?? whole)
}

describe('/api/v1/orders/track ↔ live schema column contract (AUDIT S1-007 / S2-002)', () => {
  const src = inlineSelectConstants(readFileSync(ROUTE_PATH, 'utf8'))

  it('builds at least one PostgREST query against orders', () => {
    expect(extractQueries(src, 'orders').length).toBeGreaterThan(0)
  })

  it('every orders column the route selects or filters on exists in the live schema', () => {
    for (const q of extractQueries(src, 'orders')) {
      const cols = referencedColumns(q)
      expect(cols.length).toBeGreaterThan(0)
      for (const col of cols) {
        // This is the production bug: `customer_phone` is not a column.
        expect(LIVE_ORDERS_COLUMNS as readonly string[], `orders.${col} referenced in "${q}"`).toContain(col)
      }
    }
  })

  it('every customers column the route selects or filters on exists in the live schema', () => {
    for (const q of extractQueries(src, 'customers')) {
      for (const col of referencedColumns(q)) {
        expect(LIVE_CUSTOMERS_COLUMNS as readonly string[], `customers.${col} referenced in "${q}"`).toContain(col)
      }
    }
  })

  it('never filters orders on a customer_* column (phone lives on customers)', () => {
    expect(src).not.toMatch(/orders\?[^`\n]*customer_(phone|name|email)=/)
  })

  it('resolves the phone through orders.customer_id → customers', () => {
    const ordersCols = extractQueries(src, 'orders').flatMap(referencedColumns)
    expect(ordersCols).toContain('customer_id')
    expect(extractQueries(src, 'customers').length).toBeGreaterThan(0)
  })
})
