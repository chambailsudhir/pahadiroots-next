-- db_migration_v31_coins_by_order_value.sql  (APPLIED to production, after a rolled-back scenario test)
-- Owner decision (Nov 2026): coins are paid on DELIVERY and depend on the ORDER VALUE: 1 coin for every ₹`loyalty_coin_step_rupees`
-- (default ₹200), at least 1, at most `loyalty_coins_per_order` (default 5 = the maximum per order). v28 paid a flat amount.
-- Same formula as src/lib/loyaltyCoins.ts (used by the checkout line and the e-mail). Replaces trg_award_loyalty_on_delivered (v28) and
-- award_missing_delivery_coins (v30); reversal on return / refund (v19) is unchanged.
CREATE OR REPLACE FUNCTION public.trg_award_loyalty_on_delivered() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_enabled text; v_registered boolean; v_raw text; v_max integer; v_step integer; v_pts integer;
BEGIN
  IF NEW.order_status IS DISTINCT FROM OLD.order_status
     AND NEW.order_status::text = 'delivered'
     AND NEW.customer_id IS NOT NULL THEN
    BEGIN
      SELECT value INTO v_enabled FROM site_settings WHERE key = 'loyalty_enabled';
      IF COALESCE(v_enabled, 'true') <> 'false' THEN
        SELECT (auth_user_id IS NOT NULL) INTO v_registered FROM customers WHERE id = NEW.customer_id;
        IF COALESCE(v_registered, false) THEN
          SELECT btrim(value) INTO v_raw FROM site_settings WHERE key = 'loyalty_coins_per_order';
          v_max := CASE WHEN v_raw ~ '^[0-9]+$' THEN v_raw::integer ELSE 5 END;
          SELECT btrim(value) INTO v_raw FROM site_settings WHERE key = 'loyalty_coin_step_rupees';
          v_step := CASE WHEN v_raw ~ '^[0-9]+$' AND v_raw::integer >= 1 THEN v_raw::integer ELSE 200 END;
          IF v_max > 0 THEN
            v_pts := LEAST(v_max, GREATEST(1, FLOOR(COALESCE(NEW.total_amount, 0) / v_step)::integer));
            PERFORM public.award_loyalty_points(NEW.customer_id, NEW.id, v_pts, 'Earned on delivery');
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'delivery coins failed for order %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $f$;

CREATE OR REPLACE FUNCTION public.award_missing_delivery_coins(p_limit integer DEFAULT 50) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE r record; v_n integer := 0; v_max integer; v_step integer; v_raw text; v_en text;
BEGIN
  SELECT value INTO v_en FROM site_settings WHERE key = 'loyalty_enabled';
  IF COALESCE(v_en, 'true') = 'false' THEN RETURN 0; END IF;
  SELECT btrim(value) INTO v_raw FROM site_settings WHERE key = 'loyalty_coins_per_order';
  v_max := CASE WHEN v_raw ~ '^[0-9]+$' THEN v_raw::integer ELSE 5 END;
  SELECT btrim(value) INTO v_raw FROM site_settings WHERE key = 'loyalty_coin_step_rupees';
  v_step := CASE WHEN v_raw ~ '^[0-9]+$' AND v_raw::integer >= 1 THEN v_raw::integer ELSE 200 END;
  IF v_max <= 0 THEN RETURN 0; END IF;
  FOR r IN
    SELECT o.id, o.customer_id, o.total_amount
      FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.order_status::text = 'delivered' AND NOT COALESCE(o.is_deleted, false)
       AND c.auth_user_id IS NOT NULL
       AND o.delivered_at > now() - interval '14 days'
       AND NOT EXISTS (SELECT 1 FROM loyalty_transactions t WHERE t.order_id = o.id AND t.type = 'earn')
       AND NOT EXISTS (SELECT 1 FROM loyalty_transactions t WHERE t.order_id = o.id AND t.note LIKE 'Reversal:%')
     ORDER BY o.delivered_at LIMIT GREATEST(p_limit, 1)
  LOOP
    BEGIN
      PERFORM public.award_loyalty_points(r.customer_id, r.id,
        LEAST(v_max, GREATEST(1, FLOOR(COALESCE(r.total_amount, 0) / v_step)::integer)), 'Earned on delivery');
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'award_missing_delivery_coins: order % skipped: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END $f$;
