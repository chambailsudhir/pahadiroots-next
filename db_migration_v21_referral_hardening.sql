-- ─────────────────────────────────────────────────────────────────────────────
-- v21 — referral programme hardening (audit Nov 2026, findings 5-7).  ADDITIVE + IDEMPOTENT.  NOT applied to prod.
--
-- !!! MUST BE DIFFED AGAINST THE LIVE FUNCTION SOURCE BEFORE IT IS APPLIED !!!
-- The production database was overloaded while this was written, so the live definitions (pg_get_functiondef of
-- attach_referral, process_referral_rewards, assign_referral_code, referral_addr_fp) could NOT be read. This file is
-- built from db_migration_v4_loyalty.sql and db_migration_v17_referral_controls.sql only. If the live source differs
-- (hot-fixes applied by hand), merge those differences in first. Column names used on saved_addresses
-- (customer_id, addr, pin, phone) come from src/app/api/profile/route.ts and must be confirmed too.
--
-- Based on db_migration_v17_referral_controls.sql (the repo's record of the applied functions). Function signatures,
-- return shapes, SET search_path and the service_role-only REVOKE/GRANT are unchanged.
--
-- 1) "Shell referrer" bypass: a referrer account with NO orders plus a second account applying its code was paid out
--    after one ₹499 order. A reward now also needs the REFERRER to have at least one delivered, non-returned order whose
--    return window (referral_hold_days) has passed; until then the referral stays pending (and lapses after
--    referral_expiry_days like any other).
-- 2) Same-household checks were too narrow (address compared only with the referrer's ORDERS, phone only with the
--    referrer's ACCOUNT phone). They now cover ALL the referrer's phones (account, saved addresses, order phones) and
--    ALL the referrer's addresses (saved addresses + orders), and the e-mail alias check.
-- 3) E-mail aliases: gmail/googlemail dots and +tags are normalised (referral_email_norm) in attach_referral and again
--    when the reward is released.
-- 4) Address fingerprint: pincode + the first run of digits (house / flat number) + the first meaningful word of the
--    address line, instead of md5 of the whole stripped line (defeated by re-wording). The old function is kept as
--    referral_addr_fp_v1 so rewards paid before this migration still block a repeat at the same address.
-- 5) Cap race: the referrer's customers row is now locked BEFORE the monthly / lifetime caps are counted.
-- 6) Referral codes: new codes come from a CSPRNG (gen_random_uuid(), core since PG13, no extension needed): 12 upper-case
--    hex characters (48 bits), regenerated on collision. Existing codes stay valid. The accepted format
--    ^[A-Z0-9]{6,12}$ (attach_referral + src/lib/referral.ts) already allows 12 characters, so nothing else changes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── helpers ─────────────────────────────────────────────────────────────────

-- gmail.com / googlemail.com ignore dots and "+tag" in the local part: a.b+x@gmail.com == ab@gmail.com
CREATE OR REPLACE FUNCTION public.referral_email_norm(p_email text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN p_email IS NULL OR btrim(p_email) = '' OR position('@' IN p_email) = 0 THEN NULLIF(lower(btrim(COALESCE(p_email, ''))), '')
    WHEN lower(split_part(btrim(p_email), '@', 2)) IN ('gmail.com', 'googlemail.com')
      THEN replace(split_part(lower(split_part(btrim(p_email), '@', 1)), '+', 1), '.', '') || '@gmail.com'
    ELSE lower(btrim(p_email))
  END
$$;

-- the v17 fingerprint, kept so earlier rewards still count (stored in referrals.addr_fp)
CREATE OR REPLACE FUNCTION public.referral_addr_fp_v1(p_addr jsonb)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT CASE WHEN COALESCE(p_addr->>'address_line1', '') = '' OR COALESCE(p_addr->>'pincode', '') = '' THEN NULL
                  ELSE md5(regexp_replace(lower(p_addr->>'address_line1'), '[^a-z0-9]', '', 'g') || '|' || regexp_replace(p_addr->>'pincode', '\D', '', 'g')) END $$;

-- v21 fingerprint: pincode | first number in the line (house / flat) | first meaningful word.
-- "Flat 4B, Rose Lane", "4b rose lane" and "House no. 4, Rose Villa" all give pincode|4|rose.
CREATE OR REPLACE FUNCTION public.referral_addr_fp(p_addr jsonb)
 RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_line  text := lower(COALESCE(p_addr->>'address_line1', ''));
  v_pin   text := regexp_replace(COALESCE(p_addr->>'pincode', ''), '\D', '', 'g');
  v_num   text;
  v_word  text;
  w       text;
BEGIN
  IF btrim(v_line) = '' OR v_pin = '' THEN RETURN NULL; END IF;
  v_num := COALESCE((regexp_match(v_line, '([0-9]+)'))[1], '');
  v_num := NULLIF(ltrim(v_num, '0'), '');                                 -- "004" == "4"
  FOR w IN SELECT m[1] FROM regexp_matches(v_line, '([a-z]{2,})', 'g') AS m LOOP
    IF w NOT IN ('flat', 'house', 'no', 'hno', 'plot', 'door', 'apt', 'apartment', 'room', 'floor', 'block', 'the', 'near', 'opp', 'opposite', 'behind', 'ward', 'unit', 'shop', 'bldg', 'building', 'tower', 'wing') THEN
      v_word := w; EXIT;
    END IF;
  END LOOP;
  IF v_num IS NULL AND v_word IS NULL THEN RETURN NULL; END IF;
  RETURN md5(v_pin || '|' || COALESCE(v_num, '') || '|' || COALESCE(v_word, ''));
END
$$;

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

  -- obvious same-person checks (delivery address / all phones are checked again when the reward is released)
  IF referral_phone10(v_ref.phone) IS NOT NULL AND referral_phone10(v_ref.phone) = referral_phone10(v_me.phone)
     OR v_ref.normalized_phone IS NOT NULL AND v_ref.normalized_phone = v_me.normalized_phone
     OR referral_email_norm(v_ref.email) IS NOT NULL AND referral_email_norm(v_ref.email) = referral_email_norm(v_me.email)
     OR EXISTS (SELECT 1 FROM saved_addresses sa
                 WHERE sa.customer_id = v_ref.id AND referral_phone10(sa.phone) IS NOT NULL
                   AND (referral_phone10(sa.phone) = referral_phone10(v_me.phone)
                        OR referral_phone10(sa.phone) IN (SELECT referral_phone10(m.phone) FROM saved_addresses m WHERE m.customer_id = v_me.id))) THEN
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
  v_fp_v1      text;
  v_ref_email  text;
  v_me_email   text;
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

    -- v21: the REFERRER must be a real customer too — at least one delivered, non-returned order whose return window has
    -- passed. Until then the referral waits (it still lapses after referral_expiry_days).
    IF v_reason IS NULL AND NOT EXISTS (
         SELECT 1 FROM orders ro
          WHERE ro.customer_id = r.referrer_id AND NOT COALESCE(ro.is_deleted, false)
            AND ro.order_status::text = 'delivered' AND ro.delivered_at IS NOT NULL
            AND ro.delivered_at <= now() - make_interval(days => v_hold::int)) THEN
      IF r.created_at < now() - make_interval(days => v_expiry::int) THEN v_reason := 'expired'; ELSE v_waiting := v_waiting + 1; CONTINUE; END IF;
    END IF;

    IF v_reason IS NULL THEN
      -- same-household checks on the DELIVERY details of the qualifying order
      v_fp    := referral_addr_fp(o.shipping_address);
      v_fp_v1 := referral_addr_fp_v1(o.shipping_address);
      SELECT referral_email_norm(email) INTO v_ref_email FROM customers WHERE id = r.referrer_id;
      SELECT referral_email_norm(email) INTO v_me_email  FROM customers WHERE id = r.referee_id;

      IF v_ref_email IS NOT NULL AND v_ref_email = v_me_email THEN
        v_reason := 'same_email_as_referrer';
      -- ANY phone the referee used (the order's, their account's) vs ANY phone the referrer is known by
      -- (account, saved addresses, phones on their orders)
      ELSIF EXISTS (
        WITH me AS (
          SELECT referral_phone10(o.shipping_address->>'phone') AS p
          UNION SELECT referral_phone10(COALESCE(normalized_phone, phone)) FROM customers WHERE id = r.referee_id
        ), rf AS (
          SELECT referral_phone10(COALESCE(normalized_phone, phone)) AS p FROM customers WHERE id = r.referrer_id
          UNION SELECT referral_phone10(phone) FROM customers WHERE id = r.referrer_id
          UNION SELECT referral_phone10(phone) FROM saved_addresses WHERE customer_id = r.referrer_id
          UNION SELECT referral_phone10(shipping_address->>'phone') FROM orders WHERE customer_id = r.referrer_id AND NOT COALESCE(is_deleted, false)
        )
        SELECT 1 FROM me JOIN rf ON me.p = rf.p WHERE me.p IS NOT NULL
      ) THEN
        v_reason := 'same_phone_as_referrer';
      -- the delivery address vs ALL the referrer's addresses: saved addresses AND the addresses of their orders
      ELSIF v_fp IS NOT NULL AND (
            EXISTS (SELECT 1 FROM orders ro WHERE ro.customer_id = r.referrer_id AND NOT COALESCE(ro.is_deleted, false)
                      AND (referral_addr_fp(ro.shipping_address) = v_fp OR referral_addr_fp_v1(ro.shipping_address) = v_fp_v1))
         OR EXISTS (SELECT 1 FROM saved_addresses sa WHERE sa.customer_id = r.referrer_id
                      AND referral_addr_fp(jsonb_build_object('address_line1', sa.addr, 'pincode', sa.pin)) = v_fp)) THEN
        v_reason := 'same_address_as_referrer';
      ELSIF (v_fp IS NOT NULL OR v_fp_v1 IS NOT NULL)
            AND EXISTS (SELECT 1 FROM referrals x WHERE x.status = 'rewarded' AND x.addr_fp IN (COALESCE(v_fp, '-'), COALESCE(v_fp_v1, '-'))) THEN
        v_reason := 'address_already_rewarded';
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      UPDATE referrals SET status = 'rejected', reject_reason = v_reason, order_id = o.id, resolved_at = now() WHERE id = r.id;
      v_rejected := v_rejected + 1;
      CONTINUE;
    END IF;

    -- v21: lock both balances in id order (no deadlock between two sweeps) BEFORE counting the caps. Two concurrent
    -- sweeps for the same referrer now serialise here, and the second one counts the first one's reward.
    PERFORM 1 FROM customers WHERE id IN (r.referrer_id, r.referee_id) ORDER BY id FOR UPDATE;

    -- referrer caps: when reached, the FRIEND is still rewarded (they did nothing wrong), the referrer is not
    IF v_bonus > 0
       AND (SELECT count(*) FROM referrals WHERE referrer_id = r.referrer_id AND status = 'rewarded' AND referrer_points > 0) < v_max_life
       AND (SELECT count(*) FROM referrals WHERE referrer_id = r.referrer_id AND status = 'rewarded' AND referrer_points > 0
                                              AND resolved_at > now() - interval '30 days') < v_max_month THEN
      v_ref_pts := v_bonus;
    END IF;

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

-- ── 3) referral codes: unguessable, collision-safe ──────────────────────────
-- Old codes (first 8 hex of md5(id || 'pahadi')) are derivable offline; they stay valid, but every NEW customer gets a
-- random 12-character code. gen_random_uuid() is a CSPRNG in core Postgres (no extension needed).
CREATE OR REPLACE FUNCTION public.assign_referral_code()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_code text;
  i      integer := 0;
BEGIN
  IF NEW.referral_code IS NULL THEN
    LOOP
      v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM customers WHERE referral_code = v_code);
      i := i + 1;
      IF i >= 10 THEN RAISE EXCEPTION 'could not generate a unique referral code'; END IF;
    END LOOP;
    NEW.referral_code := v_code;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── privileges: service role only (unchanged from v17) ──────────────────────
REVOKE ALL ON FUNCTION public.attach_referral(bigint, text)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_referral_rewards(integer)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.referral_email_norm(text)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.referral_addr_fp(jsonb)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.referral_addr_fp_v1(jsonb)          FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.attach_referral(bigint, text)     TO service_role;
GRANT  EXECUTE ON FUNCTION public.process_referral_rewards(integer) TO service_role;
GRANT  EXECUTE ON FUNCTION public.referral_email_norm(text)         TO service_role;
GRANT  EXECUTE ON FUNCTION public.referral_addr_fp(jsonb)           TO service_role;
GRANT  EXECUTE ON FUNCTION public.referral_addr_fp_v1(jsonb)        TO service_role;
