-- Rolled-back scenario test for db_migration_v25_phone_verification.sql.
-- Run ONLY on a branch / staging database, or in prod inside this single transaction (it ends with ROLLBACK).
-- Paste db_migration_v25_phone_verification.sql directly under BEGIN so the migration is rolled back too.
-- Adjust the INSERT column lists if customers has other NOT NULL columns. Registered rows need an auth.users row
-- (customers_auth_user_id_fkey), created below inside the transaction.
BEGIN;

-- [paste db_migration_v25_phone_verification.sql here]

-- fixtures -------------------------------------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'pv-claimant@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'pv-squatter@example.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'pv-verified@example.com');
INSERT INTO customers (first_name, email, phone, auth_user_id) VALUES
  ('PV-claimant', 'pv-claimant@example.com', NULL,         '00000000-0000-0000-0000-0000000000a1'),
  ('PV-squatter', 'pv-squatter@example.com', '9000000011', '00000000-0000-0000-0000-0000000000a2'),
  ('PV-verified', 'pv-verified@example.com', '9000000012', '00000000-0000-0000-0000-0000000000a3');
UPDATE customers SET phone_verified_at = now() WHERE first_name = 'PV-verified';
INSERT INTO customers (first_name, email, phone) VALUES ('PV-guest', 'pv-guest@example.com', '9000000013');   -- guest row

-- 1) squatter (registered, unverified) is released, claimant gets the number --------------------------------------
DO $$ DECLARE j json; BEGIN
  j := claim_verified_phone((SELECT id FROM customers WHERE first_name = 'PV-claimant'), '9000000011');
  ASSERT (j->>'ok')::boolean, 'claim from squatter: ' || j::text;
  ASSERT (SELECT phone FROM customers WHERE first_name = 'PV-squatter') IS NULL, 'squatter released';
  ASSERT (SELECT phone FROM customers WHERE first_name = 'PV-claimant') = '9000000011', 'claimant owns it';
  ASSERT (SELECT phone_verified_at FROM customers WHERE first_name = 'PV-claimant') IS NOT NULL, 'verified stamp';
END $$;

-- 2) a VERIFIED holder is never displaced -------------------------------------------------------------------------
DO $$ DECLARE j json; BEGIN
  j := claim_verified_phone((SELECT id FROM customers WHERE first_name = 'PV-squatter'), '9000000012');
  ASSERT NOT (j->>'ok')::boolean AND j->>'reason' = 'phone_verified_by_other', 'verified holder kept: ' || j::text;
  ASSERT (SELECT phone FROM customers WHERE first_name = 'PV-verified') = '9000000012', 'verified phone intact';
END $$;

-- 3) a GUEST row keeps its phone (and the claim is refused, not forced) ------------------------------------------
DO $$ DECLARE j json; BEGIN
  j := claim_verified_phone((SELECT id FROM customers WHERE first_name = 'PV-squatter'), '9000000013');
  ASSERT NOT (j->>'ok')::boolean AND j->>'reason' = 'phone_in_use', 'guest row refuses: ' || j::text;
  ASSERT (SELECT phone FROM customers WHERE first_name = 'PV-guest') = '9000000013', 'guest phone intact';
  ASSERT (SELECT phone FROM customers WHERE first_name = 'PV-squatter') IS NULL, 'failed claim changed nothing';
END $$;

-- 4) invalid input ------------------------------------------------------------------------------------------------
DO $$ BEGIN
  ASSERT claim_verified_phone(1, '12345')->>'reason' = 'invalid_phone', 'invalid phone';
  ASSERT claim_verified_phone(-1, '9000000099')->>'reason' = 'no_such_customer', 'unknown customer';
END $$;

-- 5) trigger: changing phone through any writer drops the verified stamp -------------------------------------------
UPDATE customers SET phone = '9000000055' WHERE first_name = 'PV-claimant';
DO $$ BEGIN ASSERT (SELECT phone_verified_at FROM customers WHERE first_name = 'PV-claimant') IS NULL, 'trigger clears stamp'; END $$;

-- 6) privileges ---------------------------------------------------------------------------------------------------
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.claim_verified_phone(bigint,text)', 'EXECUTE'), 'anon cannot execute';
  ASSERT NOT has_function_privilege('authenticated', 'public.claim_verified_phone(bigint,text)', 'EXECUTE'), 'authenticated cannot execute';
  ASSERT has_function_privilege('service_role', 'public.claim_verified_phone(bigint,text)', 'EXECUTE'), 'service_role can execute';
  ASSERT NOT has_table_privilege('anon', 'public.phone_verifications', 'SELECT'), 'anon cannot read verifications';
  ASSERT NOT has_table_privilege('authenticated', 'public.phone_verifications', 'SELECT'), 'authenticated cannot read verifications';
END $$;

ROLLBACK;
