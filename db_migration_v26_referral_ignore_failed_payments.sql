-- db_migration_v26_referral_ignore_failed_payments.sql
-- A `payment_failed` order (an abandoned / expired online payment) is NOT a purchase. attach_referral and process_referral_rewards
-- only excluded 'cancelled', so:
--   * a new customer who once closed the Razorpay modal was refused a friend's code ("not_new_customer"), and
--   * if the code had been applied before such an attempt, that never-delivered order was picked as "the first order", so the
--     referral waited until it expired and BOTH sides lost the reward even after a later delivered order.
-- Idempotent: patches the LIVE function text in place (so nothing else about either function can drift), CREATE OR REPLACE keeps the grants.
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.attach_referral(bigint,text)'::regprocedure);
  d := replace(d, 'AND order_status::text <> ''cancelled'')', 'AND order_status::text NOT IN (''cancelled'', ''payment_failed''))');
  IF position('payment_failed' in d) = 0 THEN RAISE EXCEPTION 'attach_referral: expected clause not found'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.process_referral_rewards(integer)'::regprocedure);
  d := replace(d, 'AND order_status::text <> ''cancelled'' ORDER BY created_at LIMIT 1', 'AND order_status::text NOT IN (''cancelled'', ''payment_failed'') ORDER BY created_at LIMIT 1');
  IF position('payment_failed' in d) = 0 THEN RAISE EXCEPTION 'process_referral_rewards: expected clause not found'; END IF;
  EXECUTE d;
END
$mig$;
