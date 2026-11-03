-- db_migration_v29_order_tax_includes_fee_gst.sql  (APPLIED to production, after a rolled-back scenario test)
-- FOUND Nov 2026: the stored orders.tax is NOT what the app sends (p_tax): trigger trg_recompute_order_tax (AFTER INSERT/UPDATE/DELETE
-- on order_items) overwrites it with Σ order_items.gst_amount (paise-exact) − the coupon GST credit. The GST on the shipping charge and
-- the COD fee therefore never reached the stored tax / CGST-SGST-IGST split / invoice, even after the app-side change.
-- Owner decision "like the big marketplaces": shipping + COD fee are part of the value of the supply (CGST Act s.15(2)(c)) and follow the
-- GOODS' rate; in a mixed-rate order the fee is shared across the lines by value, each share at its own line's rate.
-- Both fees are GST-inclusive, so the customer's total does not change. Orders without fees get exactly the tax they got before.
CREATE OR REPLACE FUNCTION public.order_fee_gst(p_order_id bigint) RETURNS numeric
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT COALESCE(SUM(
           (COALESCE(o.shipping_charge, 0) + COALESCE(o.cod_surcharge, 0))
           * ((oi.price_at_time * oi.quantity) / NULLIF(t.total, 0))
           * (COALESCE(p.gst_rate, 0) / (100 + COALESCE(p.gst_rate, 0)))
         ), 0)
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id
    JOIN LATERAL (SELECT SUM(price_at_time * quantity) AS total FROM order_items WHERE order_id = o.id) t ON true
   WHERE o.id = p_order_id
$f$;

CREATE OR REPLACE FUNCTION public.recompute_order_tax() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_order_id BIGINT;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  UPDATE orders o
  SET tax = ROUND(
        COALESCE((SELECT SUM(gst_amount) FROM order_items WHERE order_id = v_order_id), 0)
        - CASE WHEN o.tax_basis = 'net_of_discount' THEN public.order_coupon_gst_credit(v_order_id) ELSE 0 END
        + public.order_fee_gst(v_order_id),
        2)
  WHERE o.id = v_order_id;
  RETURN NEW;
END;
$f$;

REVOKE EXECUTE ON FUNCTION public.order_fee_gst(bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.order_fee_gst(bigint) TO service_role;
