-- db_migration_v41 — coin expiry reminders only name FUTURE expiry dates (Nov 2026 review R6-4). Applied 7 Nov 2026.
-- loyalty_expiry_reminder_candidates (v40) took MIN(expires_on) <= today + 15 with no lower bound: if expire_old_loyalty_points
-- failed or its 200-customer limit left someone unprocessed, the mail said coins "will expire on" a date already past.
-- Same signature and body as v40 apart from the lower bound; EXECUTE stays service_role-only.
CREATE OR REPLACE FUNCTION public.loyalty_expiry_reminder_candidates(p_within_days integer DEFAULT 15, p_limit integer DEFAULT 10)
 RETURNS TABLE(customer_id bigint, email text, first_name text, expires_on date, coins integer, balance integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.id, c.email::text, c.first_name::text, s.first_on, s.total::integer, COALESCE(c.loyalty_points, 0)::integer
    FROM customers c
    CROSS JOIN LATERAL (
      SELECT MIN(x.expires_on) AS first_on, SUM(x.coins) AS total
        FROM public.loyalty_expiry_schedule(c.id, 10) x
       WHERE x.expires_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date + GREATEST(p_within_days, 1)
         AND x.expires_on >  (now() AT TIME ZONE 'Asia/Kolkata')::date
    ) s
   WHERE COALESCE(c.loyalty_points, 0) > 0
     AND c.auth_user_id IS NOT NULL AND NOT COALESCE(c.is_deleted, false)
     AND c.email LIKE '%@%' AND c.notif_email_orders IS DISTINCT FROM false
     AND s.first_on IS NOT NULL AND s.total > 0
     AND NOT EXISTS (SELECT 1 FROM loyalty_expiry_reminders r WHERE r.customer_id = c.id
                       AND (r.expires_on = s.first_on OR r.sent_at > now() - interval '7 days'))
   ORDER BY s.first_on, c.id
   LIMIT GREATEST(p_limit, 1)
$function$;
REVOKE EXECUTE ON FUNCTION public.loyalty_expiry_reminder_candidates(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.loyalty_expiry_reminder_candidates(integer, integer) TO service_role;
