/**
 * stockRpcSchemaContract.test.ts
 *
 * ROOT-CAUSE REGRESSION GUARD for the production incident where
 * reserve_stock_at_order(), reserve_product_stock_at_order(),
 * deduct_stock_atomic(), restore_stock(), and restore_product_stock() were
 * all declared with `UUID` parameters in db_migration.sql, while
 * product_variants.id and products.id are actually BIGINT in the live
 * database. Every call to these RPCs failed with Postgres 22P02
 * (invalid_text_representation), and — before the inventoryService.ts fix —
 * that error was silently treated as "insufficient stock" at checkout.
 *
 * The application-layer test in inventoryService.test.ts pins the
 * *consequence* (infra errors must never look like business errors). This
 * file pins the *cause*: it queries Postgres's own catalog (information_schema
 * / pg_proc) and asserts that each stock RPC's declared parameter type
 * actually matches the column type it's compared against.
 *
 * This is a schema-drift contract test, the same category of check that
 * Stripe/Shopify-style platforms run in CI whenever hand-written SQL
 * functions sit next to a schema that migrates independently — a generated-types
 * pipeline (`supabase gen types typescript`) prevents the TS side from
 * drifting, and this test prevents the *SQL function signature* side from
 * drifting against the table it targets.
 *
 * REQUIRES a real Postgres connection (SUPABASE_DB_URL or equivalent). It is
 * automatically skipped — not failed — in environments without DB access
 * (e.g. a contributor's laptop with no .env), so it never blocks unrelated
 * local test runs. It MUST run in CI, where DB credentials are present,
 * exactly because that's where this class of bug needs to be caught.
 */
import { describe, it, expect } from 'vitest'

const DB_URL =
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL ||
  process.env.SUPABASE_TEST_DB_URL

const describeIfDb = DB_URL ? describe : describe.skip

describeIfDb('stock RPC ↔ schema type contract (live Postgres)', () => {
  // Lazily imported only when DB_URL is present, so `pg` doesn't need to be
  // a hard dependency for contributors running the unit suite offline.
  async function getClient() {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: DB_URL })
    await client.connect()
    return client
  }

  const CHECKS: Array<{
    fn: string
    param: string
    table: string
    column: string
  }> = [
    { fn: 'reserve_stock_at_order',         param: 'p_variant_id', table: 'product_variants', column: 'id' },
    { fn: 'reserve_product_stock_at_order', param: 'p_product_id', table: 'products',          column: 'id' },
    { fn: 'deduct_stock_atomic',            param: 'p_variant_id', table: 'product_variants', column: 'id' },
    { fn: 'restore_stock',                  param: 'p_variant_id', table: 'product_variants', column: 'id' },
    { fn: 'restore_product_stock',          param: 'p_product_id', table: 'products',          column: 'id' },
  ]

  for (const { fn, param, table, column } of CHECKS) {
    it(`${fn}(${param}) matches ${table}.${column}'s actual column type`, async () => {
      const client = await getClient()
      try {
        const colTypeRes = await client.query(
          `select data_type from information_schema.columns
           where table_name = $1 and column_name = $2`,
          [table, column]
        )
        expect(colTypeRes.rows.length).toBe(1)
        const liveColumnType = colTypeRes.rows[0].data_type as string // e.g. 'bigint', 'uuid'

        const paramTypeRes = await client.query(
          `select pg_catalog.format_type(t.oid, null) as param_type
           from pg_proc p
           join pg_type t on t.typname = (
             regexp_match(pg_get_function_arguments(p.oid), $2 || '\\s+(\\w+)')
           )[1]
           where p.proname = $1
           limit 1`,
          [fn, param]
        )

        // Fallback: directly inspect pg_get_function_arguments if the regex
        // join above doesn't resolve cleanly for this Postgres version.
        const argsRes = await client.query(
          `select pg_get_function_arguments(oid) as args
           from pg_proc where proname = $1 limit 1`,
          [fn]
        )
        expect(argsRes.rows.length).toBeGreaterThan(0)
        const argsStr: string = argsRes.rows[0]?.args ?? ''
        const match = new RegExp(`${param}\\s+(\\w+)`).exec(argsStr)
        expect(match, `could not find param ${param} in signature: ${argsStr}`).not.toBeNull()
        const declaredParamType = (match?.[1] ?? '').toLowerCase()

        // Normalize Postgres aliases so 'integer' vs 'int4', 'bigint' vs 'int8'
        // don't produce false-positive failures.
        const normalize = (t: string) =>
          t.replace('integer', 'int4').replace('bigint', 'int8').replace('int8', 'bigint')

        expect(
          normalize(declaredParamType) === normalize(liveColumnType) ||
          declaredParamType === liveColumnType,
          `${fn}'s ${param} is declared as "${declaredParamType}" but ` +
          `${table}.${column} is actually "${liveColumnType}" — this exact ` +
          `mismatch caused production checkout to fail with false ` +
          `"insufficient stock" errors. Fix the function signature in ` +
          `db_migration.sql to use "${liveColumnType}".`
        ).toBe(true)

        void paramTypeRes // kept for future use if a stricter catalog join is added
      } finally {
        await client.end()
      }
    })
  }
})
