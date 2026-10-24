PAHADI ROOTS, ROUND 3 FIXES (24 Oct 2026). Built on your 24 Oct zips. Other sessions' changes are untouched.

ALREADY LIVE IN SUPABASE (applied and tested): 071 prepaid payment guards, 072 sales channel and COD paid rule,
073 GST ledger corrections. The files here are the repo records (named 071, 074, 075 to avoid clashing with the
072/073 files from another session, which are NOT applied in the database).

DEPLOY
1. Copy admin/ files into pahadi-admin (same paths), push, deploy.
2. Copy storefront/ files into pahadiroots-next (same paths), push, deploy.
Both are independent. No new environment variables.

WHAT CHANGED
Admin: one request settings save (owner only, audit logged, storefront purge in the same call); orders page shows the
sales channel chip (WhatsApp etc.) and explains why a prepaid order without captured payment cannot be moved;
Profit page empty state fix (no NaN, no false warnings).
Storefront: Razorpay switch now enforced on the server (it only hid the button before); maintenance gate refreshes
every 3 seconds (was 30); one shared store open check; checkout page refreshes payment options every 20 seconds
and when the tab becomes visible.
