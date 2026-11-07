-- db_migration_v37 — Pahadi Coins expire 12 months after they are earned (owner decision, Nov 2026).
-- Setting `loyalty_expiry_days` (default 365; 0 = coins never expire). Run daily by the expire-pending-orders cron.
-- FIFO: everything a customer has ever spent, had expired or had reversed is taken from their OLDEST coins first, so
--   to expire now = (coins credited before the cut-off) − (all coins ever debited), at least 0 and never more than the balance.
-- A customer who keeps using coins therefore never loses any; only coins left unused for a year go. Each expiry is one 'expire'
-- ledger row (negative points) written under the customer row lock, exactly like award_loyalty_points / redeem_loyalty_points.
CREATE OR REPLACE FUNCTION public.expire_old_loyalty_points(p_limit integer DEFAULT 200) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_raw text; v_days integer; v_cutoff timestamptz; r record; v_bal integer; v_credit_old integer; v_debit integer;
        v_expire integer; v_n integer := 0;
BEGIN
  SELECT btrim(value) INTO v_raw FROM site_settings WHERE key = 'loyalty_expiry_days';
  v_days := CASE WHEN v_raw ~ '^[0-9]+$' THEN v_raw::integer ELSE 365 END;
  IF v_days = 0 THEN RETURN 0; END IF;
  v_cutoff := now() - make_interval(days => v_days);

  -- Only customers with something to expire are picked (a fully spent history would otherwise stay a candidate forever and, with
  -- the LIMIT, starve the customers whose coins really are due).
  FOR r IN
    SELECT c.id FROM customers c
      JOIN LATERAL (
        SELECT COALESCE(SUM(t.points) FILTER (WHERE t.points > 0 AND t.created_at < v_cutoff), 0)
             + COALESCE(SUM(t.points) FILTER (WHERE t.points < 0), 0) AS due
          FROM loyalty_transactions t WHERE t.customer_id = c.id
      ) d ON d.due > 0
     WHERE COALESCE(c.loyalty_points, 0) > 0
     ORDER BY c.id LIMIT GREATEST(p_limit, 1)
  LOOP
    SELECT COALESCE(loyalty_points, 0) INTO v_bal FROM customers WHERE id = r.id FOR UPDATE;
    SELECT COALESCE(SUM(points) FILTER (WHERE points > 0 AND created_at < v_cutoff), 0),
           COALESCE(-SUM(points) FILTER (WHERE points < 0), 0)
      INTO v_credit_old, v_debit
      FROM loyalty_transactions WHERE customer_id = r.id;
    v_expire := LEAST(v_bal, GREATEST(0, v_credit_old - v_debit));
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
