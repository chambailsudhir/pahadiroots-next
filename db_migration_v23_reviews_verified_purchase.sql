-- db_migration_v23_reviews_verified_purchase.sql
-- Verified-purchase product reviews + post-delivery review-request e-mails.
--
-- NOT APPLIED. Additive and idempotent (safe to run twice). Column / table assumptions
-- (customers.id, orders.id are bigint; `reviews` already has product_id/customer_name/rating/
-- review_text/comment/status/created_at; `site_settings` has key/value) were taken from the repo,
-- NOT from the live schema - check them against production before applying.
--
-- Rollback (only if needed):
--   drop table if exists public.review_requests;
--   drop index if exists public.reviews_customer_product_uniq;
--   alter table public.reviews drop column if exists customer_id, drop column if exists order_id,
--     drop column if exists is_verified_purchase;
--   delete from public.site_settings where key in ('review_request_enabled','review_request_days');

BEGIN;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS customer_id bigint REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_id    bigint REFERENCES public.orders(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_verified_purchase boolean NOT NULL DEFAULT false;

-- One review per product per customer. Legacy rows (customer_id NULL) are not constrained.
-- NOTE: if this fails with 23505 there are duplicate (customer_id, product_id) rows - there cannot be any
-- before this migration (customer_id is new), so a failure means the migration was partly run by hand.
CREATE UNIQUE INDEX IF NOT EXISTS reviews_customer_product_uniq
  ON public.reviews (customer_id, product_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reviews_customer_id_idx ON public.reviews (customer_id) WHERE customer_id IS NOT NULL;

-- Claim table for the review-request e-mail: the row is inserted BEFORE sending, so two overlapping cron
-- runs can never both mail the same order. Service role only.
CREATE TABLE IF NOT EXISTS public.review_requests (
  order_id bigint PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  sent_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;   -- no policies: only the service role can touch it
REVOKE ALL ON TABLE public.review_requests FROM anon, authenticated;

-- Admin-editable settings (Admin -> Settings). 'false' on review_request_enabled stops the e-mails.
INSERT INTO public.site_settings (key, value) VALUES
  ('review_request_enabled', 'true'),
  ('review_request_days',    '7')
ON CONFLICT DO NOTHING;

COMMIT;
