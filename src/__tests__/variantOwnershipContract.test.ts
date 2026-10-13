/**
 * Live-schema guard (runs only when a database URL is configured; skipped otherwise).
 *
 * Oct 2026 audit: 4 delivered order lines referenced a variant of a DIFFERENT product (an old client
 * put the product id in the variant slot, and ids are independent sequences, so it "worked"). They are
 * ledger-locked and were fixed with append-only records in order_item_corrections.
 *
 * This scans EVERY base table that carries both product_id and variant_id and fails the build if any row
 * pairs a product with another product's variant - so a regression (or a new table with the same pair)
 * is caught in CI instead of in production. The only rows allowed to mismatch are order_items that already
 * have an append-only correction. Same query as supabase/manual/monitor_variant_ownership.sql in the admin repo.
 */
import { describe, it, expect } from 'vitest'

const DB_URL =
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL ||
  process.env.SUPABASE_TEST_DB_URL

const describeIfDb = DB_URL ? describe : describe.skip

describeIfDb('variant ownership — no table pairs a product with another product\'s variant', () => {
  async function withClient<T>(fn: (c: import('pg').Client) => Promise<T>): Promise<T> {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: DB_URL })
    await client.connect()
    try { return await fn(client) } finally { await client.end() }
  }

  it('every product_id + variant_id table is consistent (known corrected order lines excepted)', async () => {
    await withClient(async (client) => {
      const { rows: tables } = await client.query<{ table_name: string }>(
        `SELECT c.table_name
           FROM information_schema.columns c
           JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
          WHERE c.table_schema = 'public' AND c.column_name IN ('product_id', 'variant_id')
          GROUP BY c.table_name HAVING count(DISTINCT c.column_name) = 2`)
      expect(tables.map(t => t.table_name)).toContain('order_items')   // the scan itself must be finding the tables

      const { rows: hasCorrections } = await client.query(`SELECT to_regclass('public.order_item_corrections') IS NOT NULL AS present`)
      const correctionsPresent = hasCorrections[0].present as boolean

      const offenders: Record<string, number> = {}
      for (const { table_name } of tables) {
        const exclusion = table_name === 'order_items' && correctionsPresent
          ? ' AND NOT EXISTS (SELECT 1 FROM public.order_item_corrections c WHERE c.order_item_id = t.id)'
          : table_name === 'order_items'
            ? ' AND NOT COALESCE(t.ledger_locked, false)'   // before migration 056: only the locked historic rows may differ
            : ''
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM public."${table_name}" t
             JOIN public.product_variants v ON v.id = t.variant_id
            WHERE t.product_id IS NOT NULL AND v.product_id IS DISTINCT FROM t.product_id${exclusion}`)
        if (rows[0].n > 0) offenders[table_name] = rows[0].n
      }
      expect(offenders, `rows pairing a product with another product's variant: ${JSON.stringify(offenders)}`).toEqual({})
    })
  })

  it('the database itself refuses such a pair on new order lines (composite FK, migration 055)', async () => {
    await withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = 'public.order_items'::regclass AND contype = 'f'
            AND conname = 'order_items_variant_belongs_to_product_fkey'`)
      expect(rows, 'migration 055 (composite FK) is not applied').toHaveLength(1)
    })
  })
})
