-- db_migration_v36 — risky-COD verification hardening (Nov 2026 security round 4, R4A-3). Additive, idempotent.
-- A verification token is now spent by ONE order: used_at + used_for (the order's idempotency key) are set atomically
-- when the order passes the gate. A retry of the same order (same idempotency key) may reuse it; any other order may not.
ALTER TABLE public.cod_verifications ADD COLUMN IF NOT EXISTS used_at  timestamptz;
ALTER TABLE public.cod_verifications ADD COLUMN IF NOT EXISTS used_for text;
REVOKE ALL ON public.cod_verifications FROM anon, authenticated;
