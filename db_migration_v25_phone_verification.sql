-- db_migration_v25_phone_verification.sql
-- WhatsApp-inbound proof of mobile-number ownership (no SMS, no outbound cost). NOT APPLIED — see the PR for the
-- things to verify against the LIVE schema first. Additive and idempotent: safe to run twice.
--
-- Flow: the customer taps a wa.me link that sends "VERIFY <6 digits>" to the shop's WhatsApp Business number; the
-- Meta Cloud API webhook (src/app/api/webhooks/whatsapp/route.ts) matches the code and the sender's number and calls
-- claim_verified_phone().

-- 1) customers.phone_verified_at ---------------------------------------------------------------------------------
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

-- 2) open verification codes ---------------------------------------------------------------------------------------
-- Only an HMAC of the code is stored (never the code). Service-role only: RLS on, no policies, no grants to anon/authenticated.
CREATE TABLE IF NOT EXISTS public.phone_verifications (
  id           bigserial PRIMARY KEY,
  customer_id  bigint      NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  phone10      text        NOT NULL,
  code_hash    text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  attempts     int         NOT NULL DEFAULT 0
);
ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_verifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.phone_verifications TO service_role;
REVOKE ALL ON SEQUENCE public.phone_verifications_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.phone_verifications_id_seq TO service_role;

CREATE INDEX IF NOT EXISTS phone_verifications_open_customer_idx
  ON public.phone_verifications (customer_id) WHERE consumed_at IS NULL;
-- the webhook looks codes up by the SENDER's number
CREATE INDEX IF NOT EXISTS phone_verifications_open_phone_idx
  ON public.phone_verifications (phone10) WHERE consumed_at IS NULL;

-- 3) defence in depth: a changed phone is never still "verified" -----------------------------------------------
-- The API route also clears phone_verified_at, but any other writer (admin tool, SQL, another route) is covered here.
-- claim_verified_phone() changes phone AND phone_verified_at in the same UPDATE, which this trigger leaves alone.
CREATE OR REPLACE FUNCTION public.customers_reset_phone_verified() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone
     AND NEW.phone_verified_at IS NOT DISTINCT FROM OLD.phone_verified_at THEN
    NEW.phone_verified_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS customers_reset_phone_verified ON public.customers;
CREATE TRIGGER customers_reset_phone_verified
  BEFORE UPDATE OF phone ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.customers_reset_phone_verified();

-- 4) claim_verified_phone ---------------------------------------------------------------------------------------
-- Called by the webhook AFTER the WhatsApp sender's number matched the code. In ONE transaction (with row locks):
--   * gives the number to the claimant and stamps phone_verified_at;
--   * RELEASES the number (phone := NULL) from any OTHER row that holds it and is a REGISTERED, UNVERIFIED account
--     (auth_user_id NOT NULL, phone_verified_at NULL) - that is the squatter case: someone typed a number they never proved.
--   * NEVER takes it from a verified holder (returns phone_verified_by_other), and NEVER from a guest row
--     (auth_user_id NULL): guest-checkout rows keep their phone because /track and the courier flow use it to find guest
--     orders. If a guest row holds the number the unique index on normalized_phone makes the claim fail; that is reported
--     as phone_in_use and left for a human / a future merge feature rather than silently rewriting order history.
-- Assumes customers.normalized_phone is GENERATED from / maintained from phone (db_migration_v17 reads it; the profile route
-- writes only phone). VERIFY against the live schema; if it is a plain column, set it in both UPDATEs below.
CREATE OR REPLACE FUNCTION public.claim_verified_phone(p_customer_id bigint, p_phone10 text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_me     public.customers%ROWTYPE;
  h        record;
  v_digits text := right(regexp_replace(coalesce(p_phone10, ''), '\D', '', 'g'), 10);
BEGIN
  IF v_digits !~ '^[6-9][0-9]{9}$' THEN
    RETURN json_build_object('ok', false, 'reason', 'invalid_phone');
  END IF;

  -- serialise competing claims for the same number
  PERFORM pg_advisory_xact_lock(hashtext('claim_verified_phone:' || v_digits));

  SELECT * INTO v_me FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'no_such_customer');
  END IF;

  -- lock every other holder in a fixed order (no deadlocks), then decide
  FOR h IN
    SELECT id, auth_user_id, phone_verified_at
      FROM public.customers
     WHERE id <> p_customer_id
       AND ( right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_digits
          OR right(regexp_replace(coalesce(normalized_phone::text, ''), '\D', '', 'g'), 10) = v_digits )
     ORDER BY id
       FOR UPDATE
  LOOP
    IF h.phone_verified_at IS NOT NULL THEN
      RETURN json_build_object('ok', false, 'reason', 'phone_verified_by_other');
    END IF;
    IF h.auth_user_id IS NOT NULL THEN
      UPDATE public.customers SET phone = NULL, updated_at = now() WHERE id = h.id;
    END IF;
    -- guest rows (auth_user_id IS NULL) are intentionally left alone
  END LOOP;

  UPDATE public.customers
     SET phone = v_digits, phone_verified_at = now(), updated_at = now()
   WHERE id = p_customer_id;

  RETURN json_build_object('ok', true, 'reason', 'claimed');
EXCEPTION WHEN unique_violation THEN
  -- a guest row still holds the number (see above); the sub-transaction, including any release, is rolled back
  RETURN json_build_object('ok', false, 'reason', 'phone_in_use');
END $$;

REVOKE EXECUTE ON FUNCTION public.claim_verified_phone(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_verified_phone(bigint, text) TO service_role;
