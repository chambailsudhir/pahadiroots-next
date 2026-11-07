-- db_migration_v38 — coin-expiry fixes from review round 5 (Nov 2026). Replaces the v37 calculation.
-- R5-3  No mass expiry: a coin's age is counted from GREATEST(earned_at, loyalty_expiry_start). Coins earned before the rule
--       existed start their clock on the day it was introduced (setting `loyalty_expiry_start`, default 2026-11-07).
-- R5-1  No dodging by cancel: a redeem that was refunded by a cancellation ('Reversal: coins refunded …' for the same order)
--       and that refund cancel each other out — neither counts, so the refunded coins keep their ORIGINAL age.
--       Likewise an earn that was taken back on return/cancel and its 'Reversal: earned coins removed …' row both drop out.
-- R5-2  Coins promised to an open order are safe: coins on an order that is not cancelled/returned/refunded/failed and has no
--       'redeem' ledger row yet (unpaid online, in-flight COD) count as already spent (oldest first) and are never expired.
INSERT INTO site_settings (key, value) VALUES ('loyalty_expiry_start', '2026-11-07') ON CONFLICT (key) DO NOTHING;

-- Coins due to expire for one customer (before capping at the spendable balance). Internal helper.
CREATE OR REPLACE FUNCTION public.loyalty_expiry_due(p_customer bigint, p_cutoff timestamptz, p_start timestamptz)
RETURNS TABLE (due integer, held integer)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  WITH refunded AS (            -- orders whose redeemed coins were given back
    SELECT DISTINCT order_id FROM loyalty_transactions
     WHERE customer_id = p_customer AND type = 'adjustment' AND points > 0 AND note LIKE 'Reversal: coins refunded%' AND order_id IS NOT NULL
  ), unearned AS (              -- orders whose earned coins were taken back
    SELECT DISTINCT order_id FROM loyalty_transactions
     WHERE customer_id = p_customer AND type = 'adjustment' AND points < 0 AND note LIKE 'Reversal: earned coins removed%' AND order_id IS NOT NULL
  ), led AS (
    SELECT t.* FROM loyalty_transactions t
     WHERE t.customer_id = p_customer
       AND COALESCE(t.note, '') NOT LIKE 'Reversal:%'
       AND NOT (t.type = 'redeem' AND t.order_id IN (SELECT order_id FROM refunded))
       AND NOT (t.type = 'earn'   AND t.order_id IN (SELECT order_id FROM unearned))
  ), h AS (
    SELECT COALESCE(SUM(o.loyalty_points_redeemed), 0)::integer AS held
      FROM orders o
     WHERE o.customer_id = p_customer AND COALESCE(o.loyalty_points_redeemed, 0) > 0
       AND o.order_status NOT IN ('cancelled', 'returned', 'refunded', 'refund_completed', 'payment_failed')
       AND NOT EXISTS (SELECT 1 FROM loyalty_transactions r WHERE r.order_id = o.id AND r.type = 'redeem')
  )
  SELECT GREATEST(0,
           COALESCE((SELECT SUM(points) FROM led WHERE points > 0 AND GREATEST(created_at, p_start) < p_cutoff), 0)
         - COALESCE((SELECT -SUM(points) FROM led WHERE points < 0), 0)
         - (SELECT held FROM h))::integer,
         (SELECT held FROM h)
$f$;
REVOKE EXECUTE ON FUNCTION public.loyalty_expiry_due(bigint, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.loyalty_expiry_due(bigint, timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_old_loyalty_points(p_limit integer DEFAULT 200) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_raw text; v_days integer; v_start timestamptz; v_cutoff timestamptz; r record; v_bal integer; d record;
        v_expire integer; v_n integer := 0;
BEGIN
  SELECT btrim(value) INTO v_raw FROM site_settings WHERE key = 'loyalty_expiry_days';
  v_days := CASE WHEN v_raw ~ '^[0-9]+$' THEN v_raw::integer ELSE 120 END;
  IF v_days = 0 THEN RETURN 0; END IF;
  SELECT btrim(value) INTO v_raw FROM site_settings WHERE key = 'loyalty_expiry_start';
  v_start := CASE WHEN v_raw ~ '^\d{4}-\d{2}-\d{2}$' THEN (v_raw || ' 00:00:00+05:30')::timestamptz ELSE '2026-11-07 00:00:00+05:30'::timestamptz END;
  v_cutoff := now() - make_interval(days => v_days);
  IF v_cutoff <= v_start THEN RETURN 0; END IF;     -- nothing can be old enough yet

  FOR r IN
    SELECT c.id FROM customers c, LATERAL public.loyalty_expiry_due(c.id, v_cutoff, v_start) x
     WHERE COALESCE(c.loyalty_points, 0) > 0 AND x.due > 0
     ORDER BY c.id LIMIT GREATEST(p_limit, 1)
  LOOP
    SELECT COALESCE(loyalty_points, 0) INTO v_bal FROM customers WHERE id = r.id FOR UPDATE;
    SELECT * INTO d FROM public.loyalty_expiry_due(r.id, v_cutoff, v_start);
    v_expire := LEAST(GREATEST(0, v_bal - d.held), d.due);
    IF v_expire > 0 THEN
      v_bal := v_bal - v_expire;
      UPDATE customers SET loyalty_points = v_bal WHERE id = r.id;
      INSERT INTO loyalty_transactions (customer_id, order_id, type, points, balance_after, note)
      VALUES (r.id, NULL, 'expire', -v_expire, v_bal, format('Expired: coins not used within %s days', v_days));
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END $f$;
REVOKE EXECUTE ON FUNCTION public.expire_old_loyalty_points(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.expire_old_loyalty_points(integer) TO service_role;
