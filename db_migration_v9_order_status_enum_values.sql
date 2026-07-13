-- ============================================================
-- PAHADI ROOTS — DB MIGRATION v9: EXTEND order_status_enum
-- Run in Supabase SQL Editor AFTER v8 (wishlist_items)
--
-- BUG FIX (CRITICAL — found via manual audit, confirmed via live enum
-- inspection, NOT guessed): order_status_enum currently only has:
--   pending, confirmed, packed, shipped, delivered, cancelled, returned
--
-- But the storefront codebase extensively and deliberately relies on 8
-- more values that were never added to this enum:
--   processing, return_requested, return_approved, return_received,
--   refund_initiated, refund_completed, return_rejected, refunded
--
-- This is not a small oversight — grepping the codebase shows this is
-- fully designed and built out: the order-success status stepper
-- (CONFIRMED → PROCESSING → SHIPPED → DELIVERED), the account order-detail
-- page's human-readable status messages ("✅ Return approved — pickup
-- being arranged", "💚 Refund credited to your account!"), the 7-day
-- return-request window enforcement, and idempotency guards against
-- duplicate return requests (RETURN_IN_PROGRESS check) — all of it
-- assumes these statuses are valid.
--
-- Right now, LIVE, in production:
--   - Every "Request a Return" submission crashes at the final save step
--     (tries to set order_status = 'return_requested', which doesn't
--     exist — the customer sees an error after passing every validation
--     check, including the 7-day window).
--   - The order-success page's "Processing" step can never actually be
--     reached by any real order.
--   - The account page's "Active Orders" and "Returns" filter tabs risk
--     the same "invalid input value for enum" crash (this is exactly the
--     error already hit once this session, from a different code path).
--
-- ALTER TYPE ... ADD VALUE is a safe, additive-only operation: it cannot
-- remove or rename anything, cannot affect any existing row, and every
-- statement below is independently idempotent (IF NOT EXISTS).
--
-- Ordering below places 'processing' in its natural spot in the main
-- fulfillment flow (confirmed → processing → packed → shipped →
-- delivered — matches order-success/page.tsx's STATUS_ORDER), and the
-- return/refund cluster after 'returned' (only reachable from
-- 'delivered', per the return route's own guard).
--
-- NOTE: each ALTER TYPE ADD VALUE below is its own statement/transaction
-- (Supabase's SQL Editor runs top-level statements independently) — this
-- is required because a newly added enum value cannot be used within the
-- same transaction that added it.
-- ============================================================

ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'processing' AFTER 'confirmed';
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'return_requested' AFTER 'returned';
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'return_approved' AFTER 'return_requested';
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'return_received' AFTER 'return_approved';
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'return_rejected' AFTER 'return_received';
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'refund_initiated' AFTER 'return_rejected';
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'refund_completed' AFTER 'refund_initiated';
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'refunded' AFTER 'refund_completed';

-- ============================================================
-- After running the ALTER TYPE statements above, run this to confirm
-- the enum now has all 15 values (7 original + 8 new):
--
--   SELECT enumlabel FROM pg_enum
--   WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'order_status_enum')
--   ORDER BY enumsortorder;
-- ============================================================
