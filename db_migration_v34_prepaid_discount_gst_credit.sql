-- db_migration_v34 — the prepaid discount reduces the stored GST too (Nov 2026 verification).
-- The checkout carves GST out of the value AFTER the coupon AND the prepaid % discount (CGST Act s.15(3)(a)), and the invoice
-- prints that net taxable value, but orders.tax (trigger recompute_order_tax) only credited the COUPON: the prepaid discount was
-- not stored on the order at all. With prepaid_discount_pct > 0 the invoice would show a tax ~5% too high for its own taxable
-- value. Dormant until now (prepaid is 0% in production), so no existing order changes: the new column defaults to 0.
--   1. orders.prepaid_discount (₹, written by the app right after the order is created).
--   2. order_coupon_gst_credit(): credits coupon + prepaid discount, capped at the goods value (same proportional rule as before).
--   3. the fee-change trigger (v30) also recomputes the tax when prepaid_discount changes.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS prepaid_discount numeric(12,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.order_coupon_gst_credit(p_order_id bigint) RETURNS numeric
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  WITH o AS (SELECT COALESCE(coupon_discount, 0) + COALESCE(prepaid_discount, 0) AS cut FROM orders WHERE id = p_order_id),
       t AS (SELECT COALESCE(SUM(price_at_time * quantity), 0) AS incl_total, COALESCE(SUM(gst_amount), 0) AS gst_total
               FROM order_items WHERE order_id = p_order_id AND price_at_time * quantity > 0)
  SELECT CASE WHEN (SELECT cut FROM o) <= 0 OR (SELECT incl_total FROM t) <= 0 THEN 0::numeric
              ELSE ROUND(LEAST((SELECT cut FROM o), (SELECT incl_total FROM t)) / (SELECT incl_total FROM t) * (SELECT gst_total FROM t), 2) END
$f$;
REVOKE EXECUTE ON FUNCTION public.order_coupon_gst_credit(bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.order_coupon_gst_credit(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_recompute_tax_on_fee_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF (NEW.shipping_charge IS DISTINCT FROM OLD.shipping_charge OR NEW.cod_surcharge IS DISTINCT FROM OLD.cod_surcharge
      OR NEW.prepaid_discount IS DISTINCT FROM OLD.prepaid_discount)
     AND NEW.order_status::text IN ('pending', 'confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery') THEN
    UPDATE orders o
       SET tax = ROUND(COALESCE((SELECT SUM(gst_amount) FROM order_items WHERE order_id = NEW.id), 0)
                       - CASE WHEN o.tax_basis = 'net_of_discount' THEN public.order_coupon_gst_credit(NEW.id) ELSE 0 END
                       + public.order_fee_gst(NEW.id), 2)
     WHERE o.id = NEW.id;
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_recompute_tax_on_fee_change ON public.orders;
CREATE TRIGGER trg_recompute_tax_on_fee_change AFTER UPDATE OF shipping_charge, cod_surcharge, prepaid_discount ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_tax_on_fee_change();
