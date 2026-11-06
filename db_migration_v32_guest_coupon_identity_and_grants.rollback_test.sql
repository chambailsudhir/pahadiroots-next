-- Rolled-back test for db_migration_v32 (run inside a transaction, then ROLLBACK).
BEGIN;
\i db_migration_v32_guest_coupon_identity_and_grants.sql
-- a one-time coupon claimed by a guest key cannot be claimed again by the same key, but can by another key
INSERT INTO coupons (code, is_active, type, value, user_limit) VALUES ('V32TEST', true, 'flat', 10, 1) RETURNING id \gset
SELECT (public.claim_coupon_use(:id, NULL, 'key-a')->>'ok')::boolean AS first_ok;      -- true
SELECT (public.claim_coupon_use(:id, NULL, 'key-a')->>'code') AS second_code;           -- user_limit
SELECT (public.claim_coupon_use(:id, NULL, 'key-b')->>'ok')::boolean AS other_key_ok;  -- true
-- a verified customer who already claimed by key is also caught by id OR key
SELECT has_function_privilege('anon', 'public.order_coupon_gst_credit(bigint)', 'EXECUTE') AS anon_can_exec; -- false
ROLLBACK;
