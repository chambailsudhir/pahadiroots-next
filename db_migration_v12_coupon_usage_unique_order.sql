-- v12: Coupon reporting fix (ORD-2026-00119) — idempotency safeguard
--
-- orderService.ts now inserts a coupon_usage row every time a coupon is
-- applied to an order (previously it only bumped coupons.uses_count, so
-- the admin Coupons page's "Uses" / "Discount Given" columns — which are
-- computed from coupon_usage, not uses_count — never reflected real orders).
--
-- This unique constraint makes that insert idempotent: if an order-creation
-- retry (e.g. a client idempotency-key retry) runs the coupon_usage insert
-- twice for the same order, the second insert hits a harmless 23505
-- unique_violation instead of double-recording the discount.
--
-- Safe to run more than once.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coupon_usage_order_id_key'
  ) THEN
    ALTER TABLE coupon_usage
      ADD CONSTRAINT coupon_usage_order_id_key UNIQUE (order_id);
  END IF;
END $$;
