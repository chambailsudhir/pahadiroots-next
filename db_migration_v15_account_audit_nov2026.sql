-- ─────────────────────────────────────────────────────────────────────────────
-- v15 — account audit (Nov 2026), ACC-038: "My Orders" summary tiles
--
-- Problems in get_customer_order_stats():
--   • `active` counted only pending/confirmed/packed/shipped. Orders that were `processing` or
--     `out_for_delivery` (the most important ones for the customer!) were in NO tile at all.
--   • The UI labelled `active` "In Transit", so a merely CONFIRMED order showed up as "1 In Transit".
--     (The UI label is now "Active" — see OrdersSection.tsx.)
--   • `spent` excluded only 'cancelled', so payment_failed, returned and refunded orders were
--     summed into "Total Spent".
--
-- Same signature/return type (CREATE OR REPLACE is safe; no dependent objects change).
-- Roll back by re-running the previous definition (status lists below were the old ones).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_customer_order_stats(p_customer_id bigint)
 RETURNS TABLE(delivered bigint, active bigint, cancelled bigint, spent numeric, loyalty_points integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    count(*) filter (where order_status = 'delivered') as delivered,

    count(*) filter (
      where order_status in ('pending', 'confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery')
    ) as active,

    count(*) filter (where order_status = 'cancelled') as cancelled,

    -- money the customer actually spent: not cancelled, not failed, not returned/refunded
    coalesce(
      sum(total_amount) filter (
        where order_status not in ('cancelled', 'payment_failed', 'returned', 'refund_initiated', 'refund_completed', 'refunded')
      ),
      0
    ) as spent,

    (select coalesce(c.loyalty_points, 0) from customers c where c.id = p_customer_id) as loyalty_points

  from orders
  where customer_id = p_customer_id
$function$;
