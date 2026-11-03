-- db_migration_v27_release_coupon_on_order_end.sql  (APPLIED to production, after a rolled-back scenario test)
-- Coupons were released only by the customer-cancel route and the pending-order sweep. An order cancelled by an admin (or failed by any
-- other writer) kept its coupon_usage row and uses_count, so a user_limit=1 coupon was lost for good and a max_uses slot stayed burned.
-- Mirrors trg_reverse_loyalty_on_order_end. Only for orders that never reached the customer (cancelled / payment_failed); returns and
-- refunds are a policy decision and are intentionally NOT released here. release_coupon_for_order is idempotent (no row => released:false).
CREATE OR REPLACE FUNCTION public.trg_release_coupon_on_order_end() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $f$
BEGIN
  IF NEW.order_status IS DISTINCT FROM OLD.order_status
     AND NEW.order_status::text IN ('cancelled', 'payment_failed') THEN
    BEGIN
      PERFORM public.release_coupon_for_order(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'coupon release failed for order %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_release_coupon_on_order_end ON public.orders;
CREATE TRIGGER trg_release_coupon_on_order_end AFTER UPDATE OF order_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_release_coupon_on_order_end();
