-- db_migration_v35 — verification codes for RISKY cash-on-delivery orders (Nov 2026, owner decision).
-- A first COD order, or a COD total above `cod_verify_above` (default ₹1,500), needs a 6-digit code sent to the customer
-- (e-mail now; WhatsApp once the Meta number is live). The code and the resulting token are stored only as SHA-256 hashes
-- bound to the phone + e-mail; a token is valid for 30 minutes after verification and only for that phone.
-- Server-only: RLS on with no policies (anon / authenticated cannot read or write), service_role only.
CREATE TABLE IF NOT EXISTS public.cod_verifications (
  id           bigserial PRIMARY KEY,
  phone10      text        NOT NULL,
  email        text        NOT NULL,
  channel      text        NOT NULL DEFAULT 'email',
  code_hash    text        NOT NULL,
  attempts     integer     NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  verified_at  timestamptz,
  token_hash   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cod_verifications_phone_created_idx ON public.cod_verifications (phone10, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cod_verifications_token_idx ON public.cod_verifications (token_hash) WHERE token_hash IS NOT NULL;
ALTER TABLE public.cod_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cod_verifications FROM anon, authenticated;
GRANT ALL ON public.cod_verifications TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cod_verifications_id_seq TO service_role;
