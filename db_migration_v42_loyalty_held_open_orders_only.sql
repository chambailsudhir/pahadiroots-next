-- db_migration_v42 — coins "held" by an order are only those of a genuinely OPEN order (verification, Nov 2026).
-- v38 counted every order that was not cancelled/returned/refunded/failed and had no 'redeem' row as holding its coins — that
-- included delivered, replaced and refund_initiated orders and shop-deleted (is_deleted) ones. One deleted, delivered order with
-- 51 coins on it made a customer's coins never expire and never get a reminder. Held = open statuses only, deleted excluded.
-- loyalty_expiry_schedule and expire_old_loyalty_points read `held` from this function, so both follow.
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
       AND o.order_status IN ('pending', 'confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery')
       AND NOT COALESCE(o.is_deleted, false)
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
