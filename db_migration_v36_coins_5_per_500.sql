-- db_migration_v36 — coin rule changed by the owner (Nov 2026): NO coins below ₹500; then `loyalty_coins_per_step` coins
-- (default 5) for every full ₹`loyalty_coin_step_rupees` (default 500) of the order value, with NO per-order limit unless
-- `loyalty_coins_per_order` is set (a number > 0 caps it, 0 switches earning off). 1 coin = ₹1, so 1% back.
--   ₹499 → 0 · ₹500 → 5 · ₹999 → 5 · ₹1,000 → 10 · ₹3,000 → 30.
-- One SQL function holds the formula; the delivery trigger and the safety net both use it (same rule as src/lib/loyaltyCoins.ts).
-- The safety net only picks orders that earn something: a ₹200 order (0 coins) would otherwise stay a "missing coins" candidate
-- forever and, with LIMIT 50, starve the orders that really need their coins.
CREATE OR REPLACE FUNCTION public.delivery_coins_for(p_total numeric) RETURNS integer
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE v_raw text; v_step integer; v_per integer; v_max integer; v_pts integer;
BEGIN
  SELECT btrim(value) INTO v_raw FROM site_settings WHERE key = 'loyalty_coins_per_order';
  v_max := CASE WHEN v_raw ~ '^[0-9]+$' THEN v_raw::integer ELSE NULL END;     -- NULL / blank = no limit
  IF v_max = 0 THEN RETURN 0; END IF;
  SELECT btrim(value) INTO v_raw FROM site_settings WHERE key = 'loyalty_coin_step_rupees';
  v_step := CASE WHEN v_raw ~ '^[0-9]+$' AND v_raw::integer >= 1 THEN v_raw::integer ELSE 500 END;
  SELECT btrim(value) INTO v_raw FROM site_settings WHERE key = 'loyalty_coins_per_step';
  v_per := CASE WHEN v_raw ~ '^[0-9]+$' THEN v_raw::integer ELSE 5 END;
  v_pts := FLOOR(COALESCE(p_total, 0) / v_step)::integer * v_per;
  IF v_max IS NOT NULL THEN v_pts := LEAST(v_pts, v_max); END IF;
  RETURN GREATEST(v_pts, 0);
END $f$;
REVOKE EXECUTE ON FUNCTION public.delivery_coins_for(numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.delivery_coins_for(numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_award_loyalty_on_delivered() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_enabled text; v_registered boolean; v_pts integer;
BEGIN
  IF NEW.order_status IS DISTINCT FROM OLD.order_status
     AND NEW.order_status::text = 'delivered'
     AND NEW.customer_id IS NOT NULL THEN
    BEGIN
      SELECT value INTO v_enabled FROM site_settings WHERE key = 'loyalty_enabled';
      IF COALESCE(v_enabled, 'true') <> 'false' THEN
        SELECT (auth_user_id IS NOT NULL) INTO v_registered FROM customers WHERE id = NEW.customer_id;
        IF COALESCE(v_registered, false) THEN
          v_pts := public.delivery_coins_for(NEW.total_amount);
          IF v_pts > 0 THEN
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
DECLARE r record; v_n integer := 0; v_en text;
BEGIN
  SELECT value INTO v_en FROM site_settings WHERE key = 'loyalty_enabled';
  IF COALESCE(v_en, 'true') = 'false' THEN RETURN 0; END IF;
  FOR r IN
    SELECT o.id, o.customer_id, public.delivery_coins_for(o.total_amount) AS pts
      FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.order_status::text = 'delivered' AND NOT COALESCE(o.is_deleted, false)
       AND c.auth_user_id IS NOT NULL
       AND o.delivered_at > now() - interval '14 days'
       AND public.delivery_coins_for(o.total_amount) > 0
       AND NOT EXISTS (SELECT 1 FROM loyalty_transactions t WHERE t.order_id = o.id AND t.type = 'earn')
       AND NOT EXISTS (SELECT 1 FROM loyalty_transactions t WHERE t.order_id = o.id AND t.note LIKE 'Reversal:%')
     ORDER BY o.delivered_at LIMIT GREATEST(p_limit, 1)
  LOOP
    BEGIN
      PERFORM public.award_loyalty_points(r.customer_id, r.id, r.pts, 'Earned on delivery');
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'award_missing_delivery_coins: order % skipped: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END $f$;
REVOKE EXECUTE ON FUNCTION public.award_missing_delivery_coins(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.award_missing_delivery_coins(integer) TO service_role;
