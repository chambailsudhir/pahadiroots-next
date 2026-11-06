-- db_migration_v32_guest_coupon_identity_and_grants.sql
-- Independent verification, 3 Nov 2026 (findings F-2, L-11, L-12, L-13).
--
-- F-2  claim_coupon_use() enforced user_limit only for a verified customer id; a GUEST passed NULL, so the "one person, one time"
--      rule for guests lived only in a non-transactional read in createOrder — two concurrent guest checkouts with the same phone
--      could both claim a one-time coupon. The claim now also carries an identity key (sha-256 of the normalised 10-digit phone,
--      computed by the app) and counts prior uses by customer_id OR identity_key under the same coupon row lock.
-- L-11 Newer functions were created with the Postgres default (EXECUTE to PUBLIC). Not exploitable (no table grants behind them)
--      but against the project rule (migrations 052 / 058): revoke.
-- L-12 product_variants.initial_stock (how many units were bought in) was readable through the anon REST API.
-- L-13 The products RLS policy filtered on status / is_deleted but not is_active.
-- Idempotent.

ALTER TABLE public.coupon_usage ADD COLUMN IF NOT EXISTS identity_key text;
CREATE INDEX IF NOT EXISTS coupon_usage_coupon_identity_idx ON public.coupon_usage (coupon_id, identity_key) WHERE identity_key IS NOT NULL;

DROP FUNCTION IF EXISTS public.claim_coupon_use(bigint, bigint);
CREATE OR REPLACE FUNCTION public.claim_coupon_use(p_coupon_id bigint, p_customer_id bigint DEFAULT NULL, p_identity_key text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_c record; v_used integer; v_usage bigint; v_key text;
BEGIN
  v_key := NULLIF(btrim(COALESCE(p_identity_key, '')), '');
  SELECT id, is_active, expires_at, max_uses, uses_count, user_limit
    INTO v_c FROM coupons WHERE id = p_coupon_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'code', 'not_found', 'error', 'Invalid coupon code'); END IF;
  IF NOT COALESCE(v_c.is_active, false) THEN RETURN json_build_object('ok', false, 'code', 'inactive', 'error', 'This coupon is no longer active'); END IF;
  IF v_c.expires_at IS NOT NULL AND v_c.expires_at < now() THEN RETURN json_build_object('ok', false, 'code', 'expired', 'error', 'This coupon has expired'); END IF;
  IF v_c.max_uses IS NOT NULL AND COALESCE(v_c.uses_count, 0) >= v_c.max_uses THEN
    RETURN json_build_object('ok', false, 'code', 'limit_reached', 'error', 'This coupon has reached its usage limit');
  END IF;
  IF v_c.user_limit IS NOT NULL AND (p_customer_id IS NOT NULL OR v_key IS NOT NULL) THEN
    SELECT count(*) INTO v_used FROM coupon_usage
     WHERE coupon_id = p_coupon_id
       AND ((p_customer_id IS NOT NULL AND customer_id = p_customer_id) OR (v_key IS NOT NULL AND identity_key = v_key));
    IF v_used >= v_c.user_limit THEN
      RETURN json_build_object('ok', false, 'code', 'user_limit', 'error', 'You have already used this coupon');
    END IF;
  END IF;
  UPDATE coupons SET uses_count = COALESCE(uses_count, 0) + 1 WHERE id = p_coupon_id;
  INSERT INTO coupon_usage (coupon_id, order_id, customer_id, discount_amount, used_at, identity_key)
  VALUES (p_coupon_id, NULL, p_customer_id, 0, now(), v_key) RETURNING id INTO v_usage;
  RETURN json_build_object('ok', true, 'usage_id', v_usage);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_coupon_use(bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_coupon_use(bigint, bigint, text) TO service_role;

-- L-11: project rule — app / trigger functions are never callable by the API roles.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'order_coupon_gst_credit(bigint)', 'order_journal_active(bigint)', 'referral_phone10(text)',
    'customers_reset_phone_verified()', 'refund_payouts_append_only()', 'trg_award_loyalty_on_delivered()',
    'trg_release_coupon_on_order_end()', 'trg_stock_history_append_only()'
  ] LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
    EXCEPTION WHEN undefined_function THEN NULL;
    END;
  END LOOP;
END $$;

-- L-12: purchase quantities are internal.
REVOKE SELECT (initial_stock) ON public.product_variants FROM anon, authenticated;

-- L-13: an inactive product is invisible to the API roles whatever its status says.
ALTER POLICY products_public_select ON public.products
  USING (is_deleted = false AND status = 'active' AND deleted_at IS NULL AND is_active IS DISTINCT FROM false);
