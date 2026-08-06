-- db_migration_v10_stock_notifications.sql
--
-- Backs the "Notify Me" button on out-of-stock products (ProductCard.tsx),
-- which previously had no capture mechanism at all (P1, homepage audit).
--
-- This file did not exist in the repo even though the table was already
-- live in Supabase — regenerated here directly from the live schema
-- (information_schema.columns / pg_constraint / pg_indexes / pg_policies,
-- Aug 2026 audit) so it exactly matches what's actually deployed, rather
-- than being reconstructed from memory. Safe to run against a fresh DB;
-- CREATE TABLE IF NOT EXISTS means it's also a no-op against the current
-- production DB, which already has this table.

CREATE TABLE IF NOT EXISTS stock_notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  notified     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at  TIMESTAMPTZ,

  -- One outstanding notification request per product+email — the upsert
  -- in api/v1/actions/route.ts relies on this for its ON CONFLICT target.
  CONSTRAINT stock_notifications_product_id_email_key UNIQUE (product_id, email)
);

CREATE INDEX IF NOT EXISTS idx_stock_notifications_pending
  ON stock_notifications (product_id) WHERE (NOT notified);

-- RLS is enabled with zero policies (confirmed live) — this table is
-- written/read exclusively via the service-role client (getServiceClient()
-- in api/v1/actions/route.ts), so anon/authenticated get no direct access
-- at all rather than being scoped by a policy.
ALTER TABLE stock_notifications ENABLE ROW LEVEL SECURITY;
