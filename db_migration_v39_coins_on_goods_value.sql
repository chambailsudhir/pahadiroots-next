-- db_migration_v39 — coins and the referral minimum are measured on the GOODS value (owner decision Nov 2026, review round 5).
-- Goods value = total_amount − shipping_charge − cod_surcharge. Coupon, prepaid discount and coins are already off total_amount,
-- so delivery charges and the COD fee never earn coins and never help a ₹950 cart cross the ₹999 referral minimum.
-- Same formula as coinBaseValue() in src/lib/loyaltyCoins.ts.
CREATE OR REPLACE FUNCTION public.order_goods_value(p_total numeric, p_shipping numeric, p_cod numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $f$
  SELECT GREATEST(0, COALESCE(p_total, 0) - GREATEST(COALESCE(p_shipping, 0), 0) - GREATEST(COALESCE(p_cod, 0), 0))
$f$;
REVOKE EXECUTE ON FUNCTION public.order_goods_value(numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.order_goods_value(numeric, numeric, numeric) TO service_role;

-- Patch the three callers in place (definitions otherwise unchanged). Each replacement must hit exactly once or the migration aborts.
DO $m$
DECLARE v_def text; v_new text; f record;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('public.trg_award_loyalty_on_delivered()'::regprocedure,
       'delivery_coins_for(NEW.total_amount)',
       'delivery_coins_for(public.order_goods_value(NEW.total_amount, NEW.shipping_charge, NEW.cod_surcharge))'),
      ('public.award_missing_delivery_coins(integer)'::regprocedure,
       'delivery_coins_for(o.total_amount)',
       'delivery_coins_for(public.order_goods_value(o.total_amount, o.shipping_charge, o.cod_surcharge))'),
      ('public.process_referral_rewards(integer)'::regprocedure,
       'COALESCE(o.total_amount, 0) < v_min_order',
       'public.order_goods_value(o.total_amount, o.shipping_charge, o.cod_surcharge) < v_min_order')
    ) AS t(fn, old_s, new_s)
  LOOP
    v_def := pg_get_functiondef(f.fn);
    IF position(f.new_s IN v_def) > 0 THEN CONTINUE; END IF;                    -- already applied
    IF position(f.old_s IN v_def) = 0 THEN RAISE EXCEPTION 'v39: % does not contain %', f.fn, f.old_s; END IF;
    v_new := replace(v_def, f.old_s, f.new_s);
    EXECUTE v_new;
  END LOOP;
END $m$;
