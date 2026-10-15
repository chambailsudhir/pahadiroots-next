-- ============================================================================
-- v14 — Checkout audit fixes (15 Oct 2026)
--
-- ALREADY APPLIED to the production project (pahadi-roots) on 15 Oct 2026 via the Supabase
-- connector. Kept here for repo history and to rebuild a fresh/staging database. Every statement
-- is idempotent (CREATE OR REPLACE / DROP IF EXISTS / guarded UPDATE / REVOKE) — safe to re-run.
-- ============================================================================

-- F-04 — process_stock_movement: OUT is reservation-backed (available_stock was already deducted by
-- reserve_stock_at_order), so only RESERVE may refuse for lack of stock. Previously a PAID order
-- whose quantity exceeded the remaining stock could not be confirmed.
CREATE OR REPLACE FUNCTION public.process_stock_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_before_stock   INT;
  v_after_stock    INT;
  v_initial        INT;
  v_reserved       INT;
  v_available      INT;
BEGIN
  IF NEW.performed_by = 'system' THEN RETURN NEW; END IF;

  SELECT COALESCE(initial_stock, 0), COALESCE(orders_reserved, 0), COALESCE(available_stock, 0)
  INTO v_initial, v_reserved, v_available
  FROM product_variants WHERE id = NEW.variant_id;

  v_before_stock := v_available;

  IF NEW.type = 'RESERVE' THEN
    IF v_available < NEW.quantity THEN
      RAISE EXCEPTION '[Stock] Not enough stock for variant %. Available: %, Requested: %',
        NEW.variant_id, v_available, NEW.quantity;
    END IF;
  END IF;

  UPDATE product_variants SET
    initial_stock = CASE
      WHEN NEW.type IN ('IN', 'RETURN')  THEN initial_stock + NEW.quantity
      WHEN NEW.type IN ('OUT', 'DAMAGE') THEN GREATEST(0, initial_stock - NEW.quantity)
      WHEN NEW.type = 'ADJUSTMENT'       THEN NEW.quantity
      ELSE initial_stock END,
    orders_reserved = CASE
      WHEN NEW.type = 'RESERVE'           THEN orders_reserved + NEW.quantity
      WHEN NEW.type IN ('RELEASE', 'OUT') THEN GREATEST(0, orders_reserved - NEW.quantity)
      ELSE orders_reserved END,
    available_stock = CASE
      WHEN NEW.type = 'IN'         THEN available_stock + NEW.quantity
      WHEN NEW.type = 'OUT'        THEN GREATEST(0, available_stock)
      WHEN NEW.type = 'RESERVE'    THEN GREATEST(0, available_stock - NEW.quantity)
      WHEN NEW.type = 'RELEASE'    THEN available_stock + NEW.quantity
      WHEN NEW.type = 'RETURN'     THEN available_stock + NEW.quantity
      WHEN NEW.type = 'DAMAGE'     THEN GREATEST(0, available_stock - NEW.quantity)
      WHEN NEW.type = 'ADJUSTMENT' THEN NEW.quantity
      WHEN NEW.type = 'CORRECTION' THEN available_stock + NEW.quantity
      ELSE available_stock END
  WHERE id = NEW.variant_id;

  UPDATE inventory SET
    total_stock = CASE
      WHEN NEW.type IN ('IN', 'RETURN')  THEN total_stock + NEW.quantity
      WHEN NEW.type IN ('OUT', 'DAMAGE') THEN GREATEST(0, total_stock - NEW.quantity)
      WHEN NEW.type = 'ADJUSTMENT'       THEN NEW.quantity
      ELSE total_stock END,
    reserved_stock = CASE
      WHEN NEW.type = 'RESERVE'           THEN reserved_stock + NEW.quantity
      WHEN NEW.type IN ('RELEASE', 'OUT') THEN GREATEST(0, reserved_stock - NEW.quantity)
      ELSE reserved_stock END
  WHERE variant_id = NEW.variant_id;

  SELECT COALESCE(available_stock, 0) INTO v_after_stock FROM product_variants WHERE id = NEW.variant_id;
  NEW.before_stock := v_before_stock;
  NEW.after_stock  := v_after_stock;
  RETURN NEW;
END;
$function$;

-- F-03 — take the two test products off the storefront (order history untouched).
UPDATE public.products SET status = 'draft', is_active = false
WHERE (id = 28 AND name = 'Test') OR (id = 32 AND name = 'Test0');

-- F-11 — client roles get no privileges on order/customer/payment/admin tables (all access is via the
-- service role). coupons keeps SELECT for the coupon-hints route (RLS-scoped); writes revoked.
REVOKE ALL ON TABLE
  public.orders, public.order_items, public.customers, public.payments, public.coupon_usage,
  public.loyalty_transactions, public.order_events, public.order_status_history, public.order_logs,
  public.returns, public.returns_status_history, public.stock_movements, public.webhook_logs,
  public.failed_emails, public.saved_addresses, public.abandoned_carts, public.admin_credentials,
  public.admin_logs, public.admin_audit_log, public.cod_settlements, public.orders_archive,
  public.stock_restore_log
FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.coupons FROM anon, authenticated;

-- F-17 — orders.status (legacy coarse text, CHECK-constrained) mirrors order_status.
CREATE OR REPLACE FUNCTION public.sync_legacy_order_status()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.status := CASE NEW.order_status::text
    WHEN 'confirmed' THEN 'CONFIRMED' WHEN 'processing' THEN 'CONFIRMED' WHEN 'packed' THEN 'CONFIRMED'
    WHEN 'shipped' THEN 'SHIPPED' WHEN 'out_for_delivery' THEN 'SHIPPED' WHEN 'delivered' THEN 'SHIPPED'
    WHEN 'cancelled' THEN 'CANCELLED' WHEN 'returned' THEN 'RETURNED'
    ELSE 'PENDING' END;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_legacy_order_status ON public.orders;
CREATE TRIGGER trg_sync_legacy_order_status
BEFORE INSERT OR UPDATE OF order_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_order_status();
UPDATE public.orders SET order_status = order_status;

-- F-07 — atomic coupon claim: every check + the reservation under one row lock, in one transaction.
CREATE OR REPLACE FUNCTION public.claim_coupon_use(p_coupon_id bigint, p_customer_id bigint DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_c record; v_used integer; v_usage bigint;
BEGIN
  SELECT id, is_active, expires_at, max_uses, uses_count, user_limit
    INTO v_c FROM coupons WHERE id = p_coupon_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'code', 'not_found', 'error', 'Invalid coupon code'); END IF;
  IF NOT COALESCE(v_c.is_active, false) THEN RETURN json_build_object('ok', false, 'code', 'inactive', 'error', 'This coupon is no longer active'); END IF;
  IF v_c.expires_at IS NOT NULL AND v_c.expires_at < now() THEN RETURN json_build_object('ok', false, 'code', 'expired', 'error', 'This coupon has expired'); END IF;
  IF v_c.max_uses IS NOT NULL AND COALESCE(v_c.uses_count, 0) >= v_c.max_uses THEN
    RETURN json_build_object('ok', false, 'code', 'limit_reached', 'error', 'This coupon has reached its usage limit');
  END IF;
  IF v_c.user_limit IS NOT NULL AND p_customer_id IS NOT NULL THEN
    SELECT count(*) INTO v_used FROM coupon_usage WHERE coupon_id = p_coupon_id AND customer_id = p_customer_id;
    IF v_used >= v_c.user_limit THEN
      RETURN json_build_object('ok', false, 'code', 'user_limit', 'error', 'You have already used this coupon');
    END IF;
  END IF;
  UPDATE coupons SET uses_count = COALESCE(uses_count, 0) + 1 WHERE id = p_coupon_id;
  INSERT INTO coupon_usage (coupon_id, order_id, customer_id, discount_amount, used_at)
  VALUES (p_coupon_id, NULL, p_customer_id, 0, now()) RETURNING id INTO v_usage;
  RETURN json_build_object('ok', true, 'usage_id', v_usage);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_coupon_claim(p_usage_id bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_coupon bigint;
BEGIN
  DELETE FROM coupon_usage WHERE id = p_usage_id AND order_id IS NULL RETURNING coupon_id INTO v_coupon;
  IF v_coupon IS NULL THEN RETURN false; END IF;
  UPDATE coupons SET uses_count = GREATEST(0, COALESCE(uses_count, 0) - 1) WHERE id = v_coupon;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_stale_coupon_claims(p_older_than_minutes integer DEFAULT 30)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT id FROM coupon_usage
           WHERE order_id IS NULL AND used_at < now() - make_interval(mins => GREATEST(p_older_than_minutes, 5))
           ORDER BY id
  LOOP
    IF release_coupon_claim(r.id) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_coupon_use(bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_coupon_claim(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_stale_coupon_claims(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_coupon_use(bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_coupon_claim(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_stale_coupon_claims(integer) TO service_role;

-- F-02 / F-05 — stored promo copy corrected to the live rule (free_shipping_min = 0) and the real
-- WELCOME50 terms. Guarded so they only change the known-wrong text.
UPDATE site_settings SET value = '🎁 Use code WELCOME50 · ₹50 off on orders above ₹500'
 WHERE key = 'ticker_1_text' AND value = '🎁 Use code WELCOME50 · ₹50 off your first order';
UPDATE site_settings SET value = 'On all orders'
 WHERE key = 'trust_4_sub' AND value = 'On orders above ₹500';
UPDATE site_settings
   SET value = regexp_replace(value, '(?i)free\s+shipping\s*·?\s*(on\s+)?(orders\s+)?(above|over)\s*(₹|rs\.?\s*)\s*\d+', 'Free shipping on all orders', 'g')
 WHERE key IN ('ticker_2_text','meta_description')
   AND value ~* 'free\s+shipping\s*·?\s*(on\s+)?(orders\s+)?(above|over)\s*(₹|rs\.?\s*)\s*\d+';
