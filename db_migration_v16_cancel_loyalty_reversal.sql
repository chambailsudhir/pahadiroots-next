-- ─────────────────────────────────────────────────────────────────────────────
-- v16 — customer self-cancellation (account audit, Nov 2026, ACC-050)
--
-- When a COD order is cancelled before dispatch the database already restores stock
-- (handle_order_status_change → RELEASE/RETURN movement) and reverses the finance journal
-- (journal_reverse_on_cancel). Two things were NOT covered anywhere:
--   • coins the customer REDEEMED on the order must be given back
--   • coins EARNED at placement (COD orders are credited immediately) must be taken back
-- This function does both atomically, exactly once per order (idempotent), and never lets a balance go
-- below zero (if the customer already spent the earned coins elsewhere, only what is left is reclaimed).
-- Ledger rows use type 'adjustment' (already allowed by the CHECK constraint) with a 'Reversal:' note.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reverse_loyalty_for_order(p_order_id bigint, p_note text DEFAULT 'order cancelled')
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer  bigint;
  v_earned    integer := 0;
  v_redeemed  integer := 0;
  v_balance   integer;
  v_take      integer := 0;
BEGIN
  SELECT customer_id INTO v_customer FROM orders WHERE id = p_order_id;
  IF v_customer IS NULL THEN
    RETURN json_build_object('reversed', false, 'reason', 'order_not_found');
  END IF;

  -- Lock the customer row first so two concurrent calls serialise, THEN check the once-only guard.
  SELECT COALESCE(loyalty_points, 0) INTO v_balance FROM customers WHERE id = v_customer FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('reversed', false, 'reason', 'customer_not_found');
  END IF;

  IF EXISTS (SELECT 1 FROM loyalty_transactions WHERE order_id = p_order_id AND type = 'adjustment' AND note LIKE 'Reversal:%') THEN
    RETURN json_build_object('reversed', false, 'reason', 'already_reversed');
  END IF;

  SELECT COALESCE(SUM(points), 0)  INTO v_earned   FROM loyalty_transactions WHERE order_id = p_order_id AND type = 'earn';
  SELECT COALESCE(-SUM(points), 0) INTO v_redeemed FROM loyalty_transactions WHERE order_id = p_order_id AND type = 'redeem';   -- redeem rows are negative

  IF v_earned <= 0 AND v_redeemed <= 0 THEN
    RETURN json_build_object('reversed', false, 'reason', 'nothing_to_reverse');
  END IF;

  -- 1) give back what the customer spent on this order
  IF v_redeemed > 0 THEN
    v_balance := v_balance + v_redeemed;
    INSERT INTO loyalty_transactions (customer_id, order_id, type, points, balance_after, note)
    VALUES (v_customer, p_order_id, 'adjustment', v_redeemed, v_balance, 'Reversal: coins refunded — ' || p_note);
  END IF;

  -- 2) take back what this order earned (never below zero)
  IF v_earned > 0 THEN
    v_take    := LEAST(v_earned, v_balance);
    IF v_take > 0 THEN
      v_balance := v_balance - v_take;
      INSERT INTO loyalty_transactions (customer_id, order_id, type, points, balance_after, note)
      VALUES (v_customer, p_order_id, 'adjustment', -v_take, v_balance, 'Reversal: earned coins removed — ' || p_note);
    END IF;
  END IF;

  UPDATE customers SET loyalty_points = v_balance WHERE id = v_customer;

  RETURN json_build_object('reversed', true, 'refunded_redeemed', v_redeemed, 'removed_earned', v_take, 'balance', v_balance);
END;
$function$;

-- Only the service role (the Next.js API) may call it.
REVOKE ALL ON FUNCTION public.reverse_loyalty_for_order(bigint, text) FROM PUBLIC, anon, authenticated;
