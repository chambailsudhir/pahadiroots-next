-- ─────────────────────────────────────────────────────────────────────────────
-- v17 — referral programme with abuse controls (account audit, Nov 2026, ACC-045 follow-up)
--
-- Before this migration the account page promised "you and your friend earn 100 coins when they place their first
-- order", but NOTHING recorded a referral or paid it (customers.referred_by was never set, no loyalty_transactions
-- row of type 'referral' has ever existed). So there was nothing to abuse — and nothing worked.
--
-- Rules (modelled on the big marketplaces — Myntra / Nykaa / Amazon pay a referral only once the referred order is
-- DELIVERED and past the return window — and made a little tighter because the shop is small). All limits are rows in
-- site_settings so the owner can change them without a deploy:
--   referral_bonus_points      100   coins to EACH side (already existed)
--   referral_min_order         499   the friend's order must be at least this (₹, order total)
--   referral_hold_days         7     reward is released this many days AFTER delivery (return window); a returned /
--                                    refunded / cancelled order never pays
--   referral_max_per_month     3     most referrals one customer can be paid for in any rolling 30 days
--   referral_max_lifetime      10    most referrals one customer can ever be paid for
--   referral_expiry_days       90    an unrewarded referral lapses this long after the code was applied
--
-- Hard rules (not settings): a code can only be applied by a customer who has NO order yet; never to yourself; one
-- referrer per customer, forever; the friend must not share the referrer's phone, e-mail or delivery address; and one
-- delivery address can be rewarded only once (stops "family of five accounts at one flat" farming).
--
-- Everything is service-role only (RLS on, no policies; EXECUTE revoked from anon / authenticated).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.referrals (
  id              bigserial PRIMARY KEY,
  referrer_id     bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  referee_id      bigint NOT NULL UNIQUE REFERENCES public.customers(id) ON DELETE CASCADE,   -- one referrer per customer, ever
  status          text   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rewarded', 'rejected')),
  reject_reason   text,
  order_id        bigint REFERENCES public.orders(id) ON DELETE SET NULL,                     -- the order that qualified
  referrer_points integer NOT NULL DEFAULT 0,
  referee_points  integer NOT NULL DEFAULT 0,
  addr_fp         text,                                                                        -- delivery-address fingerprint of the qualifying order
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  CHECK (referrer_id <> referee_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_id, status, resolved_at);
CREATE INDEX IF NOT EXISTS idx_referrals_pending  ON public.referrals (created_at) WHERE status = 'pending';
-- one reward per delivery address
CREATE UNIQUE INDEX IF NOT EXISTS referrals_one_reward_per_address ON public.referrals (addr_fp) WHERE status = 'rewarded' AND addr_fp IS NOT NULL;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;      -- deny-all: only the service role (API routes / cron) touches it

INSERT INTO public.site_settings (key, value) VALUES
  ('referral_min_order',     '499'),
  ('referral_hold_days',     '7'),
  ('referral_max_per_month', '3'),
  ('referral_max_lifetime',  '10'),
  ('referral_expiry_days',   '90')
ON CONFLICT (key) DO NOTHING;

-- ── helpers ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.referral_setting(p_key text, p_default numeric)
 RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT COALESCE((SELECT NULLIF(regexp_replace(value, '[^0-9.]', '', 'g'), '')::numeric FROM site_settings WHERE key = p_key), p_default) $$;

-- "12, Rose Lane " and "12 rose lane" in the same pincode are the same place
CREATE OR REPLACE FUNCTION public.referral_addr_fp(p_addr jsonb)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT CASE WHEN COALESCE(p_addr->>'address_line1', '') = '' OR COALESCE(p_addr->>'pincode', '') = '' THEN NULL
                  ELSE md5(regexp_replace(lower(p_addr->>'address_line1'), '[^a-z0-9]', '', 'g') || '|' || regexp_replace(p_addr->>'pincode', '\D', '', 'g')) END $$;

CREATE OR REPLACE FUNCTION public.referral_phone10(p text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT NULLIF(right(regexp_replace(COALESCE(p, ''), '\D', '', 'g'), 10), '') $$;

-- ── 1) apply a friend's code ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.attach_referral(p_referee_id bigint, p_code text)
 RETURNS json LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ref   customers%ROWTYPE;   -- referrer
  v_me    customers%ROWTYPE;   -- the new customer
  v_code  text := upper(btrim(COALESCE(p_code, '')));
BEGIN
  IF v_code !~ '^[A-Z0-9]{6,12}$' THEN RETURN json_build_object('ok', false, 'reason', 'invalid_code'); END IF;

  SELECT * INTO v_me FROM customers WHERE id = p_referee_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_me.is_deleted, false) OR COALESCE(v_me.is_blocked, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  IF v_me.referred_by IS NOT NULL OR EXISTS (SELECT 1 FROM referrals WHERE referee_id = p_referee_id) THEN
    RETURN json_build_object('ok', false, 'reason', 'already_applied');
  END IF;
  -- referrals are for NEW customers: any order that was not cancelled means you are not new
  IF EXISTS (SELECT 1 FROM orders WHERE customer_id = p_referee_id AND NOT COALESCE(is_deleted, false) AND order_status::text <> 'cancelled') THEN
    RETURN json_build_object('ok', false, 'reason', 'not_new_customer');
  END IF;

  SELECT * INTO v_ref FROM customers WHERE referral_code = v_code AND NOT COALESCE(is_deleted, false) AND NOT COALESCE(is_blocked, false);
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_code'); END IF;
  IF v_ref.id = v_me.id THEN RETURN json_build_object('ok', false, 'reason', 'own_code'); END IF;

  -- obvious same-person checks (the delivery address is checked again when the reward is released)
  IF referral_phone10(v_ref.phone) IS NOT NULL AND referral_phone10(v_ref.phone) = referral_phone10(v_me.phone)
     OR v_ref.normalized_phone IS NOT NULL AND v_ref.normalized_phone = v_me.normalized_phone
     OR v_ref.email IS NOT NULL AND lower(v_ref.email) = lower(COALESCE(v_me.email, '')) THEN
    RETURN json_build_object('ok', false, 'reason', 'same_person');
  END IF;

  INSERT INTO referrals (referrer_id, referee_id) VALUES (v_ref.id, v_me.id);
  UPDATE customers SET referred_by = v_ref.id WHERE id = v_me.id;
  RETURN json_build_object('ok', true);
END;
$function$;

-- ── 2) release rewards that have earned it ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_referral_rewards(p_limit integer DEFAULT 50)
 RETURNS json LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r            referrals%ROWTYPE;
  o            orders%ROWTYPE;
  v_bonus      integer := referral_setting('referral_bonus_points', 100)::int;
  v_min_order  numeric := referral_setting('referral_min_order', 499);
  v_hold       numeric := referral_setting('referral_hold_days', 7);
  v_max_month  integer := referral_setting('referral_max_per_month', 3)::int;
  v_max_life   integer := referral_setting('referral_max_lifetime', 10)::int;
  v_expiry     numeric := referral_setting('referral_expiry_days', 90);
  v_fp         text;
  v_ref_phone  text;
  v_reason     text;
  v_ref_pts    integer;
  v_bal        integer;
  v_rewarded   integer := 0;
  v_rejected   integer := 0;
  v_waiting    integer := 0;
BEGIN
  IF COALESCE((SELECT value FROM site_settings WHERE key = 'loyalty_enabled'), 'true') = 'false' THEN
    RETURN json_build_object('rewarded', 0, 'rejected', 0, 'waiting', 0, 'disabled', true);
  END IF;

  FOR r IN SELECT * FROM referrals WHERE status = 'pending' ORDER BY created_at LIMIT GREATEST(p_limit, 1) FOR UPDATE SKIP LOCKED LOOP
   BEGIN   -- one bad row must never block the others (sub-transaction)
    v_reason := NULL; v_ref_pts := 0; o := NULL;

    -- the earliest order of the friend's that is a candidate: not deleted, not cancelled
    SELECT * INTO o FROM orders
     WHERE customer_id = r.referee_id AND NOT COALESCE(is_deleted, false) AND order_status::text <> 'cancelled'
     ORDER BY created_at LIMIT 1;

    IF NOT FOUND THEN
      -- nothing bought yet: wait, unless the code has been sitting there too long
      IF r.created_at < now() - make_interval(days => v_expiry::int) THEN v_reason := 'expired'; ELSE v_waiting := v_waiting + 1; CONTINUE; END IF;
    ELSIF o.order_status::text IN ('returned', 'refunded', 'return_requested', 'return_approved', 'return_received') THEN
      v_reason := 'order_returned';
    ELSIF o.order_status::text <> 'delivered' OR o.delivered_at IS NULL OR o.delivered_at > now() - make_interval(days => v_hold::int) THEN
      -- not delivered yet, or still inside the return window
      IF r.created_at < now() - make_interval(days => v_expiry::int) THEN v_reason := 'expired'; ELSE v_waiting := v_waiting + 1; CONTINUE; END IF;
    ELSIF COALESCE(o.total_amount, 0) < v_min_order THEN
      v_reason := 'order_below_minimum';
    END IF;

    IF v_reason IS NULL THEN
      -- same-household checks on the DELIVERY details of the qualifying order
      v_fp := referral_addr_fp(o.shipping_address);
      SELECT referral_phone10(COALESCE(normalized_phone, phone)) INTO v_ref_phone FROM customers WHERE id = r.referrer_id;
      IF v_ref_phone IS NOT NULL AND referral_phone10(o.shipping_address->>'phone') = v_ref_phone THEN
        v_reason := 'same_phone_as_referrer';
      ELSIF v_fp IS NOT NULL AND EXISTS (SELECT 1 FROM orders ro WHERE ro.customer_id = r.referrer_id AND NOT COALESCE(ro.is_deleted, false)
                                           AND referral_addr_fp(ro.shipping_address) = v_fp) THEN
        v_reason := 'same_address_as_referrer';
      ELSIF v_fp IS NOT NULL AND EXISTS (SELECT 1 FROM referrals x WHERE x.status = 'rewarded' AND x.addr_fp = v_fp) THEN
        v_reason := 'address_already_rewarded';
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      UPDATE referrals SET status = 'rejected', reject_reason = v_reason, order_id = o.id, resolved_at = now() WHERE id = r.id;
      v_rejected := v_rejected + 1;
      CONTINUE;
    END IF;

    -- referrer caps: when reached, the FRIEND is still rewarded (they did nothing wrong), the referrer is not
    IF v_bonus > 0
       AND (SELECT count(*) FROM referrals WHERE referrer_id = r.referrer_id AND status = 'rewarded' AND referrer_points > 0) < v_max_life
       AND (SELECT count(*) FROM referrals WHERE referrer_id = r.referrer_id AND status = 'rewarded' AND referrer_points > 0
                                              AND resolved_at > now() - interval '30 days') < v_max_month THEN
      v_ref_pts := v_bonus;
    END IF;

    -- lock both balances in id order (no deadlock between two sweeps), then pay
    PERFORM 1 FROM customers WHERE id IN (r.referrer_id, r.referee_id) ORDER BY id FOR UPDATE;

    IF v_ref_pts > 0 THEN
      UPDATE customers SET loyalty_points = COALESCE(loyalty_points, 0) + v_ref_pts WHERE id = r.referrer_id RETURNING loyalty_points INTO v_bal;
      INSERT INTO loyalty_transactions (customer_id, order_id, type, points, balance_after, note)
      VALUES (r.referrer_id, o.id, 'referral', v_ref_pts, v_bal, 'Referral bonus — your friend''s first order was delivered');
    END IF;
    IF v_bonus > 0 THEN
      UPDATE customers SET loyalty_points = COALESCE(loyalty_points, 0) + v_bonus WHERE id = r.referee_id RETURNING loyalty_points INTO v_bal;
      INSERT INTO loyalty_transactions (customer_id, order_id, type, points, balance_after, note)
      VALUES (r.referee_id, o.id, 'referral', v_bonus, v_bal, 'Welcome bonus — you joined with a friend''s referral');
    END IF;

    UPDATE referrals SET status = 'rewarded', order_id = o.id, addr_fp = v_fp, referrer_points = v_ref_pts,
                         referee_points = GREATEST(v_bonus, 0), resolved_at = now() WHERE id = r.id;
    v_rewarded := v_rewarded + 1;
   EXCEPTION WHEN OTHERS THEN
     RAISE WARNING 'process_referral_rewards: referral % skipped: %', r.id, SQLERRM;   -- stays pending, retried next sweep
   END;
  END LOOP;

  RETURN json_build_object('rewarded', v_rewarded, 'rejected', v_rejected, 'waiting', v_waiting);
END;
$function$;

REVOKE ALL ON FUNCTION public.attach_referral(bigint, text)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_referral_rewards(integer)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.referral_setting(text, numeric)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE    public.referrals                           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.attach_referral(bigint, text)     TO service_role;
GRANT  EXECUTE ON FUNCTION public.process_referral_rewards(integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.referral_setting(text, numeric)   TO service_role;
