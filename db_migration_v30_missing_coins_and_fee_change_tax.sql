-- db_migration_v30_missing_coins_and_fee_change_tax.sql  (APPLIED to production, after a rolled-back scenario test)
-- 1) award_missing_delivery_coins(): safety net for v28. The delivery trigger swallows its own errors (a lock timeout would otherwise make
--    the status change fail), so a failed award had no retry and no trace. The expire-pending-orders cron now calls this daily: registered
--    customers' orders delivered in the last 14 days with no 'earn' row and no reversal get the flat coins. Idempotent (award_loyalty_points
--    skips an order that already earned), service_role only.
-- 2) trg_recompute_tax_on_fee_change: v29 recomputes the stored tax when order_items change; a LATER change of shipping_charge /
--    cod_surcharge on an order that is still in progress (admin edit, COD<->online switch) left the tax stale. Delivered / returned /
--    refunded orders are deliberately not touched (invoices are historical).
CREATE OR REPLACE FUNCTION public.award_missing_delivery_coins(p_limit integer DEFAULT 50) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE r record; v_n integer := 0; v_pts integer; v_raw text; v_en text;
BEGIN
  SELECT value INTO v_en FROM site_settings WHERE key = 'loyalty_enabled';
  IF COALESCE(v_en, 'true') = 'false' THEN RETURN 0; END IF;
  SELECT btrim(value) INTO v_raw FROM site_settings WHERE key = 'loyalty_coins_per_order';
  v_pts := CASE WHEN v_raw ~ '^[0-9]+$' THEN v_raw::integer ELSE 5 END;
  IF v_pts <= 0 THEN RETURN 0; END IF;
  FOR r IN
    SELECT o.id, o.customer_id
      FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.order_status::text = 'delivered' AND NOT COALESCE(o.is_deleted, false)
       AND c.auth_user_id IS NOT NULL
       AND o.delivered_at > now() - interval '14 days'
       AND NOT EXISTS (SELECT 1 FROM loyalty_transactions t WHERE t.order_id = o.id AND t.type = 'earn')
       AND NOT EXISTS (SELECT 1 FROM loyalty_transactions t WHERE t.order_id = o.id AND t.note LIKE 'Reversal:%')
     ORDER BY o.delivered_at LIMIT GREATEST(p_limit, 1)
  LOOP
    BEGIN
      PERFORM public.award_loyalty_points(r.customer_id, r.id, v_pts, 'Earned on delivery');
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'award_missing_delivery_coins: order % skipped: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END $f$;
REVOKE EXECUTE ON FUNCTION public.award_missing_delivery_coins(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.award_missing_delivery_coins(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_recompute_tax_on_fee_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF (NEW.shipping_charge IS DISTINCT FROM OLD.shipping_charge OR NEW.cod_surcharge IS DISTINCT FROM OLD.cod_surcharge)
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
CREATE TRIGGER trg_recompute_tax_on_fee_change AFTER UPDATE OF shipping_charge, cod_surcharge ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_tax_on_fee_change();
