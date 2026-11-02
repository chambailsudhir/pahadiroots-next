-- db_migration_v20_atomic_address_replace.sql
-- NOT APPLIED. Additive and idempotent (CREATE OR REPLACE FUNCTION). Review, then apply manually.
--
-- Atomic compare-and-replace of a customer's saved-address list (audit: lost update between two concurrent
-- POST /api/profile requests). The route reads the stored list, validates, then calls this function with the list it
-- READ (p_expected) and the list to store (p_rows). Inside ONE transaction, holding a row lock on the customer, the
-- function re-reads the stored list and only writes when it still equals p_expected; otherwise it returns false and the
-- route answers 409 "addresses_changed". The route keeps working without this function (falls back to upsert + cleanup).
--
-- Security: service-role only (the route calls it with the service key); rows are always written with
-- customer_id = p_customer_id, and an existing row owned by someone else is never touched.

CREATE OR REPLACE FUNCTION public.replace_saved_addresses(
  p_customer_id bigint,
  p_rows        jsonb,
  p_expected    jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current jsonb;
  v_exp     jsonb;
BEGIN
  -- Serialise concurrent replacements for the same customer.
  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'label', label, 'name', name, 'phone', phone,
           'addr', addr, 'city', city, 'state', state, 'pin', pin) ORDER BY id::text), '[]'::jsonb)
    INTO v_current
    FROM public.saved_addresses
   WHERE customer_id = p_customer_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e->>'id', 'label', e->'label', 'name', e->'name', 'phone', e->'phone',
           'addr', e->'addr', 'city', e->'city', 'state', e->'state', 'pin', e->'pin') ORDER BY e->>'id'), '[]'::jsonb)
    INTO v_exp
    FROM jsonb_array_elements(COALESCE(p_expected, '[]'::jsonb)) AS e;

  IF v_current IS DISTINCT FROM v_exp THEN
    RETURN false;
  END IF;

  INSERT INTO public.saved_addresses (id, customer_id, label, name, phone, addr, city, state, pin)
  SELECT r.id, p_customer_id, r.label, r.name, r.phone, r.addr, r.city, r.state, r.pin
    FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb))
         AS r(id uuid, label text, name text, phone text, addr text, city text, state text, pin text)
  ON CONFLICT (id) DO UPDATE
     SET label = EXCLUDED.label, name = EXCLUDED.name, phone = EXCLUDED.phone, addr = EXCLUDED.addr,
         city = EXCLUDED.city, state = EXCLUDED.state, pin = EXCLUDED.pin
   WHERE public.saved_addresses.customer_id = p_customer_id;   -- never overwrite another customer's row

  DELETE FROM public.saved_addresses
   WHERE customer_id = p_customer_id
     AND id NOT IN (SELECT (r->>'id')::uuid FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS r);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_saved_addresses(bigint, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_saved_addresses(bigint, jsonb, jsonb) TO service_role;
