-- ============================================================
-- PAHADI ROOTS — DB MIGRATION v6: ORDER CONFIRMATION TOKEN
-- Run in Supabase SQL Editor AFTER v5 (email DLQ)
--
-- BUG FIX (order-success page): order-success/page.tsx used to POST to
-- /api/admin-api — the OLD vanilla-site's API path, never ported to this
-- Next.js app. It always 404'd, on every single order, so the "rich" order
-- status view (items, tracking, status stepper) never once rendered in
-- production; every customer saw a generic "check your email/WhatsApp"
-- fallback.
--
-- The fix wires order-success up to a new, real, GUEST-SAFE lookup endpoint
-- (GET /api/v1/orders/lookup) instead. A guest checkout has no login
-- session, so that endpoint can't rely on cookie auth alone — and the
-- order_number by itself is a short, human-readable, sequential-ish string
-- (e.g. "PRMR4OEQ") that must NEVER be treated as a secret: exposing full
-- order data (address, phone, items) to anyone who can type/guess an
-- order_number would be an IDOR vulnerability.
--
-- This is the same pattern Amazon/Myntra and most e-commerce sites use for
-- guest order-confirmation pages: a long, cryptographically random,
-- single-purpose token is generated at order-creation time and embedded in
-- the confirmation URL. Only someone holding that exact URL (i.e. the
-- customer who just placed the order, or someone they explicitly shared it
-- with) can look up the order without logging in. Logged-in customers can
-- still view their own orders via session auth alone (no token needed) —
-- see /api/orders/[id]/route.ts for that existing, already-IDOR-guarded path.
-- ============================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_token text;

-- Partial unique index: most historical rows will have NULL (orders placed
-- before this migration never had a token issued, and never will
-- retroactively — order-success just degrades gracefully to the generic
-- fallback for those, exactly as it already did for every order until now).
-- Excluding NULLs from the uniqueness constraint means historical rows don't
-- collide with each other, while guaranteeing every *token that does exist*
-- is unique and lookups are O(1) via the index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_confirmation_token
  ON orders (confirmation_token)
  WHERE confirmation_token IS NOT NULL;
