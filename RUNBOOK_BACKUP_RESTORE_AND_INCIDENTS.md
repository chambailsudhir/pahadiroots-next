# Runbook — backup/restore, release, incidents (AUDIT G1-19/G1-26/G1-27, B7/B8)

> Status: PROCEDURE. No backup has been evidenced yet (the audit could not verify PITR or any dump). The owner must run §1 once and file the evidence before launch.

## 1. Backup (weekly minimum; daily recommended) — owner laptop or a GitHub Actions scheduled job
1. Supabase Dashboard → Project Settings → Database → **Connection string (Session pooler)**. Keep it out of the repo.
2. Dump schema + data (roles excluded) with the project's Postgres major (17):
   `pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges --format=custom --file=pahadi_$(date +%F).dump`
3. Encrypt before storing: `age -r <owner-public-key> -o pahadi_$(date +%F).dump.age pahadi_$(date +%F).dump && shred -u pahadi_$(date +%F).dump`
4. Store in a private bucket/drive with 90-day retention; log who accessed it. Dumps contain customer PII and vendor bank fields.
5. Alternative with zero ops: upgrade Supabase to Pro (daily backups, 7-day PITR). Cheaper than losing the finance journal.

## 2. Restore drill (do once before launch, then quarterly) — NEVER into the production project
1. Create a scratch Supabase project (or local PG17: `initdb` + `createdb drill`).
2. `pg_restore --no-owner --no-privileges -d "<scratch url>" pahadi_<date>.dump`
3. Verify: `select count(*) from orders; select count(*) from finance_journal_entries; select proname from pg_proc where proname in ('handle_return_restock','enforce_order_status_machine');`
4. Point a local admin (`npm run dev` with scratch env) at it and open Orders, Finance, Returns.
5. File: date, dump name, row counts, who ran it, time to restore → `docs/evidence/restore_<date>.md`.

## 3. Release procedure (replaces "Add files via upload")
1. All changes via PR to `main`; GitHub Action `verify` must be green (typecheck, critical typecheck, tests, `npm audit --audit-level=high`, secret grep). Enable branch protection + Vercel "deploy only when checks pass".
2. Migrations: apply in the documented order (`supabase/README_MIGRATIONS_087_090.md`) with the SQL editor or `supabase db push`, **after** the matching code is deployed only when the migration is backward-compatible (087–092 are). Each migration has `rollback/NNN_rollback.sql` rehearsed on a scratch DB.
3. Post-deploy smoke (read-only): `GET /api/health` → `{ok:true, build}`; admin login; Orders page loads; storefront `/track` with a known order; a Razorpay test-mode payment on a preview deployment.
4. Rollback: Vercel → Deployments → "Promote to production" the previous READY deployment; DB rollback only via the rehearsed file for the specific migration.

## 4. Incidents — who/what/how
| Signal | First check | Action |
|---|---|---|
| Alert `payments.capture_unbound` / HMAC mismatch (storefront logger `alert:true`) | Vercel runtime logs filtered by `requestId`; Razorpay dashboard payment id | Match payment to order; if no order, initiate refund in Razorpay dashboard; record in `refund_payouts` |
| Exceptions page: refund_pending aged / COD unremitted / paid-without-payment | `/admin/exceptions` | Record payout / remittance with UTR; never edit journal rows by hand |
| Stock mismatch (Exceptions → stock reconciliation) | `stock_movements` for the variant | Manual adjustment with reason through Inventory (creates an audited movement); never UPDATE product_variants directly |
| Site down / 5xx spike | `/api/health`, Vercel deployment state | Promote previous deployment; check Supabase status page |
| Suspected credential leak | Vercel env history, Supabase API keys page | Rotate SUPABASE_SERVICE_KEY, TOKEN_SECRET (logs everyone out), RAZORPAY secrets, RESEND; redeploy |

## 5. Monitoring to switch on (free tiers)
- Vercel → Integrations → Axiom or Sentry; wire `captureError` sink (storefront `src/lib/logger`, admin `ErrorBoundary`).
- External uptime check on `https://www.pahadiroots.com/api/health` and `https://pahadi-admin.vercel.app/api/health` every 5 min, e-mail the owner.
- GitHub: Dependabot (added), secret scanning + push protection (repo settings).
