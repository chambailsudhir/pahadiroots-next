-- Rolled-back scenario test for db_migration_v26. Run in prod ONLY inside this single transaction (it ends with ROLLBACK).
BEGIN;

-- [migration body is pasted here]

INSERT INTO customers (first_name, email, phone) VALUES
  ('V26-referrer', 'v26-referrer@example.com', '9000000201'),
  ('V26-friend',   'v26-friend@example.com',   '9000000202');
-- the friend once abandoned an online payment
INSERT INTO orders (customer_id, order_status, payment_status, total_amount, is_deleted, shipping_address)
SELECT id, 'payment_failed', 'failed', 600, false, '{"address_line1":"1 Failed Rd","pincode":"248001","phone":"9111111101"}'::jsonb FROM customers WHERE first_name = 'V26-friend';

-- 1) the abandoned payment no longer makes the friend "not a new customer"
DO $$ DECLARE j json; BEGIN
  j := attach_referral((SELECT id FROM customers WHERE first_name='V26-friend'), (SELECT referral_code FROM customers WHERE first_name='V26-referrer'));
  ASSERT (j->>'ok')::boolean, 'attach after a failed payment must succeed: ' || j::text;
END $$;

-- 2) later real orders: referrer delivered long ago, friend delivered long ago
INSERT INTO orders (customer_id, order_status, payment_status, total_amount, delivered_at, is_deleted, shipping_address)
SELECT id, 'delivered', 'paid', 700, now() - interval '40 days', false, '{"address_line1":"9 Pine Road","pincode":"248002","phone":"9222222201"}'::jsonb FROM customers WHERE first_name='V26-referrer';
INSERT INTO orders (customer_id, order_status, payment_status, total_amount, delivered_at, is_deleted, shipping_address)
SELECT id, 'delivered', 'paid', 700, now() - interval '30 days', false, '{"address_line1":"77 Elm Street","pincode":"248009","phone":"9333333302"}'::jsonb FROM customers WHERE first_name='V26-friend';

SELECT process_referral_rewards(50);
DO $$ BEGIN
  ASSERT (SELECT status FROM referrals WHERE referee_id = (SELECT id FROM customers WHERE first_name='V26-friend')) = 'rewarded',
         'the delivered order (not the failed attempt) decides: ' || (SELECT status || '/' || COALESCE(reject_reason,'') FROM referrals WHERE referee_id = (SELECT id FROM customers WHERE first_name='V26-friend'));
  ASSERT (SELECT o.order_status::text FROM referrals r JOIN orders o ON o.id = r.order_id WHERE r.referee_id = (SELECT id FROM customers WHERE first_name='V26-friend')) = 'delivered',
         'reward is tied to the delivered order';
END $$;

-- 3) privileges unchanged
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'attach_referral(bigint,text)', 'EXECUTE'), 'anon must not execute';
  ASSERT has_function_privilege('service_role', 'process_referral_rewards(integer)', 'EXECUTE'), 'service_role must execute';
END $$;

ROLLBACK;
