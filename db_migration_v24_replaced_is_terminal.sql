-- ─────────────────────────────────────────────────────────────────────────────
-- v24 — a REPLACED return is finished, so a damaged replacement can be returned (returns audit, Nov 2026)
--
-- Problem (live, found by the orders audit): the unique index ux_returns_active_order_item only exempted
-- 'refunded' and 'rejected', and guard_return_item counted every non-rejected return against the quantity bought.
-- A customer whose replacement unit arrived damaged could never raise a new return for it: the INSERT hit the unique
-- index / the quantity guard and the customer saw a generic failure.
--
-- Policy (what the big marketplaces do — a defective replacement can be returned / refunded): once a return is
-- 'replaced' the customer holds a NEW unit, so
--   1) 'replaced' no longer occupies the (order, item) slot of the unique index, and
--   2) the units of a 'replaced' return no longer count against the quantity that can still be returned.
-- A refunded return still counts (the customer no longer has those units), exactly as before.
--
-- Additive in behaviour, tiny table (a few rows). Both statements run in one transaction.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.ux_returns_active_order_item;
CREATE UNIQUE INDEX ux_returns_active_order_item
  ON public.returns USING btree (order_id, COALESCE(variant_id, ((-1))::bigint))
  WHERE (status <> ALL (ARRAY['refunded'::text, 'rejected'::text, 'replaced'::text]));

-- guard_return_item: the LIVE source (2026-11-03) with ONE change — 'replaced' returns are not counted as "already returned".
CREATE OR REPLACE FUNCTION public.guard_return_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_ordered numeric; v_other numeric;
BEGIN
  IF NEW.variant_id IS NULL OR NEW.status = 'rejected' OR NEW.order_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.variant_id IS NOT DISTINCT FROM OLD.variant_id
     AND NEW.quantity   IS NOT DISTINCT FROM OLD.quantity
     AND NOT (OLD.status = 'rejected') THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM public.orders WHERE id = NEW.order_id FOR UPDATE;

  SELECT SUM(oi.quantity) INTO v_ordered FROM public.order_items oi
   WHERE oi.order_id = NEW.order_id AND oi.variant_id = NEW.variant_id;
  IF v_ordered IS NULL THEN
    RAISE EXCEPTION 'Variant % is not on order % — a return can only be for an item the customer bought', NEW.variant_id, NEW.order_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- v24: a 'replaced' return handed the customer a new unit, so it does not use up the returnable quantity.
  SELECT COALESCE(SUM(COALESCE(r.quantity, 1)), 0) INTO v_other FROM public.returns r
   WHERE r.order_id = NEW.order_id AND r.variant_id = NEW.variant_id AND r.status NOT IN ('rejected', 'replaced') AND r.id IS DISTINCT FROM NEW.id;
  IF COALESCE(NEW.quantity, 1) + v_other > v_ordered THEN
    RAISE EXCEPTION 'Return quantity % is more than can still be returned for this item (bought %, already in other returns %)',
      COALESCE(NEW.quantity, 1), v_ordered, v_other USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;
