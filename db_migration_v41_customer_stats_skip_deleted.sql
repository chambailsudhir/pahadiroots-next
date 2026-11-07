-- db_migration_v41 — the account page's order stats ignore orders the shop deleted (is_deleted), like the order list (Nov 2026).
CREATE OR REPLACE FUNCTION public.get_customer_order_stats(p_customer_id bigint)
 RETURNS TABLE(delivered bigint, active bigint, cancelled bigint, spent numeric, loyalty_points integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    count(*) filter (where order_status = 'delivered') as delivered,
    count(*) filter (
      where order_status in ('pending', 'confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery')
    ) as active,
    count(*) filter (where order_status = 'cancelled') as cancelled,
    coalesce(
      sum(total_amount) filter (
        where order_status not in ('cancelled', 'payment_failed', 'returned', 'refund_initiated', 'refund_completed', 'refunded')
      ),
      0
    ) as spent,
    (select coalesce(c.loyalty_points, 0) from customers c where c.id = p_customer_id) as loyalty_points
  from orders
  where customer_id = p_customer_id and not coalesce(is_deleted, false)
$function$;
