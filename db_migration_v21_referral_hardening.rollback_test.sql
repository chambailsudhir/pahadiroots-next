-- Rolled-back scenario test for db_migration_v21_referral_hardening.sql.
-- Run it ONLY on a branch / staging database, or in prod inside this single transaction (it ends with ROLLBACK).
-- Apply v21 inside the same transaction first (paste it above) so the whole thing, migration included, is rolled back.
-- Adjust the customers / orders INSERT column lists if your table has other NOT NULL columns.
BEGIN;

-- 0) pure helpers -------------------------------------------------------------
DO $$ BEGIN
  ASSERT referral_email_norm('A.B+promo@GoogleMail.com') = 'ab@gmail.com', 'gmail alias';
  ASSERT referral_email_norm('a.b@corp.com') = 'a.b@corp.com', 'non-gmail untouched';
  ASSERT referral_addr_fp('{"address_line1":"Flat 4B, Rose Lane","pincode":"248001"}')
       = referral_addr_fp('{"address_line1":"house no. 4, rose villa","pincode":"248 001"}'), 'rewording does not evade';
  ASSERT referral_addr_fp('{"address_line1":"Flat 5, Rose Lane","pincode":"248001"}')
      <> referral_addr_fp('{"address_line1":"Flat 4, Rose Lane","pincode":"248001"}'), 'different house differs';
END $$;

-- 1) fixtures -----------------------------------------------------------------
INSERT INTO customers (first_name, email, phone, normalized_phone) VALUES
  ('T-shell',  'shell@example.com',     '9000000001', '9000000001'),   -- referrer with no orders
  ('T-friend', 'f.r.i.e.n.d+x@gmail.com','9000000002', '9000000002'),
  ('T-real',   'real@example.com',      '9000000003', '9000000003'),   -- referrer with a delivered order
  ('T-friend2','friend2@example.com',   '9000000004', '9000000004');
-- a NEW customer gets a 12-char random code, existing format still accepted
DO $$ BEGIN ASSERT (SELECT bool_and(referral_code ~ '^[A-Z0-9]{6,12}$') FROM customers WHERE first_name LIKE 'T-%'), 'code format'; END $$;
DO $$ BEGIN ASSERT (SELECT bool_and(length(referral_code) = 12) FROM customers WHERE first_name LIKE 'T-%'), 'new codes are 12 chars'; END $$;

-- gmail alias of the referrer is refused at attach time
INSERT INTO customers (first_name, email, phone) VALUES ('T-alias-referrer', 'fr.iend@gmail.com', '9000000099');
DO $$ DECLARE j json; BEGIN
  j := attach_referral((SELECT id FROM customers WHERE first_name = 'T-friend'), (SELECT referral_code FROM customers WHERE first_name = 'T-alias-referrer'));
  ASSERT j->>'reason' = 'same_person', 'gmail dot/plus alias refused: ' || j::text;
END $$;

-- 2) shell referrer: friend orders (delivered long ago, >= min order) but the referrer has no orders -> stays pending
SELECT attach_referral((SELECT id FROM customers WHERE first_name = 'T-friend'),  (SELECT referral_code FROM customers WHERE first_name = 'T-shell'));
SELECT attach_referral((SELECT id FROM customers WHERE first_name = 'T-friend2'), (SELECT referral_code FROM customers WHERE first_name = 'T-real'));
INSERT INTO orders (customer_id, order_status, total_amount, delivered_at, shipping_address, is_deleted)
SELECT id, 'delivered', 600, now() - interval '30 days',
       '{"address_line1":"7 Pine Road","pincode":"248002","phone":"9111111111"}'::jsonb, false FROM customers WHERE first_name = 'T-friend';
INSERT INTO orders (customer_id, order_status, total_amount, delivered_at, shipping_address, is_deleted)
SELECT id, 'delivered', 600, now() - interval '30 days',
       '{"address_line1":"Flat 4B, Rose Lane","pincode":"248001","phone":"9222222222"}'::jsonb, false FROM customers WHERE first_name = 'T-friend2';

SELECT process_referral_rewards(50);
DO $$ BEGIN
  ASSERT (SELECT status FROM referrals WHERE referee_id = (SELECT id FROM customers WHERE first_name = 'T-friend')) = 'pending',
         'shell referrer (no delivered order) => not paid, still pending';
END $$;

-- 3) real referrer with a delivered order at the SAME address, re-worded -> rejected
INSERT INTO saved_addresses (customer_id, label, name, addr, city, state, pin)
SELECT id, 'Home', 'T', 'house no 4, Rose Villa', 'Dehradun', 'Uttarakhand', '248001' FROM customers WHERE first_name = 'T-real';
INSERT INTO orders (customer_id, order_status, total_amount, delivered_at, shipping_address, is_deleted)
SELECT id, 'delivered', 600, now() - interval '30 days', '{"address_line1":"99 Elm St","pincode":"248009","phone":"9333333333"}'::jsonb, false
  FROM customers WHERE first_name = 'T-real';
SELECT process_referral_rewards(50);
DO $$ BEGIN
  ASSERT (SELECT reject_reason FROM referrals WHERE referee_id = (SELECT id FROM customers WHERE first_name = 'T-friend2')) = 'same_address_as_referrer',
         'saved-address match with re-worded line is caught';
END $$;

-- 4) cap race: not testable in one session; verify by diffing the function: the customers FOR UPDATE now precedes the cap counts.

-- 5) privileges unchanged: service_role only
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'attach_referral(bigint,text)', 'EXECUTE'), 'anon must not execute';
  ASSERT has_function_privilege('service_role', 'process_referral_rewards(integer)', 'EXECUTE'), 'service_role must execute';
END $$;

ROLLBACK;   -- nothing above persists
