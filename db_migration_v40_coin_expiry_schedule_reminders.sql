-- db_migration_v40 — "your coins expire soon" (owner request Nov 2026).
--   loyalty_expiry_schedule(customer)   → the next dates on which this customer's coins expire, and how many (account page).
--   loyalty_expiry_reminder_candidates() → customers to remind ~15 days ahead (daily cron, lib/server/coinExpiryReminders.ts).
--   loyalty_expiry_reminders            → one row per (customer, expiry date) e-mailed, so nobody is mailed twice for one batch.
-- The schedule walks the ledger exactly like expire_old_loyalty_points (v38): same exclusions (cancel-refunded redeems, reversed
-- earns), coin age from GREATEST(earned, loyalty_expiry_start), coins promised to open orders spent first, oldest coins spent first.
-- A batch expires at the first nightly run (03:00 UTC = 08:30 IST) AFTER earned + loyalty_expiry_days.

CREATE TABLE IF NOT EXISTS public.loyalty_expiry_reminders (
  id          bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  expires_on  date   NOT NULL,
  coins       integer NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, expires_on)
);
ALTER TABLE public.loyalty_expiry_reminders ENABLE ROW LEVEL SECURITY;   -- deny-all; server (service_role) only
REVOKE ALL ON public.loyalty_expiry_reminders FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.loyalty_expiry_reminders TO service_role;
GRANT USAGE ON SEQUENCE public.loyalty_expiry_reminders_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.loyalty_expiry_schedule(p_customer bigint, p_limit integer DEFAULT 3)
RETURNS TABLE (expires_on date, coins integer)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $f$
DECLARE v_raw text; v_days integer; v_start timestamptz; v_bal integer; v_held integer; v_debit integer; v_cap integer;
        c record; v_rem integer; v_take integer; v_t timestamptz; v_run timestamptz; v_day date;
        v_cur date := NULL; v_sum integer := 0; v_rows integer := 0;
BEGIN
  SELECT btrim(value) INTO v_raw FROM site_settings WHERE key = 'loyalty_expiry_days';
  v_days := CASE WHEN v_raw ~ '^[0-9]+$' THEN v_raw::integer ELSE 120 END;
  IF v_days = 0 THEN RETURN; END IF;
  SELECT btrim(value) INTO v_raw FROM site_settings WHERE key = 'loyalty_expiry_start';
  v_start := CASE WHEN v_raw ~ '^\d{4}-\d{2}-\d{2}$' THEN (v_raw || ' 00:00:00+05:30')::timestamptz ELSE '2026-11-07 00:00:00+05:30'::timestamptz END;

  SELECT COALESCE(loyalty_points, 0) INTO v_bal FROM customers WHERE id = p_customer;
  IF COALESCE(v_bal, 0) <= 0 THEN RETURN; END IF;
  SELECT held INTO v_held FROM public.loyalty_expiry_due(p_customer, now(), v_start);
  v_held := COALESCE(v_held, 0);
  v_cap := GREATEST(0, v_bal - v_held);
  IF v_cap = 0 THEN RETURN; END IF;

  -- Everything spent (same exclusions as loyalty_expiry_due) plus coins held for open orders comes off the OLDEST coins first.
  SELECT COALESCE(-SUM(t.points), 0)::integer INTO v_debit
    FROM loyalty_transactions t
   WHERE t.customer_id = p_customer AND t.points < 0 AND COALESCE(t.note, '') NOT LIKE 'Reversal:%'
     AND NOT (t.type = 'redeem' AND t.order_id IN (
           SELECT x.order_id FROM loyalty_transactions x WHERE x.customer_id = p_customer AND x.type = 'adjustment'
              AND x.points > 0 AND x.note LIKE 'Reversal: coins refunded%' AND x.order_id IS NOT NULL));
  v_debit := v_debit + v_held;

  FOR c IN
    SELECT t.points, GREATEST(t.created_at, v_start) AS eff
      FROM loyalty_transactions t
     WHERE t.customer_id = p_customer AND t.points > 0 AND COALESCE(t.note, '') NOT LIKE 'Reversal:%'
       AND NOT (t.type = 'earn' AND t.order_id IN (
             SELECT x.order_id FROM loyalty_transactions x WHERE x.customer_id = p_customer AND x.type = 'adjustment'
                AND x.points < 0 AND x.note LIKE 'Reversal: earned coins removed%' AND x.order_id IS NOT NULL))
     ORDER BY GREATEST(t.created_at, v_start), t.id
  LOOP
    v_rem := c.points;
    v_take := LEAST(v_rem, v_debit); v_rem := v_rem - v_take; v_debit := v_debit - v_take;
    CONTINUE WHEN v_rem <= 0;
    v_rem := LEAST(v_rem, v_cap); v_cap := v_cap - v_rem;
    v_t := c.eff + make_interval(days => v_days);
    v_run := date_trunc('day', v_t AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '3 hours';
    IF v_run <= v_t THEN v_run := v_run + interval '1 day'; END IF;
    v_day := (v_run AT TIME ZONE 'Asia/Kolkata')::date;
    IF v_cur IS NOT NULL AND v_day <> v_cur THEN
      expires_on := v_cur; coins := v_sum; RETURN NEXT; v_rows := v_rows + 1;
      IF v_rows >= GREATEST(p_limit, 1) THEN RETURN; END IF;
      v_sum := 0;
    END IF;
    v_cur := v_day; v_sum := v_sum + v_rem;
    EXIT WHEN v_cap <= 0;
  END LOOP;
  IF v_cur IS NOT NULL AND v_sum > 0 THEN expires_on := v_cur; coins := v_sum; RETURN NEXT; END IF;
END $f$;
REVOKE EXECUTE ON FUNCTION public.loyalty_expiry_schedule(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.loyalty_expiry_schedule(bigint, integer) TO service_role;

-- Registered customers with an e-mail address and order e-mails on, whose next batch expires within p_within_days (IST dates),
-- not yet reminded for that date and not reminded at all in the last 7 days. `coins` = everything expiring inside the window.
CREATE OR REPLACE FUNCTION public.loyalty_expiry_reminder_candidates(p_within_days integer DEFAULT 15, p_limit integer DEFAULT 10)
RETURNS TABLE (customer_id bigint, email text, first_name text, expires_on date, coins integer, balance integer)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $f$
  SELECT c.id, c.email::text, c.first_name::text, s.first_on, s.total::integer, COALESCE(c.loyalty_points, 0)::integer
    FROM customers c
    CROSS JOIN LATERAL (
      SELECT MIN(x.expires_on) AS first_on, SUM(x.coins) AS total
        FROM public.loyalty_expiry_schedule(c.id, 10) x
       WHERE x.expires_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date + GREATEST(p_within_days, 1)
    ) s
   WHERE COALESCE(c.loyalty_points, 0) > 0
     AND c.auth_user_id IS NOT NULL AND NOT COALESCE(c.is_deleted, false)
     AND c.email LIKE '%@%' AND c.notif_email_orders IS DISTINCT FROM false
     AND s.first_on IS NOT NULL AND s.total > 0
     AND NOT EXISTS (SELECT 1 FROM loyalty_expiry_reminders r WHERE r.customer_id = c.id
                       AND (r.expires_on = s.first_on OR r.sent_at > now() - interval '7 days'))
   ORDER BY s.first_on, c.id
   LIMIT GREATEST(p_limit, 1)
$f$;
REVOKE EXECUTE ON FUNCTION public.loyalty_expiry_reminder_candidates(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.loyalty_expiry_reminder_candidates(integer, integer) TO service_role;
