-- ============================================================
-- PAHADI ROOTS — DB MIGRATION v5: EMAIL DEAD-LETTER QUEUE
-- Run in Supabase SQL Editor AFTER v4 (loyalty)
--
-- AUDIT FIX [ERROR HANDLING]: transactional emails (order confirmation,
-- admin order notification, payment confirmation, contact form) were sent
-- with no persistent failure record and no retry. Worse — every call site
-- only logged on a *thrown* exception, but the Resend SDK's fetchRequest()
-- catches both network errors AND non-2xx API responses internally and
-- resolves with `{ data: null, error }` rather than rejecting. That means
-- the existing try/catch blocks never actually fired for the most common
-- real-world failure (bad/expired API key, unverified sending domain,
-- recipient bounce, monthly send quota, Resend-side rate limit) — the
-- email silently failed to send with ZERO trace anywhere, and the
-- order/payment/contact flow proceeded as if it had succeeded.
--
-- This table is the dead-letter queue: src/lib/server/email.ts inserts a
-- row here whenever a transactional email exhausts its inline retries.
-- src/app/api/v1/cron/retry-failed-emails/route.ts (wired to a Vercel Cron
-- job — see vercel.json) periodically retries 'pending' rows with
-- exponential backoff, marking each 'sent' on success or 'dead' after
-- MAX_DLQ_ATTEMPTS — at which point it needs manual ops investigation
-- (check the Resend dashboard / `last_error` column).
-- ============================================================

CREATE TABLE IF NOT EXISTS failed_emails (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'order_confirmation' | 'admin_order_notify' | 'payment_confirmation' | 'contact_form'
  type            TEXT NOT NULL,
  to_email        TEXT NOT NULL,
  -- Sender display name + address, e.g. 'Pahadi Roots <noreply@pahadiroots.com>'.
  -- Most call sites use the same default; contact-form notifications use a
  -- distinct 'Pahadi Roots Contact <...>' sender, so this is captured per-row
  -- rather than hardcoded in the retry sweep.
  from_address    TEXT NOT NULL DEFAULT 'Pahadi Roots <noreply@pahadiroots.com>',
  subject         TEXT NOT NULL,
  html            TEXT NOT NULL,
  -- Free-form reference for ops/replay — e.g. { "order_id": "...", "order_number": "PR-1042" }.
  -- Never store secrets here; this is operational metadata only.
  context         JSONB,
  last_error      TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'sent', 'dead')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The cron retry route only ever queries pending rows whose backoff window
-- has elapsed — a partial index keeps that lookup cheap as the table grows
-- (sent/dead rows accumulate for audit history but are never re-scanned).
CREATE INDEX IF NOT EXISTS idx_failed_emails_retry
  ON failed_emails(next_retry_at)
  WHERE status = 'pending';

-- Ops query: "what's currently broken" — recent dead-letter entries by type.
CREATE INDEX IF NOT EXISTS idx_failed_emails_type_created
  ON failed_emails(type, created_at DESC);
