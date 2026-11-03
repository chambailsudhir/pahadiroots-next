-- Rolled-back scenario test for v27 (run in prod only inside this transaction; it ends with ROLLBACK). Paste the migration under BEGIN.
BEGIN;
-- [paste db_migration_v27_release_coupon_on_order_end.sql here]
INSERT INTO customers (first_name, email, phone) VALUES ('V27-cust', 'v27-cust@example.com', '9000000301');
INSERT INTO orders (customer_id, order_status, payment_status, total_amount, is_deleted, shipping_address)
SELECT id, 'pending', 'pending', 600, false, '{"address_line1":"1 A Rd","pincode":"248001","phone":"9111111301"}'::jsonb FROM customers WHERE first_name='V27-cust';
INSERT INTO orders (customer_id, order_status, payment_status, total_amount, is_deleted, shipping_address)
SELECT id, 'pending', 'pending', 600, false, '{"address_line1":"2 B Rd","pincode":"248001","phone":"9111111301"}'::jsonb FROM customers WHERE first_name='V27-cust';
DO $$ DECLARE cid bigint; c1 bigint; c2 bigint; u0 int; BEGIN
  SELECT id, uses_count INTO cid, u0 FROM coupons WHERE code='WELCOME50';
  SELECT min(id), max(id) INTO c1, c2 FROM orders WHERE customer_id=(SELECT id FROM customers WHERE first_name='V27-cust');
  INSERT INTO coupon_usage (coupon_id, customer_id, order_id, discount_amount) VALUES (cid, (SELECT id FROM customers WHERE first_name='V27-cust'), c1, 50);
  INSERT INTO coupon_usage (coupon_id, customer_id, order_id, discount_amount) VALUES (cid, (SELECT id FROM customers WHERE first_name='V27-cust'), c2, 50);
  UPDATE coupons SET uses_count = COALESCE(uses_count,0) + 2 WHERE id = cid;
  UPDATE orders SET order_status='cancelled' WHERE id=c1;
  ASSERT NOT EXISTS (SELECT 1 FROM coupon_usage WHERE order_id=c1), 'cancel releases the usage row';
  ASSERT (SELECT uses_count FROM coupons WHERE id=cid) = COALESCE(u0,0) + 1, 'cancel decrements uses_count once';
  UPDATE orders SET order_status='payment_failed' WHERE id=c2;
  ASSERT NOT EXISTS (SELECT 1 FROM coupon_usage WHERE order_id=c2), 'payment_failed releases the usage row';
  ASSERT (SELECT uses_count FROM coupons WHERE id=cid) = COALESCE(u0,0), 'payment_failed decrements uses_count once';
END $$;
ROLLBACK;
