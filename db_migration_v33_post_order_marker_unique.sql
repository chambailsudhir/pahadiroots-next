-- db_migration_v33 — one `post_order_finalized` marker per order (Nov 2026 verification, F-1 follow-up).
-- The order route checked for the marker with a GET and wrote it later with an INSERT: two concurrent replays of the same
-- idempotency key (double submit, client retry) could both pass the check and both send the customer + owner e-mails.
-- With this index the INSERT itself is the claim: exactly one request gets the row, every other one gets 23505 (HTTP 409)
-- and skips the e-mails. Production had no duplicate markers when this was written (checked), so the index builds cleanly.
CREATE UNIQUE INDEX IF NOT EXISTS order_events_post_order_finalized_once
  ON public.order_events (order_id)
  WHERE event = 'post_order_finalized';
