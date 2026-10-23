PAHADI ROOTS FINANCIAL FIXES, 23 Oct 2026

ALREADY LIVE IN SUPABASE (applied and tested with rolled back transactions): migrations 065 to 070.

DEPLOY ORDER
1. Copy the files in storefront/ into pahadiroots-next (same paths), push, wait for the Vercel deploy to go green.
2. Copy the files in admin/ into pahadi-admin (same paths), push, deploy.
3. Only after step 1 is live: run admin/supabase/staged/071_require_payment_before_paid.sql in Supabase.
4. Vercel, Production env: delete DISABLE_AUTH and NEXT_PUBLIC_DISABLE_AUTH. Re add the readable secrets as Sensitive.

ROLLBACK: admin/supabase/rollback/rollback_065_to_071.sql
