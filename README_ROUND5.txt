PAHADI ROOTS, ROUND 5 (25 Oct 2026): Profit page and everything it depends on
Includes everything from round 4 (page.jsx there is replaced by the newer one here).

DATABASE: already live (076 to 081). Nothing to run.
DEPLOY: copy admin/ files into pahadi-admin, storefront/ files into pahadiroots-next (same paths), push, deploy both.

PROFIT PAGE
 GST Payable now deducts the GST of partial refunds too (it kept 118.76 in the 6 month view). Matches the ledger to the paisa.
 Net GMV and net billings use goods refunds only. Shipping or COD fee given back is shown separately.
DEPENDENT PAGES
 GST page: seller state read from Settings (was hardcoded Uttarakhand); views fixed in the database.
 Dashboard: refund cost rule (restock) and sale time cost, and its Total Revenue says it is orders placed.
 Products page: refund cost rule, a not restocked refund keeps its cost as a loss on that product.
 Storefront: delivery state must be a real Indian state (GST split depends on it).
TESTS: admin 1834 pass, storefront 1940 pass, type check clean. New tests fail on the old code (checked).
