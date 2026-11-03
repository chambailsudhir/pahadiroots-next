-- db_migration_v28_award_loyalty_on_delivered.sql  (APPLIED to production, after a rolled-back scenario test)
-- Owner decision (Nov 2026): Pahadi Coins are earned ONLY when an order is DELIVERED (COD and online alike), a FLAT 5 coins per order
-- (admin setting site_settings.loyalty_coins_per_order, default 5; 0 disables), and are taken back if the order is returned or refunded
-- (trg_reverse_loyalty_on_order_end, v19, already does that). Before this, coins were awarded at placement (COD) / payment (online) as
-- floor(total x rate) and could be spent on the next order straight away.
-- Registered accounts only (auth_user_id NOT NULL): a guest row earns nothing. award_loyalty_points is idempotent per order, so an order
-- that already earned at placement (before this change) is not paid twice.
CREATE OR REPLACE FUNCTION public.trg_award_loyalty_on_delivered() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
DECLARE v_enabled text; v_registered boolean; v_raw text; v_pts integer;
BEGIN
  IF NEW.order_status IS DISTINCT FROM OLD.order_status
     AND NEW.order_status::text = 'delivered'
     AND NEW.customer_id IS NOT NULL THEN
    BEGIN
      SELECT value INTO v_enabled FROM site_settings WHERE key = 'loyalty_enabled';
      IF COALESCE(v_enabled, 'true') <> 'false' THEN
        SELECT (auth_user_id IS NOT NULL) INTO v_registered FROM customers WHERE id = NEW.customer_id;
        IF COALESCE(v_registered, false) THEN
          SELECT btrim(value) INTO v_raw FROM site_settings WHERE key = 'loyalty_coins_per_order';
          v_pts := CASE WHEN v_raw ~ '^[0-9]+$' THEN v_raw::integer ELSE 5 END;
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
DROP TRIGGER IF EXISTS trg_award_loyalty_on_delivered ON public.orders;
CREATE TRIGGER trg_award_loyalty_on_delivered AFTER UPDATE OF order_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_award_loyalty_on_delivered();
