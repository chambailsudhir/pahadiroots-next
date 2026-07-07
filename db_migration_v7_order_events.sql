-- ============================================================
-- PAHADI ROOTS — DB MIGRATION v7: ORDER_EVENTS AUDIT TABLE
-- Run in Supabase SQL Editor AFTER v6 (order confirmation token)
--
-- CORRECTED: order_id below is `bigint`, matching orders.id — confirmed via
-- live inspection query (SELECT column_name, data_type FROM
-- information_schema.columns WHERE table_name='orders' AND column_name='id'),
-- NOT assumed. The first version of this migration guessed `uuid` and failed
-- with "foreign key constraint ... cannot be implemented ... uuid and bigint"
-- — Postgres rejected it cleanly, nothing was created. This version is
-- schema-confirmed.
--
-- BUG FIX (found via Vercel production logs): logOrderEvent() in
-- orderService.ts inserts into a table called `order_events` on every
-- order-lifecycle milestone (order_created, payment_verified,
-- payment_signature_mismatch, payment_captured_webhook, etc.) — but this
-- table was never created by any migration in this repo. Every single
-- insert has been failing with "Could not find the table 'public.order_events'
-- in the schema cache".
--
-- This has NOT been breaking orders or payments — logOrderEvent() is
-- deliberately non-fatal (catches and logs the error internally; see its
-- own doc comment in orderService.ts for why) — but it does mean the
-- audit trail has been silently empty this whole time: no record of when
-- an order was created, when payment was verified, or — more importantly —
-- when a payment_signature_mismatch or payment_order_id_mismatch happened
-- (the two events logged specifically for fraud/tampering detection).
-- ============================================================

CREATE TABLE IF NOT EXISTS order_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event      text NOT NULL,
  actor      text NOT NULL,
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Every read of this table so far (none yet — it's write-only from the app
-- today) would filter by order_id; index it for when an admin order-detail
-- view or support tooling wants an order's timeline.
CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON order_events(order_id, created_at DESC);

-- Service-role only (matches the pattern used for other server-only audit/
-- log tables in this project, e.g. webhook_logs, event_logs in db_migration.sql —
-- this table is never queried from the client with the anon key).
ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
