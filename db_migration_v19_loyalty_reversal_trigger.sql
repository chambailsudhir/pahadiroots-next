-- ─────────────────────────────────────────────────────────────────────────────
-- v19 — loyalty reversal on every cancel / return / refund path (orders audit, Nov 2026, finding #5)
--
-- NOT APPLIED — maintainer applies after review. Additive and idempotent.
--
-- Problem: reverse_loyalty_for_order() (v16) is only called by the customer self-cancel route. Admin
-- cancel, RTO/return and refund flows (admin app, other repo) never gave redeemed coins back nor took
-- earned coins away, and award_loyalty_points() never looked at the order status, so a late award
-- (e.g. the ACC-032 recovery path) could credit coins on an already-cancelled order.
--
-- 1) AFTER UPDATE OF order_status trigger on public.orders -> reverse_loyalty_for_order() when the
--    status becomes cancelled / returned / refunded / refund_completed. The function is idempotent
--    (one 'Reversal:' ledger row set per order, 'already_reversed' afterwards) so the self-cancel route
--    calling it as well is harmless. It never lets a balance go below zero and only refunds coins that
--    have a 'redeem' ledger row (a failed redemption refunds nothing -> no free coins).
--    The trigger swallows its own errors: a loyalty problem must never block a status change.
--    Enum values verified against live order_status_enum (2026-11-02).
-- 2) award_loyalty_points(): CREATE OR REPLACE from the LIVE source with one added guard — skip (return
--    the current balance, no ledger row) when the order is cancelled / returned / refunded.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_reverse_loyalty_on_order_end()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.order_status IS DISTINCT FROM OLD.order_status
     AND NEW.order_status::text IN ('cancelled', 'returned', 'refunded', 'refund_completed')
     AND NEW.customer_id IS NOT NULL THEN
    BEGIN
      PERFORM public.reverse_loyalty_for_order(NEW.id, 'order ' || NEW.order_status::text);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'loyalty reversal failed for order %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_reverse_loyalty_on_order_end() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reverse_loyalty_on_order_end ON public.orders;
CREATE TRIGGER trg_reverse_loyalty_on_order_end
  AFTER UPDATE OF order_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_reverse_loyalty_on_order_end();

-- award_loyalty_points: live source + cancelled/returned/refunded guard.
CREATE OR REPLACE FUNCTION public.award_loyalty_points(p_customer_id bigint, p_order_id bigint, p_points integer, p_note text DEFAULT 'Order reward'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_balance INTEGER;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'award_loyalty_points: points must be a positive number (got %)', p_points USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(loyalty_points, 0) INTO v_balance FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'award_loyalty_points: customer % not found', p_customer_id USING ERRCODE = 'P0002';
  END IF;

  -- Already awarded for this order: do nothing, report the current balance.
  IF p_order_id IS NOT NULL AND EXISTS (SELECT 1 FROM loyalty_transactions WHERE order_id = p_order_id AND type = 'earn') THEN
    RETURN v_balance;
  END IF;

  -- NEW (v19): an order that has already ended unsuccessfully earns nothing.
  IF p_order_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM orders WHERE id = p_order_id
          AND order_status::text IN ('cancelled', 'returned', 'refunded', 'refund_completed')) THEN
    RETURN v_balance;
  END IF;

  v_balance := v_balance + p_points;
  UPDATE customers SET loyalty_points = v_balance WHERE id = p_customer_id;

  INSERT INTO loyalty_transactions (customer_id, order_id, type, points, balance_after, note)
  VALUES (p_customer_id, p_order_id, 'earn', p_points, v_balance, p_note);

  IF p_order_id IS NOT NULL THEN
    UPDATE orders SET loyalty_points_earned = p_points WHERE id = p_order_id;
  END IF;

  RETURN v_balance;
END;
$function$;
